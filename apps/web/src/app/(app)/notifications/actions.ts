"use server";


import { failFromError, actionFailure } from "@/lib/action-error";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { assertCan } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { NOTIFICATION_EVENTS, NOTIFICATION_CHANNELS, RULE_AUDIENCES } from "@/lib/constants";
import { safeJson } from "@/lib/format";
import type { FormState } from "@/components/ui";

/* ───────── Notifications (per user) ───────── */

export async function markRead(formData: FormData): Promise<void> {
  try {
    const user = await requireStaff();
    const id = String(formData.get("id"));
    await db.notification.updateMany({ where: { id, userId: user.id, organizationId: user.organizationId }, data: { readAt: new Date() } });
    revalidatePath("/notifications");
  } catch (e) {
    await failFromError(e);
  }
}

export async function markUnread(formData: FormData): Promise<void> {
  try {
    const user = await requireStaff();
    const id = String(formData.get("id"));
    await db.notification.updateMany({ where: { id, userId: user.id, organizationId: user.organizationId }, data: { readAt: null } });
    revalidatePath("/notifications");
  } catch (e) {
    await failFromError(e);
  }
}

export async function markAllRead(): Promise<void> {
  const user = await requireStaff();
  await db.notification.updateMany({ where: { userId: user.id, organizationId: user.organizationId, readAt: null }, data: { readAt: new Date() } });
  revalidatePath("/notifications");
}

/* ───────── Rules ───────── */

const ruleSchema = z.object({
  name: z.string().min(2, "اسم القاعدة مطلوب"),
  event: z.string().refine((v) => v in NOTIFICATION_EVENTS, "الحدث غير صالح"),
  daysBefore: z.coerce.number().int().min(0).max(365).default(0),
  channels: z.string().min(1, "اختر قناة واحدة على الأقل"),
  targetRoles: z.string().min(1, "اختر دورًا مستهدفًا واحدًا على الأقل"),
  createTask: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

function parseRule(fd: FormData) {
  const channels = fd.getAll("channels").map(String).filter((c) => c in NOTIFICATION_CHANNELS);
  const roles = fd.getAll("targetRoles").map(String).filter((r) => r in RULE_AUDIENCES);
  return ruleSchema.safeParse({
    name: fd.get("name"),
    event: fd.get("event"),
    daysBefore: fd.get("daysBefore") || 0,
    channels: channels.join(","),
    targetRoles: roles.join(","),
    createTask: fd.get("createTask") === "on",
    isActive: fd.get("isActive") !== "off",
  });
}

export async function createRule(_prev: FormState, fd: FormData): Promise<FormState> {
  try {
    const user = await requireStaff();
    assertCan(user, "settings.manage");
    const parsed = parseRule(fd);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const r = await db.notificationRule.create({ data: { ...parsed.data, organizationId: user.organizationId } });
    await audit({ user, action: "CREATE", entityType: "NOTIFICATION_RULE", entityId: r.id, entityLabel: r.name, newValue: parsed.data });
    revalidatePath("/notifications");
    return { success: "تم إنشاء القاعدة." };
  } catch (e) {
    return actionFailure(e);
  }
}

export async function updateRule(_prev: FormState, fd: FormData): Promise<FormState> {
  try {
    const user = await requireStaff();
    assertCan(user, "settings.manage");
    const id = String(fd.get("id"));
    const old = await db.notificationRule.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!old) return { error: "القاعدة غير موجودة." };
    const parsed = parseRule(fd);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    await db.notificationRule.update({ where: { id }, data: parsed.data });
    await audit({ user, action: "UPDATE", entityType: "NOTIFICATION_RULE", entityId: id, entityLabel: parsed.data.name, oldValue: { name: old.name, event: old.event, daysBefore: old.daysBefore, channels: old.channels, targetRoles: old.targetRoles, createTask: old.createTask }, newValue: parsed.data });
    revalidatePath("/notifications");
    return { success: "تم حفظ القاعدة." };
  } catch (e) {
    return actionFailure(e);
  }
}

export async function toggleRule(formData: FormData): Promise<void> {
  try {
    const user = await requireStaff();
    assertCan(user, "settings.manage");
    const id = String(formData.get("id"));
    const r = await db.notificationRule.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!r) return;
    await db.notificationRule.update({ where: { id }, data: { isActive: !r.isActive } });
    await audit({ user, action: "STATUS_CHANGE", entityType: "NOTIFICATION_RULE", entityId: id, entityLabel: r.name, oldValue: { isActive: r.isActive }, newValue: { isActive: !r.isActive } });
    revalidatePath("/notifications");
  } catch (e) {
    await failFromError(e);
  }
}

