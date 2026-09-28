"use server";


import { actionFailure, failFromError } from "@/lib/action-error";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireStaff, loginAllowed } from "@/lib/auth";
import { assertCan } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { notify, emailRoles } from "@/lib/notify";
import { DEFAULT_ORG_SETTINGS } from "@/lib/constants";
import { safeJson } from "@/lib/format";
import { normalizePhone, displayPhone } from "@/lib/phone";
import { requestOtp, verifyOtp, OTP_RESEND_SECONDS, authSecret } from "@/lib/otp";
import { clientIp } from "@/lib/ratelimit";
import { sendMessage } from "@/lib/channels";
import { logger, maskPhone } from "@/lib/logger";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import type { FormState } from "@/components/ui";
import { readSettings, writeSettings, type CustomFieldEntity, type ExtSettings } from "./lib";

const parseList = (v: unknown) =>
  String(v ?? "")
    .split(/[،,\s]+/)
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => b - a);

/* ───────────── Organization profile & policies ───────────── */

const orgSchema = z.object({
  name: z.string().min(2, "اسم المكتب مطلوب"),
  crNumber: z.string().optional().nullable(),
  vatNumber: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().email("البريد الإلكتروني غير صالح").optional().nullable().or(z.literal("")),
  city: z.string().optional().nullable(),
  autoApproveLimit: z.coerce.number().min(0),
  managerApprovalLimit: z.coerce.number().min(0),
  graceDays: z.coerce.number().int().min(0).max(60),
  statutoryGrace: z.string().optional().nullable(),
  dueSoonDays: z.coerce.number().int().min(1).max(90),
  vatRate: z.coerce.number().min(0).max(100),
  bankName: z.string().max(80).optional().nullable(),
  bankAccountName: z.string().max(120).optional().nullable(),
  bankIban: z
    .string()
    .optional()
    .nullable()
    .transform((v) => (v ? v.replace(/\s+/g, "").toUpperCase() : null))
    .refine((v) => !v || /^SA\d{22}$/.test(v), "رقم الآيبان يجب أن يكون سعوديًا: SA متبوعًا بـ 22 رقمًا."),
});

export async function updateOrganization(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await requireStaff();
    assertCan(user, "settings.manage");
    const raw: Record<string, unknown> = {};
    formData.forEach((v, k) => (raw[k] = v === "" ? null : v));
    const parsed = orgSchema.safeParse(raw);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;
    if (d.autoApproveLimit > d.managerApprovalLimit) return { error: "حد الاعتماد التلقائي يجب ألا يتجاوز حد اعتماد المحاسب." };
    const org = await db.organization.findUnique({ where: { id: user.organizationId } });
    if (!org) return { error: "المكتب غير موجود." };
    const current = await readSettings(user.organizationId);
    const next: ExtSettings = {
      ...current,
      autoApproveLimit: d.autoApproveLimit,
      managerApprovalLimit: d.managerApprovalLimit,
      graceDays: d.graceDays,
      statutoryGrace: d.statutoryGrace === "1",
      dueSoonDays: d.dueSoonDays,
      vatRate: d.vatRate,
      contractExpiryAlerts: parseList(formData.get("contractExpiryAlerts")).length ? parseList(formData.get("contractExpiryAlerts")) : DEFAULT_ORG_SETTINGS.contractExpiryAlerts,
      documentExpiryAlerts: parseList(formData.get("documentExpiryAlerts")).length ? parseList(formData.get("documentExpiryAlerts")) : DEFAULT_ORG_SETTINGS.documentExpiryAlerts,
      bank: { bankName: d.bankName?.trim() || null, iban: d.bankIban || null, accountName: d.bankAccountName?.trim() || null },
    };
    await db.organization.update({
      where: { id: org.id },
      data: { name: d.name, crNumber: d.crNumber, vatNumber: d.vatNumber, phone: d.phone, email: d.email || null, city: d.city, settings: JSON.stringify(next) },
    });
    await audit({
      user,
      action: "UPDATE",
      entityType: "SETTINGS",
      entityId: org.id,
      entityLabel: d.name,
      oldValue: { name: org.name, crNumber: org.crNumber, vatNumber: org.vatNumber, phone: org.phone, email: org.email, city: org.city, settings: current },
      newValue: { ...d, settings: next },
    });
    revalidatePath("/settings");
    revalidatePath("/settings/organization");
    return { success: "تم حفظ إعدادات المكتب." };
  } catch (e) {
    return actionFailure(e);
  }
}

