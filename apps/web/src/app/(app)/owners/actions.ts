"use server";


import { actionFailure, failFromError } from "@/lib/action-error";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { assertCan, can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { nextCode } from "@/lib/codes";
import { OWNER_STATUS, PARTY_TYPES } from "@/lib/constants";
import { putFile, MAX_FILE_BYTES, MAX_FILE_MB } from "@/lib/storage";
import { normalizePhone } from "@/lib/phone";
import type { FormState } from "@/components/ui";

const schema = z
  .object({
    type: z.string().refine((v) => v in PARTY_TYPES, "نوع المالك غير صالح"),
    name: z.string().trim().min(2, "اسم المالك مطلوب"),
    nationalId: z.string().trim().optional().nullable(),
    crNumber: z.string().trim().optional().nullable(),
    vatNumber: z.string().trim().optional().nullable(),
    representative: z.string().trim().optional().nullable(),
    // Stored normalized (9665XXXXXXXX) so the owner portal sign-in matches this number exactly.
    phone: z
      .string()
      .trim()
      .optional()
      .nullable()
      .transform((v, ctx) => {
        if (!v) return null;
        const n = normalizePhone(v);
        if (!n) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "رقم الجوال غير صحيح (مثال: 05XXXXXXXX)." });
          return z.NEVER;
        }
        return n;
      }),
    email: z.string().trim().email("البريد الإلكتروني غير صالح").optional().nullable(),
    nationality: z.string().trim().optional().nullable(),
    address: z.string().trim().optional().nullable(),
    iban: z.string().trim().optional().nullable(),
    bankName: z.string().trim().optional().nullable(),
    managementFeePct: z.coerce.number().min(0, "نسبة الأتعاب غير صالحة").max(100, "نسبة الأتعاب لا تتجاوز 100%").default(5),
    agreementTerms: z.string().optional().nullable(),
    managementStartDate: z.coerce.date().optional().nullable(),
    accountManagerId: z.string().optional().nullable(),
    tags: z.string().optional().default(""),
    notes: z.string().optional().nullable(),
    status: z
      .string()
      .refine((v) => v in OWNER_STATUS, "الحالة غير صالحة")
      .default("ACTIVE"),
  })
  .superRefine((d, ctx) => {
    // crNumber is optional for companies; it can be completed later from the owner's page.
    if (d.iban) {
      const v = d.iban.replace(/\s+/g, "").toUpperCase();
      if (!/^SA\d{22}$/.test(v)) ctx.addIssue({ code: "custom", path: ["iban"], message: "رقم الآيبان غير صالح — يبدأ بـ SA ويتكون من 24 خانة." });
    }
  });

function parse(formData: FormData) {
  const raw: Record<string, unknown> = {};
  formData.forEach((v, k) => {
    if (k === "id" || k === "idFile") return;
    raw[k] = v === "" ? null : v;
  });
  raw.tags = raw.tags ?? "";
  return schema.safeParse(raw);
}

function normalizeIban(v: string | null | undefined) {
  return v ? v.replace(/\s+/g, "").toUpperCase() : null;
}

/** Optional ID / CR scan → private storage + Document (type ID or CR) linked to the owner. */
async function attachIdDocument(user: Awaited<ReturnType<typeof requireStaff>>, owner: { id: string; name: string; type: string }, formData: FormData) {
  const f = formData.get("idFile");
  if (!(f instanceof File) || f.size === 0) return null;
  const stored = await putFile({ organizationId: user.organizationId, entity: "OWNER", file: f, uploadedById: user.id });
  const isCompany = owner.type === "COMPANY";
  const doc = await db.document.create({
    data: {
      organizationId: user.organizationId,
      name: `${isCompany ? "السجل التجاري" : "الهوية"} — ${owner.name}`,
      type: isCompany ? "CR" : "ID",
      entityType: "OWNER",
      entityId: owner.id,
      entityLabel: owner.name,
      visibility: "INTERNAL",
      tags: `ملف: ${stored.name}`,
      uploadedById: user.id,
      url: stored.url,
      sizeKb: Math.max(1, Math.round(stored.sizeBytes / 1024)),
      version: 1,
    },
  });
  await audit({ user, action: "CREATE", entityType: "DOCUMENT", entityId: doc.id, entityLabel: doc.name, newValue: { type: doc.type, entityType: "OWNER", entityId: owner.id, file: stored.name, size: stored.sizeBytes, contentType: stored.contentType } });
  return doc;
}

