"use server";


import { actionFailure } from "@/lib/action-error";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { sendMessage } from "@/lib/channels";
import { clientIp, accessRequestLimited, recordAccessRequest } from "@/lib/ratelimit";
import { normalizePhone, displayPhone } from "@/lib/phone";
import { supportContact } from "@/lib/support";

export type RequestState = { error?: string; ok?: boolean } | null;

const schema = z.object({
  name: z.string().trim().min(2, "اكتب اسمك.").max(80, "الاسم طويل جدًا."),
  company: z.string().trim().min(2, "اكتب اسم المكتب.").max(120, "اسم المكتب طويل جدًا."),
  phone: z.string().trim(),
  city: z.string().trim().max(60).optional().or(z.literal("")),
  message: z.string().trim().max(600, "الرسالة طويلة جدًا.").optional().or(z.literal("")),
  /** Honeypot: real people never fill it. */
  website: z.string().optional().or(z.literal("")),
});

/** Public "request an account" form on the landing page. Offices are created by the DARAK team after contact (invite-only). */
export async function requestAccessAction(_prev: RequestState, formData: FormData): Promise<RequestState> {
  try {
    const raw: Record<string, unknown> = {};
    formData.forEach((v, k) => (raw[k] = v));
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;
    if (d.website) return { ok: true }; // bot — pretend success, store nothing
    const phone = normalizePhone(d.phone);
    if (!phone) return { error: "أدخل رقم جوال سعودي صحيح (مثال: 05XXXXXXXX)." };

    const ip = await clientIp();
    if (await accessRequestLimited(ip, phone)) return { error: "وصلنا طلبك سابقًا. سنتواصل معك قريبًا." };

    const existing = await db.accessRequest.findFirst({ where: { phone, status: { in: ["NEW", "CONTACTED"] } }, select: { id: true } });
    if (existing) return { ok: true };

    const req = await db.accessRequest.create({ data: { name: d.name, company: d.company, phone, city: d.city || null, message: d.message || null, ip } });
    await recordAccessRequest(phone, ip);
    await audit({ action: "CREATE", entityType: "ACCESS_REQUEST", entityId: req.id, entityLabel: `${d.company} — ${displayPhone(phone)}`, newValue: { name: d.name, city: d.city || null } });

    // Tell the team. Never blocks the visitor.
    const s = supportContact();
    const body = `طلب حساب جديد على دارك\nالمكتب: ${d.company}\nالاسم: ${d.name}\nالجوال: ${displayPhone(phone)}${d.city ? `\nالمدينة: ${d.city}` : ""}${d.message ? `\n\n${d.message}` : ""}\n\n${process.env.APP_URL ?? ""}/admin/requests`;
    try {
      if (s.phone) await sendMessage({ channel: "SMS", to: s.phone, body, entityType: "ACCESS_REQUEST", entityId: req.id });
      if (s.email) await sendMessage({ channel: "EMAIL", to: s.email, subject: `طلب حساب جديد: ${d.company}`, body, entityType: "ACCESS_REQUEST", entityId: req.id });
    } catch (e) {
      logger.warn("access_request.notify_failed", { error: String(e) });
    }
    return { ok: true };
  } catch (e) {
    return actionFailure(e);
  }
}