/* ───────────── Onboarding checklist ───────────── */

export async function toggleOnboarding(formData: FormData) {
  try {
    const user = await requireStaff();
    assertCan(user, "settings.manage");
    const key = String(formData.get("key"));
    const value = String(formData.get("value")) === "1";
    if (!["review", "live"].includes(key)) return;
    const org = await db.organization.findUnique({ where: { id: user.organizationId }, select: { onboarding: true } });
    const ob = safeJson<Record<string, boolean>>(org?.onboarding, {});
    const next = { ...ob, [key]: value };
    await db.organization.update({ where: { id: user.organizationId }, data: { onboarding: JSON.stringify(next) } });
    await audit({ user, action: "UPDATE", entityType: "SETTINGS", entityId: user.organizationId, entityLabel: "قائمة الجاهزية", oldValue: { [key]: ob[key] ?? false }, newValue: { [key]: value } });
    revalidatePath("/settings");
  } catch (e) {
    await failFromError(e);
  }
}

/* ───────────── Branches ───────────── */

const branchSchema = z.object({
  name: z.string().min(2, "اسم الفرع مطلوب"),
  city: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
});

function parseBranch(formData: FormData) {
  const raw: Record<string, unknown> = {};
  formData.forEach((v, k) => {
    if (k !== "id") raw[k] = v === "" ? null : v;
  });
  return branchSchema.safeParse(raw);
}

export async function createBranch(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await requireStaff();
    assertCan(user, "settings.manage");
    const parsed = parseBranch(formData);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const count = await db.branch.count({ where: { organizationId: user.organizationId } });
    const b = await db.branch.create({ data: { ...parsed.data, organizationId: user.organizationId, isMain: count === 0 } });
    await audit({ user, action: "CREATE", entityType: "BRANCH", entityId: b.id, entityLabel: b.name, newValue: parsed.data });
    revalidatePath("/settings/branches");
    redirect("/settings/branches?toast=created");
  } catch (e) {
    return actionFailure(e);
  }
}

export async function updateBranch(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await requireStaff();
    assertCan(user, "settings.manage");
    const id = String(formData.get("id"));
    const parsed = parseBranch(formData);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const old = await db.branch.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!old) return { error: "الفرع غير موجود." };
    await db.branch.update({ where: { id }, data: parsed.data });
    await audit({ user, action: "UPDATE", entityType: "BRANCH", entityId: id, entityLabel: parsed.data.name, oldValue: { name: old.name, city: old.city, address: old.address, phone: old.phone }, newValue: parsed.data });
    revalidatePath("/settings/branches");
    redirect("/settings/branches?toast=updated");
  } catch (e) {
    return actionFailure(e);
  }
}

export async function setMainBranch(formData: FormData) {
  try {
    const user = await requireStaff();
    assertCan(user, "settings.manage");
    const id = String(formData.get("id"));
    const b = await db.branch.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!b) return;
    await db.$transaction([
      db.branch.updateMany({ where: { organizationId: user.organizationId }, data: { isMain: false } }),
      db.branch.update({ where: { id }, data: { isMain: true } }),
    ]);
    await audit({ user, action: "UPDATE", entityType: "BRANCH", entityId: id, entityLabel: b.name, newValue: { isMain: true } });
    revalidatePath("/settings/branches");
  } catch (e) {
    await failFromError(e);
  }
}

/* ───────────── Custom fields & tags ───────────── */

const CF_ENTITIES: CustomFieldEntity[] = ["PROPERTY", "UNIT", "TENANT", "OWNER"];

