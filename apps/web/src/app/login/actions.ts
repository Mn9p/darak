"use server";


import { actionFailure } from "@/lib/action-error";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { createSession, destroySession, homeForRole, getCurrentUser, trialExpired, loginAllowed } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { clientIp } from "@/lib/ratelimit";
import { requestOtp, verifyOtp, OTP_RESEND_SECONDS } from "@/lib/otp";
import { logger, maskPhone } from "@/lib/logger";
import { normalizePhone, phoneVariants, displayPhone } from "@/lib/phone";
import type { Role } from "@/lib/constants";

export type LoginState = {
  error?: string;
  /** Step reached: "code" after the code step is shown (always, whether or not the number is registered — invite-only, no enumeration). */
  step?: "phone" | "code";
  phone?: string;
  /** Code shown inline while no SMS provider is configured (OTP_ECHO). */
  echo?: string;
  retryAfter?: number;
  ok?: boolean;
  to?: string;
} | null;

const TRIAL_EXPIRED_MSG = "انتهت الفترة التجريبية لمكتبكم. تواصل مع فريق دارك لتفعيل الاشتراك.";
const THROTTLED_MSG = "تم تجاوز عدد المحاولات المسموح. حاول مجددًا بعد 15 دقيقة.";
const RESERVED_MSG = "هذا الرقم محجوز لإدارة المنصة. تواصل مع فريق دارك.";

// Per-IP probe limit for the number step (before any lookup): 10 requests per 15 minutes.
const PROBE_WINDOW_MS = 15 * 60 * 1000;
const PROBE_MAX = 10;
// Wrong codes per IP (all numbers together) in the same window.
const VERIFY_MAX_WRONG = 20;

// `+`, `*` and `~` appear in URLSearchParams-encoded queries (e.g. a space-separated OAuth scope on /oauth/authorize).
const SAFE_PATH = /^\/[A-Za-z0-9_\-./?=&%#+*~]*$/;

/** Only same-origin relative paths: no scheme, no protocol-relative `//`, no backslashes, plain URL characters only. */
function safeNext(next: string, home: string) {
  if (!next || next === "/" || !next.startsWith("/") || next.startsWith("//") || next.includes("\\") || !SAFE_PATH.test(next) || next.startsWith("/login")) return home;
  return next;
}

type LoginUser = { id: string; name: string; phone: string; role: string; organizationId: string | null };

async function finishLogin(user: LoginUser, next: string, result = "OK"): Promise<LoginState> {
  await createSession(user.id);
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit({ user: { id: user.id, name: user.name, organizationId: user.organizationId }, action: "LOGIN", entityType: "SESSION", entityLabel: displayPhone(user.phone), newValue: { result } });
  revalidatePath("/", "layout");
  const home = homeForRole(user.role as Role, Boolean(user.organizationId));
  return { ok: true, to: safeNext(next, home) };
}

function superAdminPhones() {
  return (process.env.SUPER_ADMIN_PHONES ?? "").split(",").map((p) => normalizePhone(p)).filter((p): p is string => Boolean(p));
}

/**
 * Is there anyone behind this number? A user, an owner/tenant record, or a bootstrap admin. Invite-only: nobody else gets a code.
 * While LOGIN_ALLOWED_PHONES is set (closed test), every other number is treated as unknown.
 */
async function knownNumber(phone: string) {
  if (!loginAllowed(phone)) return false;
  if (await db.user.findUnique({ where: { phone }, select: { id: true } })) return true;
  const variants = phoneVariants(phone);
  const [owner, tenant] = await Promise.all([
    db.owner.count({ where: { phone: { in: variants }, status: { not: "ARCHIVED" } } }),
    db.tenant.count({ where: { phone: { in: variants }, status: { not: "ARCHIVED" } } }),
  ]);
  if (owner || tenant) return true;
  return superAdminPhones().includes(phone);
}

/**
 * Enumeration guard: counts number-step requests for UNKNOWN numbers per IP. Registered numbers are not counted here —
 * they are protected by the per-phone cool-down and quota inside requestOtp — so a real user retrying never trips this.
 */
async function probeLimited(ip: string) {
  const key = `probe:${ip}`;
  const count = await db.loginAttempt.count({ where: { key, createdAt: { gte: new Date(Date.now() - PROBE_WINDOW_MS) } } });
  return count >= PROBE_MAX;
}

async function recordProbe(ip: string) {
  await db.loginAttempt.create({ data: { key: `probe:${ip}`, ip, success: false } });
}

/**
 * Step 1 — sends a one-time code to a registered mobile number.
 * The answer is the same for registered and unknown numbers (the code step is shown either way);
 * unknown numbers simply never receive a code and no row is written for them.
 */
export async function requestCodeAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  try {
    const raw = String(formData.get("phone") ?? "");
    const phone = normalizePhone(raw);
    if (!phone) return { step: "phone", error: "أدخل رقم جوال سعودي صحيح (مثال: 05XXXXXXXX)." };
    const ip = await clientIp();
    if (await probeLimited(ip)) return { step: "phone", error: THROTTLED_MSG, retryAfter: 15 * 60 };

    if (!(await knownNumber(phone))) {
      await recordProbe(ip);
      logger.info("login.unknown_number", { phone: maskPhone(phone), ip });
      return { step: "code", phone, retryAfter: OTP_RESEND_SECONDS };
    }
    const r = await requestOtp(phone, ip);
    if (!r.ok) {
      await audit({ action: "LOGIN", entityType: "SESSION", entityLabel: displayPhone(phone), newValue: { result: "OTP_THROTTLED" } });
      return { step: "phone", phone, error: r.error, retryAfter: r.retryAfter };
    }
    return { step: "code", phone, echo: r.echo, retryAfter: r.retryAfter ?? OTP_RESEND_SECONDS };
  } catch (e) {
    return actionFailure(e);
  }
}

