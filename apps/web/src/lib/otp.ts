// One-time login codes (SMS). Server-only helpers, NOT a server-action module.
// Policy: 6 digits, valid 5 minutes, 5 wrong attempts burn the code, 60s resend cool-down,
// at most 5 codes per number and 20 per IP in 15 minutes. Only SHA-256(code + AUTH_SECRET) is stored.
// Delivery: SMS via channels.ts (Authentica send-otp with our code, or Unifonic/Msegat text). Without SMS credentials the code can be "echoed" back to the UI so the
// product can be tested end-to-end before a provider is connected (OTP_ECHO=auto|always|never).
// In production the echo is off unless BOTH OTP_ECHO=always and ALLOW_OTP_ECHO_IN_PROD=1 are set (stakeholder test only).
import { createHash, randomInt, timingSafeEqual } from "crypto";
import { db } from "./db";
import { logger, maskPhone } from "./logger";
import { sendMessage, smsProvider } from "./channels";
import { authSecret } from "./secrets";
import { isTestPhone } from "./test-accounts";

export { authSecret } from "./secrets";

export const OTP_MINUTES = 5;
export const OTP_RESEND_SECONDS = 60;
const OTP_MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_PHONE = 5;
const MAX_PER_IP = 20;

export const OTP_GENERIC_ERROR = "الرمز غير صحيح أو انتهت صلاحيته.";

export function hashOtp(phone: string, code: string) {
  return createHash("sha256").update(`${phone}:${code}:${authSecret()}`).digest("hex");
}

/** Whether the code is shown in the UI instead of (or in addition to) being sent. Never in production unless explicitly allowed. */
export function otpEchoEnabled() {
  const mode = (process.env.OTP_ECHO ?? "auto").toLowerCase();
  if (process.env.NODE_ENV === "production") {
    return mode === "always" && process.env.ALLOW_OTP_ECHO_IN_PROD === "1";
  }
  if (mode === "always") return true;
  if (mode === "never") return false;
  return smsProvider() === null;
}

export type RequestOtpResult = { ok: true; echo?: string; retryAfter: number } | { ok: false; error: string; retryAfter?: number };

/** Issues a new code for the phone (normalized 9665…) and sends it. Throttled per phone and per IP. */
export async function requestOtp(phone: string, ip: string): Promise<RequestOtpResult> {
  // Test numbers (lib/test-accounts) never go through an SMS provider: their code is shown on screen in every environment.
  const test = isTestPhone(phone);
  const echo = test || otpEchoEnabled();
  if (smsProvider() === null && !echo) {
    logger.error("otp.no_provider", { phone: maskPhone(phone) });
    return { ok: false, error: "خدمة الرسائل غير مفعّلة بعد. تواصل مع فريق دارك." };
  }

  const since = new Date(Date.now() - WINDOW_MS);
  const [recent, byIp, last] = await Promise.all([
    db.otpCode.count({ where: { phone, createdAt: { gte: since } } }),
    db.otpCode.count({ where: { ip, createdAt: { gte: since } } }),
    db.otpCode.findFirst({ where: { phone }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);
  if (last && Date.now() - last.createdAt.getTime() < OTP_RESEND_SECONDS * 1000) {
    const wait = Math.ceil((OTP_RESEND_SECONDS * 1000 - (Date.now() - last.createdAt.getTime())) / 1000);
    return { ok: false, error: `تم إرسال رمز قبل قليل. يمكنك طلب رمز جديد بعد ${wait} ثانية.`, retryAfter: wait };
  }
  if (recent >= MAX_PER_PHONE || byIp >= MAX_PER_IP) {
    return { ok: false, error: "تم تجاوز عدد المحاولات المسموح. حاول مجددًا بعد 15 دقيقة.", retryAfter: 15 * 60 };
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.otpCode.updateMany({ where: { phone, consumedAt: null }, data: { consumedAt: new Date() } });
  const row = await db.otpCode.create({ data: { phone, codeHash: hashOtp(phone, code), ip, expiresAt: new Date(Date.now() + OTP_MINUTES * 60 * 1000) } });

  const body = `رمز الدخول إلى دارك: ${code}\nصالح لمدة ${OTP_MINUTES} دقائق. لا تشاركه مع أحد.`;
  const sent = test ? { ok: true as const, provider: "test", error: undefined } : await sendMessage({ channel: "SMS", to: phone, body, otp: code, entityType: "OTP" });
  if (!sent.ok && !echo) {
    // The code never left the building: drop the row so a vendor outage does not eat the user's quota or start the cool-down.
    await db.otpCode.delete({ where: { id: row.id } }).catch(() => {});
    logger.error("otp.send_failed", { phone: maskPhone(phone), provider: sent.provider, error: sent.error });
    const detail = process.env.NODE_ENV !== "production" && sent.error ? ` (${sent.provider}: ${sent.error})` : "";
    return { ok: false, error: `تعذر إرسال رمز التحقق حاليًا. حاول مجددًا بعد قليل.${detail}` };
  }
  return { ok: true, echo: echo ? code : undefined, retryAfter: OTP_RESEND_SECONDS };
}

export type VerifyOtpResult = { ok: true } | { ok: false; error: string; expired?: boolean };

/**
 * Checks a code and consumes it. Wrong attempts are counted; the code is burned after 5.
 * "No active code" and "wrong code" share one generic message so a caller cannot learn whether a code was ever issued
 * (unknown numbers never get a row). The attempts-left hint is only shown for a genuine wrong attempt on a live code.
 */
export async function verifyOtp(phone: string, code: string): Promise<VerifyOtpResult> {
  const clean = code.replace(/\D/g, "");
  if (clean.length !== 6) return { ok: false, error: "أدخل الرمز المكوّن من 6 أرقام." };
  const row = await db.otpCode.findFirst({ where: { phone, consumedAt: null }, orderBy: { createdAt: "desc" } });
  if (!row) return { ok: false, error: OTP_GENERIC_ERROR };
  const burn = () => db.otpCode.updateMany({ where: { id: row.id, consumedAt: null }, data: { consumedAt: new Date() } });
  if (row.expiresAt < new Date()) {
    await burn();
    return { ok: false, error: OTP_GENERIC_ERROR, expired: true };
  }
  // Reserve one attempt atomically BEFORE comparing: parallel guesses each need their own slot, so the cap of 5 holds.
  const reserved = await db.otpCode.updateMany({ where: { id: row.id, consumedAt: null, attempts: { lt: OTP_MAX_ATTEMPTS } }, data: { attempts: { increment: 1 } } });
  if (reserved.count !== 1) {
    await burn();
    return { ok: false, error: "تم تجاوز عدد محاولات إدخال الرمز. اطلب رمزًا جديدًا.", expired: true };
  }
  const expected = Buffer.from(row.codeHash, "hex");
  const actual = Buffer.from(hashOtp(phone, clean), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    const used = (await db.otpCode.findUnique({ where: { id: row.id }, select: { attempts: true } }))?.attempts ?? OTP_MAX_ATTEMPTS;
    if (used >= OTP_MAX_ATTEMPTS) await burn();
    const left = OTP_MAX_ATTEMPTS - used;
    return left > 0 ? { ok: false, error: `الرمز غير صحيح. تبقى ${left} ${left === 1 ? "محاولة" : "محاولات"}.` } : { ok: false, error: "الرمز غير صحيح. اطلب رمزًا جديدًا.", expired: true };
  }
  // Consume exactly once: a second request racing with the same correct code gets the generic error.
  const consumed = await burn();
  if (consumed.count !== 1) return { ok: false, error: OTP_GENERIC_ERROR, expired: true };
  return { ok: true };
}