export async function addCustomField(formData: FormData) {
  try {
    const user = await requireStaff();
    assertCan(user, "settings.manage");
    const entity = String(formData.get("entity")) as CustomFieldEntity;
    const key = String(formData.get("key") ?? "").trim().slice(0, 40);
    if (!CF_ENTITIES.includes(entity) || !key) return;
    const s = await readSettings(user.organizationId);
    if (s.customFields[entity].includes(key)) return;
    const next = { ...s, customFields: { ...s.customFields, [entity]: [...s.customFields[entity], key] } };
    await writeSettings(user.organizationId, next);
    await audit({ user, action: "UPDATE", entityType: "SETTINGS", entityId: user.organizationId, entityLabel: `حقل مخصص — ${entity}`, oldValue: s.customFields[entity], newValue: next.customFields[entity] });
    revalidatePath("/settings/custom-fields");
  } catch (e) {
    await failFromError(e);
  }
}

export async function removeCustomField(formData: FormData) {
  try {
    const user = await requireStaff();
    assertCan(user, "settings.manage");
    const entity = String(formData.get("entity")) as CustomFieldEntity;
    const key = String(formData.get("key") ?? "");
    if (!CF_ENTITIES.includes(entity)) return;
    const s = await readSettings(user.organizationId);
    const next = { ...s, customFields: { ...s.customFields, [entity]: s.customFields[entity].filter((k) => k !== key) } };
    await writeSettings(user.organizationId, next);
    await audit({ user, action: "UPDATE", entityType: "SETTINGS", entityId: user.organizationId, entityLabel: `حقل مخصص — ${entity}`, oldValue: s.customFields[entity], newValue: next.customFields[entity] });
    revalidatePath("/settings/custom-fields");
  } catch (e) {
    await failFromError(e);
  }
}

export async function addTag(formData: FormData) {
  try {
    const user = await requireStaff();
    assertCan(user, "settings.manage");
    const tag = String(formData.get("tag") ?? "").trim().slice(0, 40);
    if (!tag) return;
    const s = await readSettings(user.organizationId);
    if (s.tags.includes(tag)) return;
    const next = { ...s, tags: [...s.tags, tag] };
    await writeSettings(user.organizationId, next);
    await audit({ user, action: "UPDATE", entityType: "SETTINGS", entityId: user.organizationId, entityLabel: "الوسوم", oldValue: s.tags, newValue: next.tags });
    revalidatePath("/settings/custom-fields");
  } catch (e) {
    await failFromError(e);
  }
}

export async function removeTag(formData: FormData) {
  try {
    const user = await requireStaff();
    assertCan(user, "settings.manage");
    const tag = String(formData.get("tag") ?? "");
    const s = await readSettings(user.organizationId);
    const next = { ...s, tags: s.tags.filter((t) => t !== tag) };
    await writeSettings(user.organizationId, next);
    await audit({ user, action: "UPDATE", entityType: "SETTINGS", entityId: user.organizationId, entityLabel: "الوسوم", oldValue: s.tags, newValue: next.tags });
    revalidatePath("/settings/custom-fields");
  } catch (e) {
    await failFromError(e);
  }
}

/* ───────────── Security (current user) ───────────── */

export async function revokeSession(formData: FormData) {
  try {
    const user = await requireStaff();
    const id = String(formData.get("id"));
    const s = await db.session.findFirst({ where: { id, userId: user.id } });
    if (!s) return;
    await db.session.update({ where: { id }, data: { revokedAt: new Date() } });
    await audit({ user, action: "LOGOUT", entityType: "SESSION", entityId: id, entityLabel: s.device ?? undefined, newValue: { revoked: true } });
    revalidatePath("/settings/security");
    revalidatePath("/settings/profile");
  } catch (e) {
    await failFromError(e);
  }
}

