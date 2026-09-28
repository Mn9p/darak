"use server";


import { actionFailure, failFromError } from "@/lib/action-error";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { assertCan, isScoped } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { nextCode } from "@/lib/codes";
import { OWNER_STATUS, PARTY_TYPES, RISK_LEVELS } from "@/lib/constants";
import { putFile, MAX_FILE_BYTES, MAX_FILE_MB } from "@/lib/storage";
import { normalizePhone } from "@/lib/phone";
import type { FormState } from "@/components/ui";

const ACTIVE_CONTRACT = ["ACTIVE", "EXPIRING_SOON", "RENEWAL_PENDING"];

const schema = z
  .object({
    type: z.string().refine((v) => v in PARTY_TYPES, "نوع المستأجر غير صالح"),
    name: z.string().trim().min(2, "اسم المستأجر مطلوب"),
    nationalId: z.string().trim().optional().nullable(),
    idExpiry: z.coerce.date().optional().nullable(),
    crNumber: z.string().trim().optional().nullable(),
    vatNumber: z.string().trim().optional().nullable(),
    representative: z.string().trim().optional().nullable(),
    // Stored normalized (9665XXXXXXXX) so the tenant portal sign-in matches this number exactly.
    phone: z
      .string({ required_error: "رقم الجوال مطلوب", invalid_type_error: "رقم الجوال مطلوب" })
      .trim()
      .min(1, "رقم الجوال مطلوب")
      .transform((v, ctx) => {
        const n = normalizePhone(v);
        if (!n) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "رقم الجوال غير صحيح (مثال: 05XXXXXXXX)." });
          return z.NEVER;
        }
        return n;
      }),
    email: z.string().trim().email("البريد الإلكتروني غير صالح").optional().nullable(),
    address: z.string().trim().optional().nullable(),
    employer: z.string().trim().optional().nullable(),
    altContactName: z.string().trim().optional().nullable(),
    altContactPhone: z.string().trim().optional().nullable(),
    riskLevel: z
      .string()
      .refine((v) => v in RISK_LEVELS, "مستوى المخاطر غير صالح")
      .default("LOW"),
    tags: z.string().optional().default(""),
    notes: z.string().optional().nullable(),
    status: z
      .string()
      .refine((v) => v in OWNER_STATUS, "الحالة غير صالحة")
      .default("ACTIVE"),
  });
// nationalId / crNumber are optional (they can be completed later, and the contract form creates tenants inline
// with only a name and phone). Duplicates are still rejected when a value is present — see findDuplicate().

function parse(formData: FormData) {
  const raw: Record<string, unknown> = {};
  formData.forEach((v, k) => {
    if (k === "id" || k === "idFile") return;
    raw[k] = v === "" ? null : v;
  });
  raw.tags = raw.tags ?? "";
  return schema.safeParse(raw);
}

/** Optional ID / CR scan → private storage + Document (type ID or CR) linked to the tenant. */
async function attachIdDocument(user: Awaited<ReturnType<typeof requireStaff>>, tenant: { id: string; name: string; type: string; idExpiry: Date | null }, formData: FormData) {
  const f = formData.get("idFile");
  if (!(f instanceof File) || f.size === 0) return null;
  const stored = await putFile({ organizationId: user.organizationId, entity: "TENANT", file: f, uploadedById: user.id });
  const isCompany = tenant.type === "COMPANY";
  const doc = await db.document.create({
    data: {
      organizationId: user.organizationId,
      name: `${isCompany ? "السجل التجاري" : "الهوية"} — ${tenant.name}`,
      type: isCompany ? "CR" : "ID",
      entityType: "TENANT",
      entityId: tenant.id,
      entityLabel: tenant.name,
      expiryDate: isCompany ? null : tenant.idExpiry,
      visibility: "INTERNAL",
      tags: `ملف: ${stored.name}`,
      uploadedById: user.id,
      url: stored.url,
      sizeKb: Math.max(1, Math.round(stored.sizeBytes / 1024)),
      version: 1,
    },
  });
  await audit({ user, action: "CREATE", entityType: "DOCUMENT", entityId: doc.id, entityLabel: doc.name, newValue: { type: doc.type, entityType: "TENANT", entityId: tenant.id, file: stored.name, size: stored.sizeBytes, contentType: stored.contentType } });
  return doc;
}

