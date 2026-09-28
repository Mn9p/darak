"use server";


import { actionFailure, failFromError } from "@/lib/action-error";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSuperAdmin, createSession, destroySession, getCurrentUser, SESSION_MAX_MINUTES } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { runEngine } from "@/lib/engine";
import { PLANS, INTEGRATION_PROVIDERS } from "@/lib/constants";
import { safeJson, addMonths } from "@/lib/format";
import { normalizePhone, displayPhone } from "@/lib/phone";
import type { FormState } from "@/components/ui";
import { DEFAULT_RULES, DEFAULT_FLAGS, readFlags, slugify } from "./_shared";

/* ───────────── Organizations ───────────── */

const orgSchema = z.object({
  name: z.string().min(2, "اسم المكتب مطلوب"),
  slug: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().email("بريد المكتب غير صالح").optional().nullable().or(z.literal("")),
  crNumber: z.string().optional().nullable(),
  vatNumber: z.string().optional().nullable(),
  plan: z.string().refine((p) => p in PLANS, "الخطة غير صالحة"),
  status: z.enum(["ACTIVE", "TRIAL", "SUSPENDED"]),
  renewalDate: z.string().optional().nullable(),
  managerName: z.string().min(2, "اسم مدير المكتب مطلوب"),
  // Login identity of the first manager: stored normalized (9665XXXXXXXX) so OTP sign-in matches.
  managerPhone: z
    .string({ required_error: "رقم الجوال غير صحيح (مثال: 05XXXXXXXX).", invalid_type_error: "رقم الجوال غير صحيح (مثال: 05XXXXXXXX)." })
    .transform((v, ctx) => {
      const n = normalizePhone(v);
      if (!n) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "رقم الجوال غير صحيح (مثال: 05XXXXXXXX)." });
        return z.NEVER;
      }
      return n;
    }),
  managerEmail: z.string().trim().email("بريد مدير المكتب غير صالح").optional().nullable().or(z.literal("")),
  // Set when the office is created from an access request (/admin/requests): that request is marked CONVERTED.
  requestId: z.string().optional().nullable(),
});

export async function createOrganization(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const admin = await requireSuperAdmin();
    const raw: Record<string, unknown> = {};
    formData.forEach((v, k) => (raw[k] = v === "" ? null : v));
    const parsed = orgSchema.safeParse(raw);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;
    const plan = PLANS[d.plan];
    const managerPhone = d.managerPhone;
    const managerEmail = d.managerEmail ? d.managerEmail.toLowerCase() : null;
    if (await db.user.findUnique({ where: { phone: managerPhone }, select: { id: true } })) return { error: "هذا الرقم مستخدم لحساب آخر." };
    let slug = d.slug?.trim() ? slugify(d.slug) : slugify(d.name);
    if (await db.organization.findUnique({ where: { slug } })) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
    const request = d.requestId ? await db.accessRequest.findUnique({ where: { id: d.requestId }, select: { id: true, status: true, name: true, company: true } }) : null;

    let orgId = "";
    try {
      await db.$transaction(async (tx) => {
        const org = await tx.organization.create({
          data: {
            name: d.name,
            slug,
            city: d.city ?? null,
            phone: d.phone ?? null,
            email: d.email || null,
            crNumber: d.crNumber ?? null,
            vatNumber: d.vatNumber ?? null,
            plan: d.plan,
            status: d.status,
            unitsLimit: plan.units,
            usersLimit: plan.users,
            renewalDate: d.renewalDate ? new Date(d.renewalDate) : addMonths(new Date(), 12),
            settings: JSON.stringify({ featureFlags: DEFAULT_FLAGS }),
          },
        });
        orgId = org.id;
        await tx.branch.create({ data: { organizationId: org.id, name: "الفرع الرئيسي", city: d.city ?? null, isMain: true } });
        await tx.user.create({ data: { organizationId: org.id, name: d.managerName, phone: managerPhone, email: managerEmail, role: "OFFICE_MANAGER", status: "ACTIVE" } });
        await tx.notificationRule.createMany({ data: DEFAULT_RULES.map((r) => ({ ...r, organizationId: org.id, isActive: true })) });
        await tx.integration.createMany({
          data: Object.entries(INTEGRATION_PROVIDERS).map(([provider, meta]) => ({ organizationId: org.id, provider, name: meta.label, status: "DISCONNECTED", config: "{}" })),
        });
        if (request) {
          await tx.accessRequest.update({ where: { id: request.id }, data: { status: "CONVERTED", note: `تم إنشاء المكتب: ${d.name} (${org.id})` } });
        }
      });
    } catch {
      return { error: "تعذر إنشاء المكتب حاليًا. لم يتم حفظ أي بيانات." };
    }
    await audit({ user: admin, organizationId: orgId, action: "CREATE", entityType: "ORGANIZATION", entityId: orgId, entityLabel: d.name, newValue: { plan: d.plan, status: d.status, manager: displayPhone(managerPhone), requestId: request?.id ?? null } });
    await audit({ user: admin, organizationId: null, action: "CREATE", entityType: "ORGANIZATION", entityId: orgId, entityLabel: d.name, newValue: { plan: d.plan, status: d.status, requestId: request?.id ?? null } });
    if (request) {
      await audit({ user: admin, organizationId: null, action: "UPDATE", entityType: "ACCESS_REQUEST", entityId: request.id, entityLabel: `${request.company} — ${request.name}`, oldValue: { status: request.status }, newValue: { status: "CONVERTED", organizationId: orgId } });
      revalidatePath("/admin/requests");
    }
    revalidatePath("/admin/organizations");
    redirect(`/admin/organizations/${orgId}`);
  } catch (e) {
    return actionFailure(e);
  }
}