export async function createOwner(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await requireStaff();
    assertCan(user, "owners.manage");
    const parsed = parse(formData);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const data = { ...parsed.data, iban: normalizeIban(parsed.data.iban) };
    if (data.status === "ARCHIVED") return { error: "لا يمكن إنشاء مالك بحالة مؤرشفة." };
    // Bank data is gated by owners.financial
    if (!can(user, "owners.financial")) {
      data.iban = null;
      data.bankName = null;
    }
    if (data.accountManagerId) {
      const m = await db.user.findFirst({ where: { id: data.accountManagerId, organizationId: user.organizationId }, select: { id: true } });
      if (!m) return { error: "مدير الحساب المحدد غير موجود." };
    }
    // Validate the ID scan (type/size) before creating the owner so a bad file never leaves a half-registered record.
    const idFile = formData.get("idFile");
    if (idFile instanceof File && idFile.size > 0) {
      if (idFile.size > MAX_FILE_BYTES) return { error: `حجم صورة الهوية يتجاوز الحد المسموح (${MAX_FILE_MB}MB).` };
      if (!/^(image\/|application\/pdf$)/.test(idFile.type)) return { error: "صورة الهوية / السجل التجاري يجب أن تكون PDF أو صورة." };
    }

    const code = await nextCode(user.organizationId, "owner");
    const o = await db.owner.create({ data: { ...data, organizationId: user.organizationId, code } });
    await audit({ user, action: "CREATE", entityType: "OWNER", entityId: o.id, entityLabel: o.name, newValue: { ...data, iban: data.iban ? `****${data.iban.slice(-4)}` : null } });
    try {
      await attachIdDocument(user, { id: o.id, name: o.name, type: o.type }, formData);
    } catch (e) {
      console.error("owner id document upload failed", e);
      revalidatePath("/owners");
      redirect(`/owners/${o.id}?toast=${encodeURIComponent(`تم إنشاء المالك ${o.code}، لكن تعذر حفظ صورة الهوية. ارفعها من تبويب المستندات.`)}`);
    }
    revalidatePath("/owners");
    redirect(`/owners/${o.id}?toast=created`);
  } catch (e) {
    return actionFailure(e);
  }
}

export async function updateOwner(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await requireStaff();
    assertCan(user, "owners.manage");
    const id = String(formData.get("id"));
    const parsed = parse(formData);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const old = await db.owner.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!old) return { error: "المالك غير موجود." };
    if (old.status === "ARCHIVED") return { error: "المالك مؤرشف. استعده أولًا قبل التعديل." };
    if (parsed.data.status === "ARCHIVED") return { error: "استخدم إجراء الأرشفة من صفحة المالك." };

    const data: typeof parsed.data = { ...parsed.data, iban: normalizeIban(parsed.data.iban) };
    if (!can(user, "owners.financial")) {
      // keep existing bank data untouched for users without financial access
      data.iban = old.iban;
      data.bankName = old.bankName;
    }
    if (data.accountManagerId) {
      const m = await db.user.findFirst({ where: { id: data.accountManagerId, organizationId: user.organizationId }, select: { id: true } });
      if (!m) return { error: "مدير الحساب المحدد غير موجود." };
    }
    await db.owner.update({ where: { id }, data });
    await audit({
      user,
      action: "UPDATE",
      entityType: "OWNER",
      entityId: id,
      entityLabel: data.name,
      oldValue: { name: old.name, type: old.type, phone: old.phone, managementFeePct: old.managementFeePct, accountManagerId: old.accountManagerId, status: old.status, iban: old.iban ? `****${old.iban.slice(-4)}` : null },
      newValue: { ...data, iban: data.iban ? `****${data.iban.slice(-4)}` : null },
    });
    revalidatePath(`/owners/${id}`);
    revalidatePath("/owners");
    redirect(`/owners/${id}?toast=updated`);
  } catch (e) {
    return actionFailure(e);
  }
}

export async function archiveOwner(formData: FormData) {
  try {
    const user = await requireStaff();
    assertCan(user, "owners.manage");
    const id = String(formData.get("id"));
    const o = await db.owner.findFirst({
      where: { id, organizationId: user.organizationId },
      include: { _count: { select: { ownerships: { where: { endDate: null } }, contracts: { where: { status: { in: ["ACTIVE", "EXPIRING_SOON", "RENEWAL_PENDING"] } } } } } },
    });
    if (!o) return;
    if (o._count.ownerships > 0) throw new Error("لا يمكن أرشفة مالك لديه ملكيات حالية. أنهِ الملكية من صفحة العقار أولًا.");
    if (o._count.contracts > 0) throw new Error("لا يمكن أرشفة مالك لديه عقود نشطة.");
    await db.owner.update({ where: { id }, data: { status: "ARCHIVED" } });
    await audit({ user, action: "ARCHIVE", entityType: "OWNER", entityId: id, entityLabel: o.name, oldValue: { status: o.status }, newValue: { status: "ARCHIVED" } });
    revalidatePath("/owners");
    redirect("/owners?toast=archived");
  } catch (e) {
    await failFromError(e);
  }
}

export async function restoreOwner(formData: FormData) {
  try {
    const user = await requireStaff();
    assertCan(user, "owners.manage");
    const id = String(formData.get("id"));
    const o = await db.owner.findFirst({ where: { id, organizationId: user.organizationId }, select: { id: true, name: true, status: true } });
    if (!o) return;
    await db.owner.update({ where: { id }, data: { status: "ACTIVE" } });
    await audit({ user, action: "UPDATE", entityType: "OWNER", entityId: id, entityLabel: o.name, oldValue: { status: o.status }, newValue: { status: "ACTIVE" } });
    revalidatePath(`/owners/${id}`);
    revalidatePath("/owners");
  } catch (e) {
    await failFromError(e);
  }
}