/** Duplicate identity guard inside the organization (nationalId / crNumber). */
async function findDuplicate(org: string, d: { nationalId?: string | null; crNumber?: string | null }, excludeId?: string) {
  const or: { nationalId?: string; crNumber?: string }[] = [];
  if (d.nationalId) or.push({ nationalId: d.nationalId });
  if (d.crNumber) or.push({ crNumber: d.crNumber });
  if (!or.length) return null;
  return db.tenant.findFirst({ where: { organizationId: org, OR: or, status: { not: "ARCHIVED" }, ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { id: true, name: true, code: true } });
}

function scopeFor(user: Awaited<ReturnType<typeof requireStaff>>) {
  return isScoped(user) ? { contracts: { some: { propertyId: { in: user.assignedPropertyIds } } } } : {};
}

export async function createTenant(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await requireStaff();
    assertCan(user, "tenants.manage");
    const parsed = parse(formData);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const data = parsed.data;
    if (data.status === "ARCHIVED") return { error: "لا يمكن إنشاء مستأجر بحالة مؤرشفة." };
    const dup = await findDuplicate(user.organizationId, data);
    if (dup) return { error: `يوجد مستأجر مسجل بنفس رقم الهوية أو السجل: ${dup.name} (${dup.code}).` };

    // Validate the ID scan (type/size) before creating the tenant so a bad file never leaves a half-registered record.
    const idFile = formData.get("idFile");
    if (idFile instanceof File && idFile.size > 0) {
      if (idFile.size > MAX_FILE_BYTES) return { error: `حجم صورة الهوية يتجاوز الحد المسموح (${MAX_FILE_MB}MB).` };
      if (!/^(image\/|application\/pdf$)/.test(idFile.type)) return { error: "صورة الهوية / السجل التجاري يجب أن تكون PDF أو صورة." };
    }

    const code = await nextCode(user.organizationId, "tenant");
    const t = await db.tenant.create({ data: { ...data, organizationId: user.organizationId, code } });
    await audit({ user, action: "CREATE", entityType: "TENANT", entityId: t.id, entityLabel: t.name, newValue: data });
    try {
      await attachIdDocument(user, { id: t.id, name: t.name, type: t.type, idExpiry: t.idExpiry }, formData);
    } catch (e) {
      console.error("tenant id document upload failed", e);
      revalidatePath("/tenants");
      redirect(`/tenants/${t.id}?toast=${encodeURIComponent(`تم إنشاء المستأجر ${t.code}، لكن تعذر حفظ صورة الهوية. ارفعها من تبويب المستندات.`)}`);
    }
    revalidatePath("/tenants");
    redirect(`/tenants/${t.id}?toast=created`);
  } catch (e) {
    return actionFailure(e);
  }
}

export async function updateTenant(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await requireStaff();
    assertCan(user, "tenants.manage");
    const id = String(formData.get("id"));
    const parsed = parse(formData);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const data = parsed.data;
    const old = await db.tenant.findFirst({ where: { id, organizationId: user.organizationId, ...scopeFor(user) } });
    if (!old) return { error: "المستأجر غير موجود." };
    if (old.status === "ARCHIVED") return { error: "المستأجر مؤرشف. استعده أولًا قبل التعديل." };
    if (data.status === "ARCHIVED") return { error: "استخدم إجراء الأرشفة من صفحة المستأجر." };
    const dup = await findDuplicate(user.organizationId, data, id);
    if (dup) return { error: `يوجد مستأجر آخر بنفس رقم الهوية أو السجل: ${dup.name} (${dup.code}).` };

    await db.tenant.update({ where: { id }, data });
    await audit({
      user,
      action: "UPDATE",
      entityType: "TENANT",
      entityId: id,
      entityLabel: data.name,
      oldValue: { name: old.name, type: old.type, phone: old.phone, nationalId: old.nationalId, crNumber: old.crNumber, riskLevel: old.riskLevel, status: old.status },
      newValue: data,
    });
    revalidatePath(`/tenants/${id}`);
    revalidatePath("/tenants");
    redirect(`/tenants/${id}?toast=updated`);
  } catch (e) {
    return actionFailure(e);
  }
}