/* ───────────── Access requests ───────────── */

const ACCESS_REQUEST_STATUSES = ["NEW", "CONTACTED", "CONVERTED", "CLOSED"];

/** Moves an access request (public "request an account" form) between statuses. CONVERTED is normally set by createOrganization. */
export async function setAccessRequestStatus(formData: FormData) {
  try {
    const admin = await requireSuperAdmin();
    const id = String(formData.get("id") ?? "");
    const status = String(formData.get("status") ?? "");
    if (!ACCESS_REQUEST_STATUSES.includes(status)) return;
    const r = await db.accessRequest.findUnique({ where: { id }, select: { status: true, name: true, company: true } });
    if (!r || r.status === status) return;
    await db.accessRequest.update({ where: { id }, data: { status } });
    await audit({ user: admin, organizationId: null, action: "UPDATE", entityType: "ACCESS_REQUEST", entityId: id, entityLabel: `${r.company} — ${r.name}`, oldValue: { status: r.status }, newValue: { status } });
    revalidatePath("/admin/requests");
    revalidatePath("/admin");
  } catch (e) {
    await failFromError(e);
  }
}

/** Saves the internal follow-up note on an access request. */
export async function setAccessRequestNote(formData: FormData) {
  try {
    const admin = await requireSuperAdmin();
    const id = String(formData.get("id") ?? "");
    const note = String(formData.get("note") ?? "").trim().slice(0, 1000) || null;
    const r = await db.accessRequest.findUnique({ where: { id }, select: { note: true, name: true, company: true } });
    if (!r || (r.note ?? null) === note) return;
    await db.accessRequest.update({ where: { id }, data: { note } });
    await audit({ user: admin, organizationId: null, action: "UPDATE", entityType: "ACCESS_REQUEST", entityId: id, entityLabel: `${r.company} — ${r.name}`, oldValue: { note: r.note }, newValue: { note } });
    revalidatePath("/admin/requests");
  } catch (e) {
    await failFromError(e);
  }
}

const limitsSchema = z.object({
  id: z.string().min(1),
  plan: z.string().refine((p) => p in PLANS, "الخطة غير صالحة"),
  status: z.enum(["ACTIVE", "TRIAL", "SUSPENDED"]),
  unitsLimit: z.coerce.number().int().min(1, "حد الوحدات يجب أن يكون 1 على الأقل"),
  usersLimit: z.coerce.number().int().min(1, "حد المستخدمين يجب أن يكون 1 على الأقل"),
  renewalDate: z.string().optional().nullable(),
});

