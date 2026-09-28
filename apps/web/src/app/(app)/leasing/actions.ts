"use server";


import { actionFailure, failFromError } from "@/lib/action-error";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireStaff, type SessionUser } from "@/lib/auth";
import { assertCan, isScoped } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { LEAD_STAGE_ORDER, LEAD_STAGES } from "@/lib/constants";
import type { FormState } from "@/components/ui";

const schema = z.object({
  name: z.string().min(2, "اسم العميل مطلوب"),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  source: z.string().default("WALK_IN"),
  stage: z.string().default("LEAD"),
  unitId: z.string().optional().nullable(),
  assignedToId: z.string().optional().nullable(),
  viewingDate: z.string().optional().nullable(),
  offerAmount: z.coerce.number().optional().nullable(),
  notes: z.string().optional().nullable(),
});

function parse(formData: FormData) {
  const raw: Record<string, unknown> = {};
  formData.forEach((v, k) => {
    if (k === "id") return;
    raw[k] = v === "" ? null : v;
  });
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return parsed;
  if (!LEAD_STAGES[parsed.data.stage]) return { success: false as const, error: { issues: [{ message: "مرحلة غير صالحة." }] } };
  return parsed;
}

function toData(d: z.infer<typeof schema>) {
  return {
    name: d.name,
    phone: d.phone ?? null,
    email: d.email ?? null,
    source: d.source,
    stage: d.stage,
    unitId: d.unitId ?? null,
    assignedToId: d.assignedToId ?? null,
    viewingDate: d.viewingDate ? new Date(d.viewingDate) : null,
    offerAmount: d.offerAmount ?? null,
    notes: d.notes ?? null,
  };
}

/** Scoped roles may only work on leads whose unit belongs to an assigned property (or no unit). */
function leadScope(user: SessionUser) {
  if (!isScoped(user)) return {};
  return { OR: [{ unitId: null }, { unit: { propertyId: { in: user.assignedPropertyIds } } }] };
}

async function assertUnitInOrg(user: SessionUser & { organizationId: string }, unitId: string | null | undefined) {
  if (!unitId) return true;
  const u = await db.unit.findFirst({ where: { id: unitId, organizationId: user.organizationId, ...(isScoped(user) ? { propertyId: { in: user.assignedPropertyIds } } : {}) }, select: { id: true } });
  return Boolean(u);
}

export async function createLead(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await requireStaff();
    assertCan(user, "leasing.manage");
    const parsed = parse(formData);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    if (!(await assertUnitInOrg(user, parsed.data.unitId))) return { error: "الوحدة المختارة غير موجودة ضمن نطاقك." };
    const lead = await db.lead.create({ data: { ...toData(parsed.data), organizationId: user.organizationId } });
    await audit({ user, action: "CREATE", entityType: "LEAD", entityId: lead.id, entityLabel: lead.name, newValue: parsed.data });
    if (lead.assignedToId && lead.assignedToId !== user.id) {
      await notify({ organizationId: user.organizationId, userIds: [lead.assignedToId], title: `عميل محتمل جديد مسند إليك: ${lead.name}`, entityType: "LEAD", entityId: lead.id, href: `/leasing/${lead.id}` });
    }
    revalidatePath("/leasing");
    redirect(`/leasing/${lead.id}?toast=created`);
  } catch (e) {
    return actionFailure(e);
  }
}

export async function updateLead(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await requireStaff();
    assertCan(user, "leasing.manage");
    const id = String(formData.get("id"));
    const parsed = parse(formData);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const old = await db.lead.findFirst({ where: { id, organizationId: user.organizationId, ...leadScope(user) } });
    if (!old) return { error: "العميل المحتمل غير موجود." };
    if (old.stage === "RENTED") return { error: "تم تأجير هذا العميل — لا يمكن تعديل بياناته." };
    if (!(await assertUnitInOrg(user, parsed.data.unitId))) return { error: "الوحدة المختارة غير موجودة ضمن نطاقك." };
    const data = toData(parsed.data);
    await db.lead.update({ where: { id }, data: { ...data, lostReason: data.stage === "LOST" ? old.lostReason : null } });
    await audit({ user, action: "UPDATE", entityType: "LEAD", entityId: id, entityLabel: data.name, oldValue: { name: old.name, stage: old.stage, unitId: old.unitId, offerAmount: old.offerAmount, assignedToId: old.assignedToId }, newValue: parsed.data });
    revalidatePath(`/leasing/${id}`);
    revalidatePath("/leasing");
    redirect(`/leasing/${id}?toast=updated`);
  } catch (e) {
    return actionFailure(e);
  }
}

