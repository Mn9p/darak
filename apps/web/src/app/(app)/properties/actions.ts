"use server";


import { actionFailure, failFromError, userMessage } from "@/lib/action-error";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { assertCan, can, propertyScope } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { nextCode } from "@/lib/codes";
import type { FormState } from "@/components/ui";

const schema = z.object({
  name: z.string().min(2, "اسم العقار مطلوب"),
  type: z.string().min(1),
  branchId: z.string().optional().nullable(),
  managerId: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  district: z.string().optional().nullable(),
  street: z.string().optional().nullable(),
  nationalAddress: z.string().optional().nullable(),
  deedNumber: z.string().optional().nullable(),
  landArea: z.coerce.number().optional().nullable(),
  buildingArea: z.coerce.number().optional().nullable(),
  floors: z.coerce.number().int().optional().nullable(),
  buildYear: z.coerce.number().int().optional().nullable(),
  status: z.string().default("ACTIVE"),
  tags: z.string().optional().default(""),
  notes: z.string().optional().nullable(),
  customFields: z.string().optional().default("{}"),
});

function parse(formData: FormData) {
  const raw: Record<string, unknown> = {};
  formData.forEach((v, k) => {
    if (k.startsWith("owner_") || k === "id") return;
    raw[k] = v === "" ? null : v;
  });
  // custom fields: cf_<key>
  const cf: Record<string, string> = {};
  formData.forEach((v, k) => {
    if (k.startsWith("cf_") && String(v).trim()) cf[k.slice(3)] = String(v);
  });
  raw.customFields = JSON.stringify(cf);
  raw.tags = raw.tags ?? "";
  return schema.safeParse(raw);
}

function parseOwnerships(formData: FormData) {
  const rows: { ownerId: string; percentage: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const ownerId = String(formData.get(`owner_${i}_id`) ?? "");
    const pct = Number(formData.get(`owner_${i}_pct`) ?? 0);
    if (ownerId && pct > 0) rows.push({ ownerId, percentage: pct });
  }
  const total = rows.reduce((s, r) => s + r.percentage, 0);
  if (rows.length && Math.abs(total - 100) > 0.01) throw new Error("مجموع نسب الملكية يجب أن يساوي 100% (BR-006).");
  return rows;
}

export async function createProperty(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await requireStaff();
    assertCan(user, "properties.manage");
    const parsed = parse(formData);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    let ownerships;
    try {
      ownerships = parseOwnerships(formData);
    } catch (e) {
      return { error: userMessage(e) };
    }
    const code = await nextCode(user.organizationId, "property");
    const p = await db.property.create({
      data: { ...parsed.data, organizationId: user.organizationId, code, ownerships: { create: ownerships.map((o) => ({ ...o, startDate: new Date() })) } },
    });
    await audit({ user, action: "CREATE", entityType: "PROPERTY", entityId: p.id, entityLabel: p.name, newValue: parsed.data });
    revalidatePath("/properties");
    redirect(`/properties/${p.id}?toast=created`);
  } catch (e) {
    return actionFailure(e);
  }
}

