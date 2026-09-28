"use server";


import { actionFailure, failFromError, userMessage } from "@/lib/action-error";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { assertCan, propertyIdScope, propertyScope } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { nextCode } from "@/lib/codes";
import { UNIT_STATUS, UNIT_TYPES, UNIT_USAGE } from "@/lib/constants";
import type { FormState } from "@/components/ui";
import { asciiDigits } from "@/lib/phone";

const ACTIVE_CONTRACT = ["ACTIVE", "EXPIRING_SOON", "RENEWAL_PENDING"];

const RANGE_CAP = 200;

const schema = z.object({
  propertyId: z.string().min(1, "العقار مطلوب"),
  number: z.string().trim().min(1, "رقم الوحدة مطلوب"),
  floor: z.string().optional().nullable(),
  type: z.string().refine((v) => v in UNIT_TYPES, "نوع الوحدة غير صالح"),
  usage: z.string().refine((v) => v in UNIT_USAGE, "استخدام الوحدة غير صالح"),
  area: z.coerce.number().min(0).optional().nullable(),
  rooms: z.coerce.number().int().min(0).optional().nullable(),
  bathrooms: z.coerce.number().int().min(0).optional().nullable(),
  targetRent: z.coerce.number().min(0).optional().nullable(),
  currentRent: z.coerce.number().min(0).optional().nullable(),
  status: z
    .string()
    .refine((v) => v in UNIT_STATUS, "حالة الوحدة غير صالحة")
    .default("VACANT"),
  tags: z.string().optional().default(""),
  notes: z.string().optional().nullable(),
});

function parse(formData: FormData) {
  const raw: Record<string, unknown> = {};
  formData.forEach((v, k) => {
    if (k === "id" || k === "rangeFrom" || k === "rangeTo") return;
    raw[k] = v === "" ? null : v;
  });
  raw.tags = raw.tags ?? "";
  // Range mode (new only): "number" is derived from rangeFrom so the single-unit schema still validates.
  const from = String(formData.get("rangeFrom") ?? "").trim();
  if (!raw.number && from) raw.number = from;
  return schema.safeParse(raw);
}

/** "من رقم / إلى رقم": both numeric and from <= to → the list of unit numbers to create. */
function parseRange(formData: FormData): { numbers: string[] } | { error: string } | null {
  const from = asciiDigits(String(formData.get("rangeFrom") ?? "")).trim();
  const to = asciiDigits(String(formData.get("rangeTo") ?? "")).trim();
  if (!from && !to) return null;
  if (!from || !to) return { error: "أدخل رقمي البداية والنهاية معًا لإنشاء نطاق، أو اتركهما فارغين." };
  if (!/^\d+$/.test(from) || !/^\d+$/.test(to)) return { error: "نطاق الأرقام يقبل أرقامًا صحيحة فقط (مثال: من 101 إلى 120)." };
  const a = Number(from);
  const b = Number(to);
  if (b < a) return { error: "رقم النهاية يجب أن يكون أكبر من أو يساوي رقم البداية." };
  if (b - a + 1 > RANGE_CAP) return { error: `الحد الأقصى ${RANGE_CAP} وحدة في النطاق الواحد.` };
  const width = from.length; // keep leading zeros ("001" … "020")
  const numbers: string[] = [];
  for (let n = a; n <= b; n++) numbers.push(String(n).padStart(width, "0"));
  return { numbers };
}

/** Property must belong to the org and be inside the user's data scope. */
async function assertProperty(user: Awaited<ReturnType<typeof requireStaff>>, propertyId: string) {
  const p = await db.property.findFirst({ where: { id: propertyId, organizationId: user.organizationId, ...propertyScope(user) }, select: { id: true, name: true, status: true } });
  if (!p) throw new Error("العقار غير موجود أو خارج نطاق صلاحياتك.");
  if (p.status === "ARCHIVED") throw new Error("لا يمكن إضافة وحدات لعقار مؤرشف.");
  return p;
}

async function hasActiveContract(unitId: string) {
  const c = await db.contract.count({ where: { unitId, status: { in: ACTIVE_CONTRACT } } });
  return c > 0;
}