/** One-click risk level change from the Tenant 360 page. */
export async function setRisk(formData: FormData) {
  try {
    const user = await requireStaff();
    assertCan(user, "tenants.manage");
    const id = String(formData.get("id"));
    const riskLevel = String(formData.get("riskLevel") ?? "");
    const reason = String(formData.get("reason") ?? "").trim();
    if (!(riskLevel in RISK_LEVELS)) throw new Error("مستوى المخاطر غير صالح.");
    const t = await db.tenant.findFirst({ where: { id, organizationId: user.organizationId, ...scopeFor(user) }, select: { id: true, name: true, riskLevel: true } });
    if (!t) throw new Error("المستأجر غير موجود.");
    if (t.riskLevel === riskLevel) return;
    await db.tenant.update({ where: { id }, data: { riskLevel } });
    await audit({ user, action: "STATUS_CHANGE", entityType: "TENANT", entityId: id, entityLabel: t.name, oldValue: { riskLevel: t.riskLevel }, newValue: { riskLevel, reason: reason || undefined } });
    revalidatePath(`/tenants/${id}`);
    revalidatePath("/tenants");
  } catch (e) {
    await failFromError(e);
  }
}

export async function archiveTenant(formData: FormData) {
  try {
    const user = await requireStaff();
    assertCan(user, "tenants.manage");
    const id = String(formData.get("id"));
    const t = await db.tenant.findFirst({
      where: { id, organizationId: user.organizationId, ...scopeFor(user) },
      include: { _count: { select: { contracts: { where: { status: { in: ACTIVE_CONTRACT } } }, installments: { where: { status: { in: ["DUE", "OVERDUE", "PARTIALLY_PAID"] } } } } } },
    });
    if (!t) return;
    if (t._count.contracts > 0) throw new Error("لا يمكن أرشفة مستأجر لديه عقود نشطة.");
    if (t._count.installments > 0) throw new Error("لا يمكن أرشفة مستأجر لديه أقساط مستحقة أو متأخرة.");
    await db.tenant.update({ where: { id }, data: { status: "ARCHIVED" } });
    await audit({ user, action: "ARCHIVE", entityType: "TENANT", entityId: id, entityLabel: t.name, oldValue: { status: t.status }, newValue: { status: "ARCHIVED" } });
    revalidatePath("/tenants");
    redirect("/tenants?toast=archived");
  } catch (e) {
    await failFromError(e);
  }
}

export async function restoreTenant(formData: FormData) {
  try {
    const user = await requireStaff();
    assertCan(user, "tenants.manage");
    const id = String(formData.get("id"));
    const t = await db.tenant.findFirst({ where: { id, organizationId: user.organizationId, ...scopeFor(user) }, select: { id: true, name: true, status: true } });
    if (!t) return;
    await db.tenant.update({ where: { id }, data: { status: "ACTIVE" } });
    await audit({ user, action: "UPDATE", entityType: "TENANT", entityId: id, entityLabel: t.name, oldValue: { status: t.status }, newValue: { status: "ACTIVE" } });
    revalidatePath(`/tenants/${id}`);
    revalidatePath("/tenants");
  } catch (e) {
    await failFromError(e);
  }
}