export async function createPdplRequest(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await requireStaff();
    const type = String(formData.get("type") ?? "").trim();
    const subject = String(formData.get("subject") ?? "").trim();
    const body = String(formData.get("body") ?? "").trim();
    if (!type || !subject || body.length < 10) return { error: "يرجى تحديد نوع الطلب وكتابة وصف لا يقل عن 10 أحرف." };
    const t = await db.supportTicket.create({
      data: { organizationId: user.organizationId, userId: user.id, subject: `[PDPL] ${type} — ${subject}`.slice(0, 180), body, priority: "HIGH", status: "OPEN" },
    });
    await audit({ user, action: "CREATE", entityType: "SUPPORT_TICKET", entityId: t.id, entityLabel: t.subject, newValue: { type, priority: "HIGH" } });
    await notify({ organizationId: user.organizationId, roles: ["OFFICE_MANAGER"], title: `طلب صاحب بيانات (PDPL): ${type}`, body: subject, severity: "WARNING", entityType: "SUPPORT_TICKET", entityId: t.id, href: "/help" });
    // Email office managers — PDPL requests have a statutory response window. Never throws.
    await emailRoles({
      organizationId: user.organizationId,
      roles: ["OFFICE_MANAGER"],
      subject: `طلب صاحب بيانات (PDPL): ${type} — ${subject}`,
      body: `ورد طلب صاحب بيانات من ${user.name}.\n\nالنوع: ${type}\nالموضوع: ${subject}\n\n${body}\n\nالمدة النظامية للرد: 30 يومًا كحد أقصى.\nللمتابعة: ${process.env.APP_URL ?? ""}/help?tab=tickets`,
      entityType: "SUPPORT_TICKET",
      entityId: t.id,
    });
    revalidatePath("/settings/security");
    return { success: "تم تسجيل الطلب. سيتم الرد خلال المدة النظامية (30 يومًا كحد أقصى)." };
  } catch (e) {
    return actionFailure(e);
  }
}

/* ───────────── Subscription ───────────── */

export async function requestUpgrade(formData: FormData) {
  try {
    const user = await requireStaff();
    assertCan(user, "settings.manage");
    const plan = String(formData.get("plan") ?? "");
    const org = await db.organization.findUnique({ where: { id: user.organizationId }, select: { plan: true, name: true } });
    if (!org) return;
    const t = await db.supportTicket.create({
      data: { organizationId: user.organizationId, userId: user.id, subject: `طلب ترقية الخطة إلى ${plan}`, body: `المكتب: ${org.name}\nالخطة الحالية: ${org.plan}\nالخطة المطلوبة: ${plan}`, priority: "MEDIUM" },
    });
    await audit({ user, action: "CREATE", entityType: "SUPPORT_TICKET", entityId: t.id, entityLabel: t.subject, newValue: { from: org.plan, to: plan } });
    await notify({ organizationId: user.organizationId, roles: ["OFFICE_MANAGER"], title: "تم إرسال طلب ترقية الخطة", body: `سيتواصل فريق دارك لإتمام الترقية إلى ${plan}.`, severity: "SUCCESS", href: "/help" });
    revalidatePath("/settings/subscription");
  } catch (e) {
    await failFromError(e);
  }
}

/* ───────────── Profile (any staff) ───────────── */

const profileSchema = z.object({
  name: z.string().min(2, "الاسم مطلوب"),
  email: z.string().email("البريد الإلكتروني غير صالح").optional().nullable().or(z.literal("")),
});

/** Name and email only. The mobile number is the login identity and changes only through the verified two-step flow below. */
export async function updateProfile(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await requireStaff();
    const parsed = profileSchema.safeParse({
      name: formData.get("name"),
      email: String(formData.get("email") ?? "").trim() || null,
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const data = { name: parsed.data.name, email: parsed.data.email || null };
    const old = await db.user.findUnique({ where: { id: user.id }, select: { name: true, email: true } });
    await db.user.update({ where: { id: user.id }, data });
    await audit({ user, action: "UPDATE", entityType: "USER", entityId: user.id, entityLabel: data.name, oldValue: old, newValue: data });
    revalidatePath("/settings/profile");
    return { success: "تم تحديث الملف الشخصي." };
  } catch (e) {
    return actionFailure(e);
  }
}

/* ───────────── Login number change (two steps: code to the NEW number, then confirm) ───────────── */

export type PhoneChangeState = {
  error?: string;
  success?: string;
  /** A code was sent to `phone`; waiting for confirmation. */
  pending?: boolean;
  phone?: string;
  /** Code shown inline while no SMS provider is configured (OTP_ECHO, never in production). */
  echo?: string;
  retryAfter?: number;
} | null;

/** Validates the new number and checks it is free for this user (unique across all accounts, any role). */
async function newPhoneFor(userId: string, raw: string): Promise<{ phone: string } | { error: string }> {
  const phone = normalizePhone(raw);
  if (!phone) return { error: "أدخل رقم جوال سعودي صحيح (مثال: 05XXXXXXXX)." };
  if (!loginAllowed(phone)) return { error: "هذا الرقم غير مسموح له بالدخول حاليًا. تواصل مع فريق دارك." };
  const me = await db.user.findUnique({ where: { id: userId }, select: { phone: true } });
  if (me?.phone === phone) return { error: "هذا هو رقمك الحالي." };
  const taken = await db.user.findUnique({ where: { phone }, select: { id: true } });
  if (taken) return { error: "هذا الرقم مستخدم لحساب آخر." };
  return { phone };
}

/** The id of the session behind the current request's cookie (so it can be kept while the others are revoked). */
async function currentSessionId(): Promise<string | null> {
  try {
    const token = (await cookies()).get("darak_session")?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, new TextEncoder().encode(authSecret()));
    return payload.sid ? String(payload.sid) : null;
  } catch {
    return null;
  }
}

