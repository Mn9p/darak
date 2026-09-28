// Tenant portal data scope: everything is filtered by tenantId = user.tenantId inside user.organizationId.
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";

export type TenantUser = SessionUser & { tenantId: string; organizationId: string };

export const ACTIVE_CONTRACT_STATUSES = ["ACTIVE", "EXPIRING_SOON", "RENEWAL_PENDING"];

/** The tenant's current contract: an active one, or the most recent otherwise. */
export async function getTenantContract(user: TenantUser) {
  const include = {
    property: { select: { id: true, name: true, city: true, district: true, street: true, managerId: true } },
    unit: { select: { id: true, number: true, floor: true, type: true, area: true, rooms: true } },
    installments: { orderBy: { seq: "asc" as const } },
  };
  const active = await db.contract.findFirst({
    where: { organizationId: user.organizationId, tenantId: user.tenantId, status: { in: ACTIVE_CONTRACT_STATUSES } },
    orderBy: { endDate: "desc" },
    include,
  });
  if (active) return active;
  return db.contract.findFirst({
    where: { organizationId: user.organizationId, tenantId: user.tenantId, status: { notIn: ["DRAFT", "CANCELLED"] } },
    orderBy: { endDate: "desc" },
    include,
  });
}

/** Bank/transfer details shown to tenants — from org settings when configured, otherwise general guidance. */
export function bankDetails(settings: string) {
  let s: Record<string, unknown> = {};
  try {
    s = JSON.parse(settings || "{}");
  } catch {
    s = {};
  }
  const bank = (s.bank ?? {}) as { bankName?: string; iban?: string; accountName?: string };
  return {
    bankName: bank.bankName ?? null,
    iban: bank.iban ?? null,
    accountName: bank.accountName ?? null,
  };
}