type ResolvedUser = LoginUser & { status: string; organization: { status: string; renewalDate: Date | null } | null };

/**
 * Finds who owns this number. Platform-admin numbers (SUPER_ADMIN_PHONES) take precedence: they may only ever be a
 * SUPER_ADMIN account. Otherwise: an existing user, else an owner/tenant record (portal account created on first login).
 */
async function resolveAccount(phone: string): Promise<{ user: ResolvedUser } | { error: string }> {
  const existing = await db.user.findUnique({ where: { phone }, include: { organization: { select: { status: true, renewalDate: true } } } });

  if (superAdminPhones().includes(phone)) {
    if (existing && existing.role !== "SUPER_ADMIN") {
      await audit({ user: { id: existing.id, name: existing.name, organizationId: existing.organizationId }, action: "LOGIN", entityType: "SESSION", entityLabel: displayPhone(phone), newValue: { result: "SUPER_ADMIN_PHONE_CONFLICT", role: existing.role } });
      return { error: RESERVED_MSG };
    }
    if (existing) return { user: existing };
    const u = await db.user.create({ data: { name: "فريق دارك", phone, role: "SUPER_ADMIN", status: "ACTIVE", jobTitle: "Platform Admin" } });
    await audit({ user: { id: u.id, name: u.name, organizationId: null }, action: "CREATE", entityType: "USER", entityId: u.id, entityLabel: u.name, newValue: { role: "SUPER_ADMIN", source: "SUPER_ADMIN_PHONES" } });
    return { user: { ...u, organization: null } };
  }

  if (existing) return { user: existing };

  const variants = phoneVariants(phone);
  const [owner, tenant] = await Promise.all([
    db.owner.findFirst({ where: { phone: { in: variants }, status: { not: "ARCHIVED" }, portalUser: null }, orderBy: { createdAt: "asc" }, include: { organization: { select: { status: true, renewalDate: true } } } }),
    db.tenant.findFirst({ where: { phone: { in: variants }, status: { not: "ARCHIVED" }, portalUser: null }, orderBy: { createdAt: "asc" }, include: { organization: { select: { status: true, renewalDate: true } } } }),
  ]);
  const linked = owner ? { role: "OWNER" as const, row: owner } : tenant ? { role: "TENANT" as const, row: tenant } : null;
  if (linked) {
    const u = await db.user.create({
      data: {
        organizationId: linked.row.organizationId,
        name: linked.row.name,
        phone,
        email: linked.row.email ?? null,
        role: linked.role,
        status: "ACTIVE",
        ownerId: linked.role === "OWNER" ? linked.row.id : null,
        tenantId: linked.role === "TENANT" ? linked.row.id : null,
      },
    });
    await audit({ user: { id: u.id, name: u.name, organizationId: u.organizationId }, action: "CREATE", entityType: "USER", entityId: u.id, entityLabel: u.name, newValue: { role: linked.role, source: "PORTAL_FIRST_LOGIN", phone: displayPhone(phone) } });
    return { user: { ...u, organization: linked.row.organization } };
  }
  return { error: "تعذر فتح حساب لهذا الرقم. تواصل مع مكتبك أو فريق دارك." };
}