export async function deleteRule(formData: FormData): Promise<void> {
  try {
    const user = await requireStaff();
    assertCan(user, "settings.manage");
    const id = String(formData.get("id"));
    const r = await db.notificationRule.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!r) return;
    await db.notificationRule.delete({ where: { id } });
    await audit({ user, action: "DELETE", entityType: "NOTIFICATION_RULE", entityId: id, entityLabel: r.name, oldValue: { name: r.name, event: r.event, daysBefore: r.daysBefore, channels: r.channels, targetRoles: r.targetRoles } });
    revalidatePath("/notifications");
  } catch (e) {
    await failFromError(e);
  }
}

/* ───────── Templates ───────── */

const templateSchema = z.object({
  name: z.string().min(2, "اسم القالب مطلوب"),
  event: z.string().refine((v) => v in NOTIFICATION_EVENTS, "الحدث غير صالح"),
  channel: z.string().refine((v) => v in NOTIFICATION_CHANNELS, "القناة غير صالحة"),
  language: z.enum(["ar", "en"]).default("ar"),
  body: z.string().min(5, "نص القالب قصير جدًا"),
  isActive: z.boolean().default(true),
});

function parseTemplate(fd: FormData) {
  return templateSchema.safeParse({ name: fd.get("name"), event: fd.get("event"), channel: fd.get("channel"), language: fd.get("language") || "ar", body: fd.get("body"), isActive: fd.get("isActive") !== "off" });
}

export async function createTemplate(_prev: FormState, fd: FormData): Promise<FormState> {
  try {
    const user = await requireStaff();
    assertCan(user, "settings.manage");
    const parsed = parseTemplate(fd);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const t = await db.notificationTemplate.create({ data: { ...parsed.data, organizationId: user.organizationId } });
    await audit({ user, action: "CREATE", entityType: "NOTIFICATION_TEMPLATE", entityId: t.id, entityLabel: t.name, newValue: parsed.data });
    revalidatePath("/notifications");
    return { success: "تم إنشاء القالب." };
  } catch (e) {
    return actionFailure(e);
  }
}

export async function updateTemplate(_prev: FormState, fd: FormData): Promise<FormState> {
  try {
    const user = await requireStaff();
    assertCan(user, "settings.manage");
    const id = String(fd.get("id"));
    const old = await db.notificationTemplate.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!old) return { error: "القالب غير موجود." };
    const parsed = parseTemplate(fd);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    await db.notificationTemplate.update({ where: { id }, data: parsed.data });
    await audit({ user, action: "UPDATE", entityType: "NOTIFICATION_TEMPLATE", entityId: id, entityLabel: parsed.data.name, oldValue: { name: old.name, event: old.event, channel: old.channel, language: old.language, body: old.body }, newValue: parsed.data });
    revalidatePath("/notifications");
    return { success: "تم حفظ القالب." };
  } catch (e) {
    return actionFailure(e);
  }
}

export async function toggleTemplate(formData: FormData): Promise<void> {
  try {
    const user = await requireStaff();
    assertCan(user, "settings.manage");
    const id = String(formData.get("id"));
    const t = await db.notificationTemplate.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!t) return;
    await db.notificationTemplate.update({ where: { id }, data: { isActive: !t.isActive } });
    await audit({ user, action: "STATUS_CHANGE", entityType: "NOTIFICATION_TEMPLATE", entityId: id, entityLabel: t.name, oldValue: { isActive: t.isActive }, newValue: { isActive: !t.isActive } });
    revalidatePath("/notifications");
  } catch (e) {
    await failFromError(e);
  }
}

/* ───────── Preferences (per user, JSON in User.preferences) ───────── */

export type Preferences = Record<string, string[]>; // event -> channels[]

export async function savePreferences(formData: FormData): Promise<void> {
  try {
    const user = await requireStaff();
    const prefs: Preferences = {};
    for (const ev of Object.keys(NOTIFICATION_EVENTS)) {
      const channels = formData.getAll(`pref_${ev}`).map(String).filter((c) => c in NOTIFICATION_CHANNELS);
      prefs[ev] = channels;
    }
    const digest = String(formData.get("digest") ?? "instant");
    const quietFrom = String(formData.get("quietFrom") ?? "");
    const quietTo = String(formData.get("quietTo") ?? "");
    const me = await db.user.findUnique({ where: { id: user.id }, select: { preferences: true } });
    const old = safeJson<Record<string, unknown>>(me?.preferences, {});
    const next = { ...old, notifications: prefs, digest, quietHours: quietFrom && quietTo ? { from: quietFrom, to: quietTo } : null };
    await db.user.update({ where: { id: user.id }, data: { preferences: JSON.stringify(next) } });
    await audit({ user, action: "UPDATE", entityType: "USER", entityId: user.id, entityLabel: user.name, oldValue: { preferences: old.notifications ?? null }, newValue: { preferences: prefs, digest } });
    revalidatePath("/notifications");
  } catch (e) {
    await failFromError(e);
  }
}
