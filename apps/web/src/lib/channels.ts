// Outbound messaging adapters: Email (Resend), SMS (Authentica / Unifonic / Msegat), WhatsApp (Meta Cloud API).
// Provider keys missing → message is simulated and logged (IntegrationLog) so the workflow never breaks.
import { db } from "./db";
import { logger, maskPhone } from "./logger";
import { normalizePhone as normalizeSa } from "./phone";

export type Channel = "EMAIL" | "SMS" | "WHATSAPP";

export interface SendInput {
  /** Omitted for platform-level messages (login codes) — nothing is written to IntegrationLog then. */
  organizationId?: string;
  channel: Channel;
  to: string; // phone (966…) or email
  body: string;
  subject?: string;
  /** For audit: entity that triggered the message */
  entityType?: string;
  entityId?: string;
  /** The one-time code inside `body` (login / phone-change codes). OTP-only vendors (Authentica) deliver this instead of `body`. */
  otp?: string;
}

export interface SendResult {
  ok: boolean;
  provider: string;
  simulated: boolean;
  providerMessageId?: string;
  error?: string;
}

const PROVIDER_KEY: Record<Channel, string> = { EMAIL: "EMAIL", SMS: "SMS", WHATSAPP: "WHATSAPP" };

/** 9665XXXXXXXX for Saudi mobiles; other numbers pass through with symbols stripped. */
export function normalizePhone(raw: string) {
  return normalizeSa(raw) ?? raw.replace(/[^\d]/g, "");
}

export type SmsProvider = "authentica" | "unifonic" | "msegat";

/**
 * Authentica API key. Keys look like "$2y$10$…" and .env loaders (dotenv-expand) treat "$IZ8…" as a variable reference,
 * mangling the key — and the Next dev server expands twice (parent + child process), so even "\$" escapes do not survive.
 * AUTHENTICA_API_KEY_B64 (base64 of the key) is therefore preferred in .env files; AUTHENTICA_API_KEY (raw) works on
 * platforms that inject env vars directly (Vercel, Docker).
 */
export function authenticaKey(): string | null {
  const b64 = process.env.AUTHENTICA_API_KEY_B64?.trim();
  if (b64) {
    const decoded = Buffer.from(b64, "base64").toString("utf8").trim();
    if (decoded) return decoded;
  }
  return process.env.AUTHENTICA_API_KEY?.trim() || null;
}

/** Which SMS provider is active, or null when no credentials are set (sends are then simulated and logged only). */
export function smsProvider(): SmsProvider | null {
  const provider = (process.env.SMS_PROVIDER ?? "unifonic").toLowerCase();
  if (provider === "authentica") return authenticaKey() ? "authentica" : null;
  if (provider === "msegat") return process.env.MSEGAT_USERNAME && process.env.MSEGAT_API_KEY ? "msegat" : null;
  return process.env.UNIFONIC_APP_SID ? "unifonic" : null;
}

/** Authentica delivers one-time codes only (send-otp); it has no free-text SMS endpoint. */
export function smsProviderSupportsFreeText(): boolean {
  return smsProvider() !== "authentica";
}

export async function sendMessage(input: SendInput): Promise<SendResult> {
  let result: SendResult;
  try {
    if (input.channel === "EMAIL") result = await sendEmail(input);
    else if (input.channel === "SMS") result = await sendSms(input);
    else result = await sendWhatsApp(input);
  } catch (e) {
    result = { ok: false, provider: input.channel, simulated: false, error: (e as Error).message };
  }
  await log(input, result);
  return result;
}

async function log(input: SendInput, r: SendResult) {
  try {
    const integ = !input.organizationId ? null : await db.integration.findUnique({ where: { organizationId_provider: { organizationId: input.organizationId, provider: PROVIDER_KEY[input.channel] } } });
    if (integ) {
      await db.integrationLog.create({
        data: {
          integrationId: integ.id,
          level: r.ok ? "INFO" : "ERROR",
          message: `${r.simulated ? "[محاكاة] " : ""}${input.channel} → ${input.to}${r.error ? ` — ${r.error}` : ""}`,
          payload: JSON.stringify({ subject: input.subject, body: input.body.slice(0, 500), providerMessageId: r.providerMessageId, entityType: input.entityType, entityId: input.entityId }),
        },
      });
      if (!r.ok && !r.simulated) await db.integration.update({ where: { id: integ.id }, data: { status: "ERROR", lastError: r.error ?? "send failed" } });
      else if (r.ok && !r.simulated) await db.integration.update({ where: { id: integ.id }, data: { status: "CONNECTED", lastSyncAt: new Date(), lastError: null } });
    }
  } catch (e) {
    logger.warn("channels.log_failed", { error: String(e) });
  }
  const to = input.channel === "EMAIL" ? input.to.replace(/^(.).*(@.*)$/, "$1***$2") : maskPhone(input.to);
  (r.ok ? logger.info : logger.warn)("channels.send", { channel: input.channel, to, ok: r.ok, simulated: r.simulated, provider: r.provider, error: r.error });
}