export async function updateOrganizationLimits(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const admin = await requireSuperAdmin();
    const raw: Record<string, unknown> = {};
    formData.forEach((v, k) => (raw[k] = v === "" ? null : v));
    const parsed = limitsSchema.safeParse(raw);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;
    const old = await db.organization.findUnique({ where: { id: d.id }, select: { plan: true, status: true, unitsLimit: true, usersLimit: true, renewalDate: true, name: true } });
    if (!old) return { error: "المكتب غير موجود." };
    const data = { plan: d.plan, status: d.status, unitsLimit: d.unitsLimit, usersLimit: d.usersLimit, renewalDate: d.renewalDate ? new Date(d.renewalDate) : null };
    await db.organization.update({ where: { id: d.id }, data });
    await audit({ user: admin, organizationId: d.id, action: "UPDATE", entityType: "ORGANIZATION", entityId: d.id, entityLabel: old.name, oldValue: old, newValue: data });
    revalidatePath(`/admin/organizations/${d.id}`);
    return { success: "تم حفظ الخطة والحدود." };
  } catch (e) {
    return actionFailure(e);
  }
}

export async function toggleFeatureFlag(formData: FormData) {
  try {
    const admin = await requireSuperAdmin();
    const id = String(formData.get("id") ?? "");
    const flag = String(formData.get("flag") ?? "");
    const org = await db.organization.findUnique({ where: { id }, select: { settings: true, name: true } });
    if (!org || !(flag in DEFAULT_FLAGS)) return;
    const flags = readFlags(org.settings);
    const next = { ...flags, [flag]: !flags[flag] };
    const settings = { ...safeJson<Record<string, unknown>>(org.settings, {}), featureFlags: next };
    await db.organization.update({ where: { id }, data: { settings: JSON.stringify(settings) } });
    await audit({ user: admin, organizationId: id, action: "UPDATE", entityType: "ORGANIZATION", entityId: id, entityLabel: `${org.name} — خصائص`, oldValue: { [flag]: flags[flag] }, newValue: { [flag]: next[flag] } });
    revalidatePath(`/admin/organizations/${id}`);
  } catch (e) {
    await failFromError(e);
  }
}

// Not exported: "use server" modules may only export async functions.
const SUPPORT_MIN_MINUTES = 15;
const SUPPORT_DEFAULT_MINUTES = 60;

/**
 * Support access: audit (org + platform) then open a time-boxed session as the org's OFFICE_MANAGER.
 * The session row carries supportAdminId, expires after `duration` minutes (15–240) and every audit row written
 * through it is attributed to "دعم دارك — <admin>". The admin's own cookie is replaced; ending the session sends them to /login.
 */
export async function supportAccess(formData: FormData) {
  try {
    const admin = await requireSuperAdmin();
    const id = String(formData.get("id") ?? "");
    const reason = String(formData.get("reason") ?? "").trim();
    const rawDuration = formData.get("duration");
    const durationMinutes = rawDuration === null || String(rawDuration).trim() === "" ? SUPPORT_DEFAULT_MINUTES : Number(rawDuration);
    if (!Number.isInteger(durationMinutes) || durationMinutes < SUPPORT_MIN_MINUTES || durationMinutes > SESSION_MAX_MINUTES) redirect(`/admin/organizations/${id}?error=duration`);
    if (reason.length < 5) redirect(`/admin/organizations/${id}?error=reason`);
    const org = await db.organization.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!org) redirect("/admin/organizations");
    const target = await db.user.findFirst({ where: { organizationId: id, role: "OFFICE_MANAGER", status: "ACTIVE" }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, phone: true } });
    if (!target) redirect(`/admin/organizations/${id}?error=nomanager`);

    const expiresAt = new Date(Date.now() + durationMinutes * 60_000);
    const payload = { reason, durationMinutes, asUser: displayPhone(target.phone), asUserName: target.name, admin: displayPhone(admin.phone), adminName: admin.name, supportAdminId: admin.id, expiresAt: expiresAt.toISOString() };
    await audit({ user: admin, organizationId: id, action: "SUPPORT_ACCESS", entityType: "ORGANIZATION", entityId: id, entityLabel: org.name, newValue: payload });
    await audit({ user: admin, organizationId: null, action: "SUPPORT_ACCESS", entityType: "ORGANIZATION", entityId: id, entityLabel: org.name, newValue: payload });
    await createSession(target.id, { supportAccess: true, supportAdminId: admin.id, minutes: durationMinutes });
    redirect("/dashboard");
  } catch (e) {
    await failFromError(e);
  }
}

