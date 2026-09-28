import { db } from "./db";
import { sendMessage, type Channel, type SendResult } from "./channels";
import { logger } from "./logger";

export type ExternalChannel = Channel;

export interface ExternalDelivery {
  channels: ExternalChannel[];
  to: { phone?: string | null; email?: string | null };
  /** Message text for external channels (defaults to `${title}\n${body}`). */
  body?: string;
  /** Email subject (defaults to title). */
  subject?: string;
}

interface NotifyInput {
  organizationId: string;
  userIds?: string[];
  roles?: string[];
  title: string;
  body?: string;
  severity?: "INFO" | "WARNING" | "DANGER" | "SUCCESS";
  entityType?: string;
  entityId?: string;
  href?: string;
  channel?: string;
  /** Optional outbound delivery (SMS / WhatsApp / Email) in addition to in-app rows. Never throws. */
  external?: ExternalDelivery;
}

/**
 * Creates in-app notifications for specific users and/or every active user with the given roles.
 * When `external` is given, the same message is also sent through the outbound channels
 * (phone for SMS/WHATSAPP, email for EMAIL). External failures are logged, never thrown.
 * Returns the number of in-app recipients.
 */
export async function notify(input: NotifyInput) {
  const ids = new Set(input.userIds ?? []);
  if (input.roles?.length) {
    const users = await db.user.findMany({
      where: { organizationId: input.organizationId, role: { in: input.roles }, status: "ACTIVE" },
      select: { id: true },
    });
    users.forEach((u) => ids.add(u.id));
  }
  if (ids.size > 0) {
    await db.notification.createMany({
      data: [...ids].map((userId) => ({
        organizationId: input.organizationId,
        userId,
        title: input.title,
        body: input.body ?? null,
        severity: input.severity ?? "INFO",
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        href: input.href ?? null,
        channel: input.channel ?? "IN_APP",
        deliveredAt: new Date(),
      })),
    });
  }
  if (input.external) {
    await deliverExternal(input.organizationId, input.external, {
      title: input.title,
      body: input.body,
      entityType: input.entityType,
      entityId: input.entityId,
    });
  }
  return ids.size;
}

/** Sends one message per requested channel. Skips channels without a destination. Never throws. */
export async function deliverExternal(
  organizationId: string,
  ext: ExternalDelivery,
  msg: { title: string; body?: string; entityType?: string; entityId?: string },
): Promise<Partial<Record<ExternalChannel, SendResult>>> {
  const results: Partial<Record<ExternalChannel, SendResult>> = {};
  const text = ext.body ?? (msg.body ? `${msg.title}\n${msg.body}` : msg.title);
  for (const channel of new Set(ext.channels)) {
    const to = channel === "EMAIL" ? ext.to.email?.trim() : ext.to.phone?.trim();
    if (!to) continue;
    try {
      results[channel] = await sendMessage({
        organizationId,
        channel,
        to,
        body: text,
        subject: ext.subject ?? msg.title,
        entityType: msg.entityType,
        entityId: msg.entityId,
      });
    } catch (e) {
      logger.warn("notify.external_failed", { channel, error: String(e) });
      results[channel] = { ok: false, provider: channel, simulated: false, error: (e as Error).message };
    }
  }
  return results;
}

/** Emails every active user holding one of the given roles (e.g. office managers). Never throws. */
export async function emailRoles(input: { organizationId: string; roles: string[]; subject: string; body: string; entityType?: string; entityId?: string }) {
  let sent = 0;
  try {
    const users = await db.user.findMany({
      where: { organizationId: input.organizationId, role: { in: input.roles }, status: "ACTIVE", email: { not: null } },
      select: { email: true },
    });
    for (const u of users) {
      if (!u.email) continue;
      const r = await sendMessage({ organizationId: input.organizationId, channel: "EMAIL", to: u.email, subject: input.subject, body: input.body, entityType: input.entityType, entityId: input.entityId });
      if (r.ok) sent++;
    }
  } catch (e) {
    logger.warn("notify.email_roles_failed", { error: String(e) });
  }
  return sent;
}

interface AutoTaskInput {
  organizationId: string;
  title: string;
  description?: string;
  assignedToId?: string | null;
  role?: string; // fallback: first active user with this role
  priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  dueDate?: Date | null;
  entityType?: string;
  entityId?: string;
  entityLabel?: string;
  tags?: string;
}

/** Creates an automated task once per entity+title (idempotent). */
export async function autoTask(input: AutoTaskInput) {
  const existing = await db.task.findFirst({
    where: {
      organizationId: input.organizationId,
      title: input.title,
      entityId: input.entityId ?? undefined,
      status: { notIn: ["COMPLETED", "CANCELLED"] },
    },
    select: { id: true },
  });
  if (existing) return existing.id;

  let assignedToId = input.assignedToId ?? null;
  if (!assignedToId && input.role) {
    const u = await db.user.findFirst({
      where: { organizationId: input.organizationId, role: input.role, status: "ACTIVE" },
      select: { id: true },
    });
    assignedToId = u?.id ?? null;
  }
  const t = await db.task.create({
    data: {
      organizationId: input.organizationId,
      title: input.title,
      description: input.description ?? null,
      assignedToId,
      priority: input.priority ?? "MEDIUM",
      status: assignedToId ? "ASSIGNED" : "NEW",
      dueDate: input.dueDate ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      entityLabel: input.entityLabel ?? null,
      tags: input.tags ?? "تلقائي",
      isAutomated: true,
    },
  });
  if (assignedToId) {
    await notify({
      organizationId: input.organizationId,
      userIds: [assignedToId],
      title: `مهمة جديدة: ${input.title}`,
      body: input.description,
      entityType: "TASK",
      entityId: t.id,
      href: `/tasks/${t.id}`,
    });
  }
  return t.id;
}