export async function createUnit(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await requireStaff();
    assertCan(user, "units.manage");
    const parsed = parse(formData);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const data = parsed.data;
    try {
      await assertProperty(user, data.propertyId);
    } catch (e) {
      return { error: userMessage(e) };
    }
    if (data.status === "RENTED") return { error: "لا يمكن تعيين حالة «مؤجرة» يدويًا — تُحدَّث تلقائيًا عند تفعيل عقد على الوحدة." };
    if (data.status === "ARCHIVED") return { error: "لا يمكن إنشاء وحدة بحالة مؤرشفة." };

    // Range mode: one unit per number with the same type / rent / floor; numbers already in the property are skipped.
    const range = parseRange(formData);
    if (range && "error" in range) return { error: range.error };
    if (range) {
      const existing = await db.unit.findMany({ where: { propertyId: data.propertyId, number: { in: range.numbers }, status: { not: "ARCHIVED" } }, select: { number: true } });
      const taken = new Set(existing.map((u) => u.number));
      const toCreate = range.numbers.filter((n) => !taken.has(n));
      if (toCreate.length === 0) return { error: "كل أرقام هذا النطاق مسجلة مسبقًا في العقار. لم تُضف أي وحدة." };
      const created: { id: string; number: string }[] = [];
      for (const number of toCreate) {
        const code = await nextCode(user.organizationId, "unit");
        const u = await db.unit.create({ data: { ...data, number, organizationId: user.organizationId, code }, select: { id: true, number: true } });
        created.push(u);
      }
      await audit({
        user,
        action: "CREATE",
        entityType: "UNIT",
        entityId: created[0].id,
        entityLabel: `${created.length} وحدة (${created[0].number} → ${created[created.length - 1].number})`,
        newValue: { ...data, number: undefined, range: { from: range.numbers[0], to: range.numbers[range.numbers.length - 1] }, created: created.map((u) => u.number), skipped: [...taken] },
      });
      revalidatePath("/units");
      revalidatePath(`/properties/${data.propertyId}`);
      redirect(`/properties/${data.propertyId}?tab=units&toast=created`);
    }

    const dup = await db.unit.findFirst({ where: { propertyId: data.propertyId, number: data.number, status: { not: "ARCHIVED" } }, select: { id: true } });
    if (dup) return { error: "توجد وحدة بنفس الرقم في هذا العقار." };

    const code = await nextCode(user.organizationId, "unit");
    const u = await db.unit.create({ data: { ...data, organizationId: user.organizationId, code } });
    await audit({ user, action: "CREATE", entityType: "UNIT", entityId: u.id, entityLabel: u.number, newValue: data });
    revalidatePath("/units");
    revalidatePath(`/properties/${data.propertyId}`);
    redirect(`/properties/${data.propertyId}?tab=units&toast=created`);
  } catch (e) {
    return actionFailure(e);
  }
}

export async function updateUnit(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await requireStaff();
    assertCan(user, "units.manage");
    const id = String(formData.get("id"));
    const parsed = parse(formData);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const data = parsed.data;

    const old = await db.unit.findFirst({ where: { id, organizationId: user.organizationId, ...propertyIdScope(user) } });
    if (!old) return { error: "الوحدة غير موجودة." };
    if (old.status === "ARCHIVED") return { error: "الوحدة مؤرشفة. استعدها أولًا قبل التعديل." };
    if (data.status === "ARCHIVED") return { error: "استخدم إجراء الأرشفة من صفحة الوحدة." };

    const active = await hasActiveContract(id);
    if (data.propertyId !== old.propertyId) {
      if (active) return { error: "لا يمكن نقل وحدة مرتبطة بعقد نشط إلى عقار آخر." };
      try {
        await assertProperty(user, data.propertyId);
      } catch (e) {
        return { error: userMessage(e) };
      }
    }
    if (data.status === "RENTED" && !active) return { error: "لا يمكن تعيين حالة «مؤجرة» بدون عقد نشط على الوحدة." };
    if (active && ["VACANT", "AVAILABLE"].includes(data.status)) return { error: "الوحدة مرتبطة بعقد نشط ولا يمكن تعيينها شاغرة. أنهِ العقد أولًا." };

    const dup = await db.unit.findFirst({ where: { propertyId: data.propertyId, number: data.number, status: { not: "ARCHIVED" }, id: { not: id } }, select: { id: true } });
    if (dup) return { error: "توجد وحدة أخرى بنفس الرقم في هذا العقار." };

    await db.unit.update({ where: { id }, data });
    await audit({
      user,
      action: "UPDATE",
      entityType: "UNIT",
      entityId: id,
      entityLabel: data.number,
      oldValue: { number: old.number, status: old.status, type: old.type, targetRent: old.targetRent, currentRent: old.currentRent, propertyId: old.propertyId },
      newValue: data,
    });
    revalidatePath(`/units/${id}`);
    revalidatePath("/units");
    redirect(`/units/${id}?toast=updated`);
  } catch (e) {
    return actionFailure(e);
  }
}