/** Step 2 — verifies the code and opens the session. */
export async function verifyCodeAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  try {
    const phone = normalizePhone(String(formData.get("phone") ?? ""));
    const code = String(formData.get("code") ?? "");
    const next = String(formData.get("next") ?? "");
    if (!phone) return { step: "phone", error: "رقم الجوال غير صحيح. ابدأ من جديد." };

    // Per-IP cap on wrong codes across all numbers (each code also burns after 5 wrong attempts).
    const ip = await clientIp();
    const verifyKey = `verify:${ip}`;
    const wrong = await db.loginAttempt.count({ where: { key: verifyKey, createdAt: { gte: new Date(Date.now() - PROBE_WINDOW_MS) } } });
    if (wrong >= VERIFY_MAX_WRONG) return { step: "phone", phone, error: THROTTLED_MSG, retryAfter: 15 * 60 };

    const v = await verifyOtp(phone, code);
    if (!v.ok) {
      await db.loginAttempt.create({ data: { key: verifyKey, ip, success: false } });
      await audit({ action: "LOGIN", entityType: "SESSION", entityLabel: displayPhone(phone), newValue: { result: "OTP_FAILED" } });
      return v.expired ? { step: "phone", phone, error: v.error } : { step: "code", phone, error: v.error };
    }

    const resolved = await resolveAccount(phone);
    if ("error" in resolved) return { step: "phone", phone, error: resolved.error };
    const user = resolved.user;
    if (user.status !== "ACTIVE") return { step: "phone", phone, error: "هذا الحساب غير نشط. تواصل مع مدير المكتب." };
    if (user.role !== "SUPER_ADMIN" && user.organization?.status === "SUSPENDED") return { step: "phone", phone, error: "حساب المكتب موقوف حاليًا. تواصل مع فريق دارك." };
    if (user.role !== "SUPER_ADMIN" && trialExpired(user.organization)) {
      await audit({ user: { id: user.id, name: user.name, organizationId: user.organizationId }, action: "LOGIN", entityType: "SESSION", entityLabel: displayPhone(phone), newValue: { result: "TRIAL_EXPIRED" } });
      return { step: "phone", phone, error: TRIAL_EXPIRED_MSG };
    }
    return finishLogin(user, next);
  } catch (e) {
    return actionFailure(e);
  }
}

/** Signs the user out. The client performs a full navigation afterwards. */
export async function logoutAction(): Promise<{ ok: true }> {
  const user = await getCurrentUser();
  if (user) await audit({ user, action: "LOGOUT", entityType: "SESSION", entityLabel: displayPhone(user.phone) });
  await destroySession();
  revalidatePath("/", "layout");
  return { ok: true };
}