export async function updateProperty(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await requireStaff();
    assertCan(user, "properties.manage");
    const id = String(formData.get("id"));
    const parsed = parse(formData);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    let ownerships;
    try {
      ownerships = parseOwnerships(formData);
    } catch (e) {
      return { error: userMessage(e) };
    }
    const old = await db.property.findFirst({ where: { id, organizationId: user.organizationId, ...propertyScope(user) }, include: { ownerships: { where: { endDate: null } } } });
    if (!old) return { error: "العقار غير موجود." };
    const ownershipChanged = !(old.ownerships.length === ownerships.length && old.ownerships.every((c) => ownerships.some((o) => o.ownerId === c.ownerId && Math.abs(o.percentage - c.percentage) < 0.01)));
    // Ownership splits drive owner payouts: changing them needs owner management rights, not only property rights.
    if (ownershipChanged && ownerships.length && !can(user, "owners.manage")) return { error: "تغيير الملاك أو نسب الملكية يتطلب صلاحية إدارة الملاك." };

    await db.$transaction(async (tx) => {
      await tx.property.update({ where: { id }, data: parsed.data });
      // Historical ownership: close changed rows, add new ones (never rewrite history)
      const current = old.ownerships;
      const same = current.length === ownerships.length && current.every((c) => ownerships.some((o) => o.ownerId === c.ownerId && Math.abs(o.percentage - c.percentage) < 0.01));
      if (!same && ownerships.length) {
        const moneyMoved =
          (await tx.paymentAllocation.count({ where: { installment: { contract: { propertyId: id } } } })) > 0 ||
          (await tx.expense.count({ where: { propertyId: id, organizationId: user.organizationId, approvalStatus: "APPROVED" } })) > 0;
        if (!moneyMoved) {
          // A correction before any money moved: replace the split so it stays the opening ownership (covers back-dated history).
          await tx.propertyOwnership.deleteMany({ where: { propertyId: id } });
          await tx.propertyOwnership.createMany({ data: ownerships.map((o) => ({ propertyId: id, ...o, startDate: old.createdAt })) });
        } else {
          // A transfer: close the current rows and start the new split now (history stays with the previous owners).
          const now = new Date();
          await tx.propertyOwnership.updateMany({ where: { propertyId: id, endDate: null }, data: { endDate: now } });
          await tx.propertyOwnership.createMany({ data: ownerships.map((o) => ({ propertyId: id, ...o, startDate: now })) });
        }
      }
    });
    await audit({ user, action: "UPDATE", entityType: "PROPERTY", entityId: id, entityLabel: parsed.data.name, oldValue: { name: old.name, status: old.status, type: old.type, managerId: old.managerId }, newValue: parsed.data });
    revalidatePath(`/properties/${id}`);
    redirect(`/properties/${id}?toast=updated`);
  } catch (e) {
    return actionFailure(e);
  }
}

export async function archiveProperty(formData: FormData) {
  try {
    const user = await requireStaff();
    assertCan(user, "properties.manage");
    const id = String(formData.get("id"));
    const p = await db.property.findFirst({ where: { id, organizationId: user.organizationId, ...propertyScope(user) }, include: { _count: { select: { contracts: { where: { status: { in: ["ACTIVE", "EXPIRING_SOON", "RENEWAL_PENDING"] } } } } } } });
    if (!p) return;
    if (p._count.contracts > 0) throw new Error("لا يمكن أرشفة عقار لديه عقود نشطة.");
  const pending = await db.contract.count({ where: { propertyId: id, organizationId: user.organizationId, status: { in: ["DRAFT", "PENDING_APPROVAL"] } } });
  if (pending > 0) throw new Error("لا يمكن أرشفة عقار عليه عقود مسودة أو بانتظار الاعتماد. ألغها أولًا.");
  // Unpaid rent must stay visible in collections: archiving would hide it from the board.
  const arrears = await db.installment.count({ where: { organizationId: user.organizationId, contract: { propertyId: id }, status: { in: ["DUE", "OVERDUE", "PARTIALLY_PAID"] } } });
  if (arrears > 0) throw new Error("لا يمكن أرشفة عقار عليه دفعات غير مسددة. حصّلها أو أعفِ منها أولًا.");
    await db.property.update({ where: { id }, data: { status: "ARCHIVED" } });
    await db.unit.updateMany({ where: { propertyId: id, organizationId: user.organizationId }, data: { status: "ARCHIVED" } });
    await audit({ user, action: "ARCHIVE", entityType: "PROPERTY", entityId: id, entityLabel: p.name, oldValue: { status: p.status }, newValue: { status: "ARCHIVED" } });
    revalidatePath("/properties");
    redirect("/properties?toast=archived");
  } catch (e) {
    await failFromError(e);
  }
}

export async function restoreProperty(formData: FormData) {
  try {
    const user = await requireStaff();
    assertCan(user, "properties.manage");
    const id = String(formData.get("id"));
    const p = await db.property.findFirst({ where: { id, organizationId: user.organizationId, ...propertyScope(user) }, select: { id: true, name: true, status: true } });
    if (!p || p.status !== "ARCHIVED") return;
    await db.property.update({ where: { id: p.id }, data: { status: "ACTIVE" } });
    await db.unit.updateMany({ where: { propertyId: p.id, organizationId: user.organizationId, status: "ARCHIVED" }, data: { status: "VACANT" } });
    await audit({ user, action: "UPDATE", entityType: "PROPERTY", entityId: p.id, entityLabel: p.name, oldValue: { status: p.status }, newValue: { status: "ACTIVE" } });
    revalidatePath(`/properties/${id}`);
  } catch (e) {
    await failFromError(e);
  }
}