/** Moves a lead to a given stage (next / previous). RENTED is terminal. */
export async function moveStage(formData: FormData) {
  try {
    const user = await requireStaff();
    assertCan(user, "leasing.manage");
    const id = String(formData.get("id"));
    const stage = String(formData.get("stage"));
    if (!LEAD_STAGE_ORDER.includes(stage)) throw new Error("مرحلة غير صالحة.");
    const lead = await db.lead.findFirst({ where: { id, organizationId: user.organizationId, ...leadScope(user) }, include: { unit: { select: { id: true, number: true, status: true } } } });
    if (!lead) throw new Error("العميل المحتمل غير موجود.");
    if (lead.stage === "RENTED") throw new Error("تم تأجير هذا العميل — لا يمكن تغيير المرحلة.");
    await db.lead.update({ where: { id }, data: { stage, lostReason: null } });
    // Reserve the unit while the lead is in application/approval/contracting; release it when moved back.
    if (lead.unit && !["RENTED", "ARCHIVED", "UNDER_MAINTENANCE", "UNAVAILABLE"].includes(lead.unit.status)) {
      const reserveStages = ["APPLICATION", "APPROVED", "CONTRACTING"];
      if (reserveStages.includes(stage) && lead.unit.status !== "RESERVED") {
        await db.unit.update({ where: { id: lead.unit.id }, data: { status: "RESERVED" } });
      } else if (!reserveStages.includes(stage) && stage !== "RENTED" && lead.unit.status === "RESERVED") {
        await db.unit.update({ where: { id: lead.unit.id }, data: { status: "VACANT" } });
      }
    }
    await audit({ user, action: "STATUS_CHANGE", entityType: "LEAD", entityId: id, entityLabel: lead.name, oldValue: { stage: lead.stage }, newValue: { stage } });
    if (stage === "APPROVED") {
      await notify({
        organizationId: user.organizationId,
        roles: ["OFFICE_MANAGER"],
        title: `اعتماد عميل محتمل: ${lead.name}`,
        body: lead.unit ? `الوحدة ${lead.unit.number} — جاهز لإعداد العقد.` : "جاهز لإعداد العقد.",
        severity: "SUCCESS",
        entityType: "LEAD",
        entityId: id,
        href: `/leasing/${id}`,
      });
    }
    revalidatePath(`/leasing/${id}`);
    revalidatePath("/leasing");
  } catch (e) {
    await failFromError(e);
  }
}

export async function markLost(formData: FormData) {
  try {
    const user = await requireStaff();
    assertCan(user, "leasing.manage");
    const id = String(formData.get("id"));
    const reason = String(formData.get("reason") ?? "").trim();
    if (!reason) throw new Error("سبب الانسحاب مطلوب.");
    const lead = await db.lead.findFirst({ where: { id, organizationId: user.organizationId, ...leadScope(user) }, include: { unit: { select: { id: true, status: true } } } });
    if (!lead) throw new Error("العميل المحتمل غير موجود.");
    if (lead.stage === "RENTED") throw new Error("تم تأجير هذا العميل — لا يمكن تغيير المرحلة.");
    await db.lead.update({ where: { id }, data: { stage: "LOST", lostReason: reason } });
    if (lead.unit && lead.unit.status === "RESERVED") {
      await db.unit.update({ where: { id: lead.unit.id }, data: { status: "VACANT" } });
    }
    await audit({ user, action: "STATUS_CHANGE", entityType: "LEAD", entityId: id, entityLabel: lead.name, oldValue: { stage: lead.stage }, newValue: { stage: "LOST", lostReason: reason } });
    revalidatePath(`/leasing/${id}`);
    revalidatePath("/leasing");
  } catch (e) {
    await failFromError(e);
  }
}

/** Re-open a LOST lead back to the first stage. */
export async function reopenLead(formData: FormData) {
  try {
    const user = await requireStaff();
    assertCan(user, "leasing.manage");
    const id = String(formData.get("id"));
    const lead = await db.lead.findFirst({ where: { id, organizationId: user.organizationId, ...leadScope(user) } });
    if (!lead || lead.stage !== "LOST") return;
    await db.lead.update({ where: { id }, data: { stage: "LEAD", lostReason: null } });
    await audit({ user, action: "STATUS_CHANGE", entityType: "LEAD", entityId: id, entityLabel: lead.name, oldValue: { stage: "LOST" }, newValue: { stage: "LEAD" } });
    revalidatePath(`/leasing/${id}`);
    revalidatePath("/leasing");
  } catch (e) {
    await failFromError(e);
  }
}