// ───────── Email (Resend) ─────────
async function sendEmail(i: SendInput): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: true, provider: "resend", simulated: true };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_FROM ?? "DARAK <noreply@darak.sa>", to: [i.to], subject: i.subject ?? "إشعار من دارك", html: `<div dir="rtl" style="font-family:Tahoma,Arial;line-height:1.8">${escapeHtml(i.body).replace(/\n/g, "<br/>")}</div>` }),
  });
  const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
  return res.ok ? { ok: true, provider: "resend", simulated: false, providerMessageId: json.id } : { ok: false, provider: "resend", simulated: false, error: json.message ?? `HTTP ${res.status}` };
}

// ───────── SMS (Authentica / Unifonic / Msegat) ─────────
async function sendSms(i: SendInput): Promise<SendResult> {
  const to = normalizePhone(i.to);
  const provider = (process.env.SMS_PROVIDER ?? "unifonic").toLowerCase();
  if (provider === "authentica") return sendAuthenticaOtp(i, to);
  if (provider === "msegat") {
    const { MSEGAT_USERNAME: u, MSEGAT_API_KEY: k, MSEGAT_SENDER: s } = process.env;
    if (!u || !k) return { ok: true, provider: "msegat", simulated: true };
    const res = await fetch("https://www.msegat.com/gw/sendsms.php", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userName: u, apiKey: k, userSender: s ?? "DARAK", numbers: to, msg: i.body, msgEncoding: "UTF8" }),
    });
    const json = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
    return json.code === "1" ? { ok: true, provider: "msegat", simulated: false } : { ok: false, provider: "msegat", simulated: false, error: json.message ?? `HTTP ${res.status}` };
  }
  const sid = process.env.UNIFONIC_APP_SID;
  if (!sid) return { ok: true, provider: "unifonic", simulated: true };
  const res = await fetch("https://el.cloud.unifonic.com/rest/SMS/messages", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ AppSid: sid, SenderID: process.env.UNIFONIC_SENDER_ID ?? "DARAK", Recipient: to, Body: i.body }),
  });
  const json = (await res.json().catch(() => ({}))) as { success?: boolean | string; message?: string; data?: { MessageID?: string } };
  const ok = json.success === true || json.success === "true";
  return ok ? { ok: true, provider: "unifonic", simulated: false, providerMessageId: json.data?.MessageID } : { ok: false, provider: "unifonic", simulated: false, error: json.message ?? `HTTP ${res.status}` };
}

/**
 * Authentica (authentica.sa) — Saudi OTP service. `POST /api/v2/send-otp` with our own code (`otp`) so the code stays
 * verified locally (lib/otp.ts hashes it at rest). Free-text messages (reminders) cannot go through Authentica: they are
 * marked simulated so the workflow never breaks; use Unifonic/Msegat or WhatsApp for those.
 * Env: AUTHENTICA_API_KEY_B64 or AUTHENTICA_API_KEY (X-Authorization, see authenticaKey), AUTHENTICA_TEMPLATE_ID (portal → Templates; default 1).
 */
async function sendAuthenticaOtp(i: SendInput, to: string): Promise<SendResult> {
  const key = authenticaKey();
  if (!key) return { ok: true, provider: "authentica", simulated: true };
  if (!key.startsWith("$2y$")) return { ok: false, provider: "authentica", simulated: false, error: "AUTHENTICA_API_KEY looks mangled by the .env loader — set AUTHENTICA_API_KEY_B64 (base64 of the key) instead" };
  if (!i.otp) return { ok: true, provider: "authentica", simulated: true, error: "authentica delivers one-time codes only" };
  if (!/^9665\d{8}$/.test(to)) return { ok: false, provider: "authentica", simulated: false, error: "authentica accepts Saudi mobiles only" };
  const templateId = Number.parseInt(process.env.AUTHENTICA_TEMPLATE_ID ?? "", 10);
  const res = await fetch("https://api.authentica.sa/api/v2/send-otp", {
    method: "POST",
    headers: { "X-Authorization": key, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ method: "sms", phone: `+${to}`, otp: i.otp, ...(Number.isFinite(templateId) && templateId > 0 ? { template_id: templateId } : {}) }),
  });
  const json = (await res.json().catch(() => ({}))) as { success?: boolean; message?: string; errors?: { message?: string }[] };
  if (res.ok && json.success === true) return { ok: true, provider: "authentica", simulated: false };
  const error = json.message ?? json.errors?.[0]?.message ?? `HTTP ${res.status}`;
  return { ok: false, provider: "authentica", simulated: false, error };
}

// ───────── WhatsApp (Meta Cloud API) ─────────
async function sendWhatsApp(i: SendInput): Promise<SendResult> {
  const id = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!id || !token) return { ok: true, provider: "whatsapp", simulated: true };
  const res = await fetch(`https://graph.facebook.com/v20.0/${id}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: normalizePhone(i.to), type: "text", text: { body: i.body } }),
  });
  const json = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message: string } };
  return res.ok ? { ok: true, provider: "whatsapp", simulated: false, providerMessageId: json.messages?.[0]?.id } : { ok: false, provider: "whatsapp", simulated: false, error: json.error?.message ?? `HTTP ${res.status}` };
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Renders a template body with {{variables}}. */
export function renderTemplate(body: string, vars: Record<string, string | number | null | undefined>) {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => String(vars[k] ?? ""));
}