/**
 * Ends the current support session early: revokes the session row, clears the cookie, audits the end (org + platform)
 * and sends the platform admin back to /login to re-authenticate. Only valid inside a support session.
 */
export async function endSupportSession(_formData?: FormData): Promise<void> {
  try {
    const user = await getCurrentUser();
    if (!user) redirect("/login");
    if (!user.supportAccess) redirect("/dashboard");
    const payload = { ended: true, asUserName: user.name, adminName: user.supportAdminName ?? null, endedAt: new Date().toISOString(), scheduledExpiry: user.sessionExpiresAt?.toISOString() ?? null };
    await audit({ user, organizationId: user.organizationId, action: "SUPPORT_ACCESS", entityType: "ORGANIZATION", entityId: user.organizationId, entityLabel: `${user.organizationName ?? ""} — إنهاء جلسة الدعم`, newValue: payload });
    await audit({ user, organizationId: null, action: "SUPPORT_ACCESS", entityType: "ORGANIZATION", entityId: user.organizationId, entityLabel: `${user.organizationName ?? ""} — إنهاء جلسة الدعم`, newValue: payload });
    await destroySession();
    revalidatePath("/", "layout");
    redirect("/login");
  } catch (e) {
    await failFromError(e);
  }
}

/* ───────────── Subscriptions ───────────── */

export async function renewSubscription(formData: FormData) {
  try {
    const admin = await requireSuperAdmin();
    const id = String(formData.get("id") ?? "");
    const months = Number(formData.get("months") ?? 12) || 12;
    const org = await db.organization.findUnique({ where: { id }, select: { renewalDate: true, name: true, status: true } });
    if (!org) return;
    const base = org.renewalDate && org.renewalDate > new Date() ? org.renewalDate : new Date();
    const renewalDate = addMonths(base, months);
    await db.organization.update({ where: { id }, data: { renewalDate, status: org.status === "SUSPENDED" ? "ACTIVE" : org.status === "TRIAL" ? "ACTIVE" : org.status } });
    await audit({ user: admin, organizationId: id, action: "UPDATE", entityType: "ORGANIZATION", entityId: id, entityLabel: `${org.name} — تجديد الاشتراك`, oldValue: { renewalDate: org.renewalDate }, newValue: { renewalDate, months } });
    revalidatePath("/admin/subscriptions");
    revalidatePath(`/admin/organizations/${id}`);
  } catch (e) {
    await failFromError(e);
  }
}

export async function changePlan(formData: FormData) {
  try {
    const admin = await requireSuperAdmin();
    const id = String(formData.get("id") ?? "");
    const plan = String(formData.get("plan") ?? "");
    if (!(plan in PLANS)) return;
    const org = await db.organization.findUnique({ where: { id }, select: { plan: true, name: true } });
    if (!org) return;
    const p = PLANS[plan];
    await db.organization.update({ where: { id }, data: { plan, unitsLimit: p.units, usersLimit: p.users } });
    await audit({ user: admin, organizationId: id, action: "UPDATE", entityType: "ORGANIZATION", entityId: id, entityLabel: `${org.name} — تغيير الخطة`, oldValue: { plan: org.plan }, newValue: { plan, unitsLimit: p.units, usersLimit: p.users } });
    revalidatePath("/admin/subscriptions");
    revalidatePath(`/admin/organizations/${id}`);
  } catch (e) {
    await failFromError(e);
  }
}