/** Step 1 — sends a verification code to the new number. Nothing changes yet. */
export async function requestPhoneChangeAction(_prev: PhoneChangeState, formData: FormData): Promise<PhoneChangeState> {
  try {
    const user = await requireStaff();
    const r = await newPhoneFor(user.id, String(formData.get("newPhone") ?? ""));
    if ("error" in r) return { error: r.error };
    // Each request texts a number the user typed: cap it per account (5 per 24 h) on top of the per-number/IP OTP limits.
    const capKey = `phonechange:${user.id}`;
    const recent = await db.loginAttempt.count({ where: { key: capKey, createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } } });
    if (recent >= 5) return { error: "تم تجاوز عدد طلبات تغيير الرقم اليوم. حاول مجددًا غدًا." };
    const ip = await clientIp();
    await db.loginAttempt.create({ data: { key: capKey, ip, success: false } });
    const sent = await requestOtp(r.phone, ip);
    if (!sent.ok) return { error: sent.error, retryAfter: sent.retryAfter };
    return { pending: true, phone: r.phone, echo: sent.echo, retryAfter: sent.retryAfter ?? OTP_RESEND_SECONDS };
  } catch (e) {
    return actionFailure(e);
  }
}

/** Step 2 — verifies the code, switches the login number, signs out every other device, and tells the old number. */
export async function confirmPhoneChangeAction(_prev: PhoneChangeState, formData: FormData): Promise<PhoneChangeState> {
  try {
    const user = await requireStaff();
    const raw = String(formData.get("newPhone") ?? "");
    const code = String(formData.get("code") ?? "");
    const r = await newPhoneFor(user.id, raw);
    if ("error" in r) return { error: r.error };
    const phone = r.phone;

    const v = await verifyOtp(phone, code);
    if (!v.ok) return v.expired ? { error: v.error } : { error: v.error, pending: true, phone };

    const old = await db.user.findUnique({ where: { id: user.id }, select: { phone: true, name: true } });
    if (!old) return { error: "تعذر تغيير الرقم حاليًا." };
    await db.user.update({ where: { id: user.id }, data: { phone } });
    await audit({ user, action: "PERMISSION_CHANGE", entityType: "USER", entityId: user.id, entityLabel: old.name, oldValue: { phone: displayPhone(old.phone) }, newValue: { phone: displayPhone(phone), reason: "LOGIN_PHONE_CHANGED" } });

    // Every other session of this user ends; the device that made the change stays signed in.
    const keep = user.sessionId ?? (await currentSessionId());
    const revoked = await db.session.updateMany({ where: { userId: user.id, revokedAt: null, ...(keep ? { id: { not: keep } } : {}) }, data: { revokedAt: new Date() } });
    logger.info("profile.phone_changed", { userId: user.id, from: maskPhone(old.phone), to: maskPhone(phone), sessionsRevoked: revoked.count });

    // Tell the old number — if it was not the account holder, this is their only signal. Never blocks the change.
    await sendMessage({ channel: "SMS", to: old.phone, body: "تم تغيير رقم الدخول لحسابك في دارك. إن لم تكن أنت من قام بذلك، تواصل مع مدير مكتبك فورًا.", entityType: "USER", entityId: user.id }).catch(() => {});

    revalidatePath("/settings/profile");
    revalidatePath("/", "layout");
    return { success: `تم تغيير رقم الدخول إلى ${displayPhone(phone)}. تم إنهاء الجلسات الأخرى.` };
  } catch (e) {
    return actionFailure(e);
  }
}