/** One-click status change from the Unit 360 page. */
export async function setUnitStatus(formData: FormData) {
  try {
    const user = await requireStaff();
    assertCan(user, "units.manage");
    const id = String(formData.get("id"));
    const status = String(formData.get("status") ?? "");
    if (!(status in UNIT_STATUS) || status === "ARCHIVED") throw new Error("حالة غير صالحة.");
    const u = await db.unit.findFirst({ where: { id, organizationId: user.organizationId, ...propertyIdScope(user) }, select: { id: true, number: true, status: true } });
    if (!u) throw new Error("الوحدة غير موجودة.");
    if (u.status === "ARCHIVED") throw new Error("الوحدة مؤرشفة.");
    const active = await hasActiveContract(id);
    if (status === "RENTED" && !active) throw new Error("لا يمكن تعيين حالة «مؤجرة» بدون عقد نشط على الوحدة.");
    if (active && ["VACANT", "AVAILABLE"].includes(status)) throw new Error("الوحدة مرتبطة بعقد نشط ولا يمكن تعيينها شاغرة.");
    if (u.status === status) return;
    await db.unit.update({ where: { id }, data: { status } });
    await audit({ user, action: "STATUS_CHANGE", entityType: "UNIT", entityId: id, entityLabel: u.number, oldValue: { status: u.status }, newValue: { status } });
    revalidatePath(`/units/${id}`);
    revalidatePath("/units");
  } catch (e) {
    await failFromError(e);
  }
}

export async function archiveUnit(formData: FormData) {
  try {
    const user = await requireStaff();
    assertCan(user, "units.manage");
    const id = String(formData.get("id"));
    const u = await db.unit.findFirst({ where: { id, organizationId: user.organizationId, ...propertyIdScope(user) }, select: { id: true, number: true, status: true, propertyId: true } });
    if (!u) return;
    if (await hasActiveContract(id)) throw new Error("لا يمكن أرشفة وحدة مرتبطة بعقد نشط.");
    const pending = await db.contract.findFirst({ where: { unitId: id, organizationId: user.organizationId, status: { in: ["DRAFT", "PENDING_APPROVAL"] } }, select: { code: true } });
    if (pending) throw new Error(`لا يمكن أرشفة وحدة عليها عقد مسودة أو بانتظار الاعتماد (${pending.code}). ألغِ العقد أولًا.`);
    await db.unit.update({ where: { id }, data: { status: "ARCHIVED" } });
    await audit({ user, action: "ARCHIVE", entityType: "UNIT", entityId: id, entityLabel: u.number, oldValue: { status: u.status }, newValue: { status: "ARCHIVED" } });
    revalidatePath("/units");
    revalidatePath(`/properties/${u.propertyId}`);
    redirect("/units?toast=archived");
  } catch (e) {
    await failFromError(e);
  }
}

export async function restoreUnit(formData: FormData) {
  try {
    const user = await requireStaff();
    assertCan(user, "units.manage");
    const id = String(formData.get("id"));
    const u = await db.unit.findFirst({ where: { id, organizationId: user.organizationId, ...propertyIdScope(user) }, select: { id: true, number: true, status: true, property: { select: { status: true } } } });
    if (!u) return;
    if (u.property.status === "ARCHIVED") throw new Error("لا يمكن استعادة وحدة في عقار مؤرشف. استعد العقار أولًا.");
    await db.unit.update({ where: { id }, data: { status: "VACANT" } });
    await audit({ user, action: "UPDATE", entityType: "UNIT", entityId: id, entityLabel: u.number, oldValue: { status: u.status }, newValue: { status: "VACANT" } });
    revalidatePath(`/units/${id}`);
    revalidatePath("/units");
  } catch (e) {
    await failFromError(e);
  }
}
