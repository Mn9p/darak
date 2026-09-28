import { headers } from "next/headers";
import { db } from "./db";
import type { SessionUser } from "./auth";

export type AuditAction =
  | "LOGIN" | "LOGOUT" | "CREATE" | "UPDATE" | "DELETE" | "ARCHIVE" | "APPROVE" | "REJECT"
  | "EXPORT" | "PERMISSION_CHANGE" | "SUPPORT_ACCESS" | "PAYMENT" | "STATUS_CHANGE" | "SYNC";

interface AuditInput {
  user?: (Pick<SessionUser, "id" | "name" | "organizationId"> & Partial<Pick<SessionUser, "supportAccess" | "supportAdminId" | "supportAdminName">>) | null;
  organizationId?: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  entityLabel?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
}

function serialize(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, (_k, val) => (val instanceof Date ? val.toISOString() : val));
  } catch {
    return String(v);
  }
}

/** Actor label for a support session: the platform admin, never the impersonated manager. */
function supportActorName(user: NonNullable<AuditInput["user"]>) {
  return user.supportAdminName ? `دعم دارك — ${user.supportAdminName}` : "دعم دارك";
}

/** Attaches the support marker to newValue so every row written during a support session is attributable. */
function withSupportMarker(v: unknown, marker: { supportAccess: true; supportAdminId: string | null }) {
  if (v === undefined || v === null) return marker;
  if (typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) return { ...(v as Record<string, unknown>), ...marker };
  return { value: v, ...marker };
}

/** Append-only audit record. Never throws so business flows are not interrupted. */
export async function audit(input: AuditInput) {
  try {
    let ip: string | null = null;
    let device: string | null = null;
    try {
      const h = await headers();
      ip = h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? "local";
      device = h.get("user-agent")?.slice(0, 160) ?? null;
    } catch {}
    const support = Boolean(input.user && (input.user.supportAccess || input.user.supportAdminId));
    const userName = !input.user ? "النظام" : support ? supportActorName(input.user) : input.user.name;
    const newValue = support ? withSupportMarker(input.newValue, { supportAccess: true, supportAdminId: input.user?.supportAdminId ?? null }) : input.newValue;
    await db.auditLog.create({
      data: {
        organizationId: input.organizationId ?? input.user?.organizationId ?? null,
        userId: input.user?.id ?? null,
        userName,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        entityLabel: input.entityLabel ?? null,
        oldValue: serialize(input.oldValue),
        newValue: serialize(newValue),
        ip,
        device,
      },
    });
  } catch (e) {
    console.error("audit failed", e);
  }
}