/* ───────────── Health ───────────── */

export async function runScheduledJobsNow() {
  const admin = await requireSuperAdmin();
  const orgs = await db.organization.findMany({ where: { status: { not: "SUSPENDED" } }, select: { id: true, name: true } });
  const results: Record<string, number> = {};
  let total = 0;
  for (const o of orgs) {
    try {
      const r = await runEngine(o.id);
      results[o.name] = r.updates;
      total += r.updates;
    } catch (e) {
      results[o.name] = -1;
      console.error("runEngine failed", o.id, e);
    }
  }
  await audit({ user: admin, organizationId: null, action: "SYNC", entityType: "SYSTEM", entityLabel: "تشغيل المهام المجدولة يدويًا", newValue: { orgs: orgs.length, updates: total, results } });
  revalidatePath("/admin/health");
  redirect(`/admin/health?ran=1&orgs=${orgs.length}&updates=${total}`);
}

/* ───────────── Support ───────────── */

const TICKET_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"];
const TICKET_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"];

export async function updateTicketStatus(formData: FormData) {
  try {
    const admin = await requireSuperAdmin();
    const id = String(formData.get("id") ?? "");
    const status = String(formData.get("status") ?? "");
    if (!TICKET_STATUSES.includes(status)) return;
    const t = await db.supportTicket.findUnique({ where: { id }, select: { status: true, subject: true, organizationId: true } });
    if (!t) return;
    await db.supportTicket.update({ where: { id }, data: { status } });
    await audit({ user: admin, organizationId: t.organizationId, action: "STATUS_CHANGE", entityType: "SUPPORT_TICKET", entityId: id, entityLabel: t.subject, oldValue: { status: t.status }, newValue: { status } });
    revalidatePath("/admin/support");
  } catch (e) {
    await failFromError(e);
  }
}

export async function updateTicketPriority(formData: FormData) {
  try {
    const admin = await requireSuperAdmin();
    const id = String(formData.get("id") ?? "");
    const priority = String(formData.get("priority") ?? "");
    if (!TICKET_PRIORITIES.includes(priority)) return;
    const t = await db.supportTicket.findUnique({ where: { id }, select: { priority: true, subject: true, organizationId: true } });
    if (!t) return;
    await db.supportTicket.update({ where: { id }, data: { priority } });
    await audit({ user: admin, organizationId: t.organizationId, action: "UPDATE", entityType: "SUPPORT_TICKET", entityId: id, entityLabel: t.subject, oldValue: { priority: t.priority }, newValue: { priority } });
    revalidatePath("/admin/support");
  } catch (e) {
    await failFromError(e);
  }
}

export async function replyToTicket(formData: FormData) {
  try {
    const admin = await requireSuperAdmin();
    const id = String(formData.get("id") ?? "");
    const reply = String(formData.get("reply") ?? "").trim();
    if (!reply) return;
    const t = await db.supportTicket.findUnique({ where: { id }, select: { body: true, subject: true, status: true, organizationId: true, userId: true } });
    if (!t) return;
    const stamp = new Date().toISOString().replace("T", " ").slice(0, 16);
    const body = `${t.body}\n\n--- رد الدعم (${admin.name} · ${stamp}) ---\n${reply}`;
    const status = t.status === "OPEN" ? "IN_PROGRESS" : t.status;
    await db.supportTicket.update({ where: { id }, data: { body, status } });
    await audit({ user: admin, organizationId: t.organizationId, action: "UPDATE", entityType: "SUPPORT_TICKET", entityId: id, entityLabel: t.subject, newValue: { reply } });
    if (t.userId) {
      await db.notification.create({
        data: { organizationId: t.organizationId, userId: t.userId, title: `رد الدعم الفني على: ${t.subject}`, body: reply.slice(0, 200), severity: "INFO", entityType: "SUPPORT_TICKET", entityId: id, deliveredAt: new Date() },
      });
    }
    revalidatePath("/admin/support");
  } catch (e) {
    await failFromError(e);
  }
}
