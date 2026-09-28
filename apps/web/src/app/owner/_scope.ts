// Owner portal data scope. Everything an owner sees is derived from PropertyOwnership rows
// for the owner linked to the session (user.ownerId) inside the owner's organization.
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import { ownershipPctAt, ownershipFirstClose } from "@/lib/engine";

export type OwnerUser = SessionUser & { ownerId: string; organizationId: string };

export interface OwnershipRow {
  propertyId: string;
  percentage: number;
  startDate: Date;
  endDate: Date | null;
}

export interface OwnerScope {
  org: string;
  ownerId: string;
  /** Current ownership rows (endDate null) */
  current: OwnershipRow[];
  /** All ownership rows incl. historical periods */
  all: OwnershipRow[];
  /** Property ids currently owned */
  propertyIds: string[];
  /** Property ids owned now or in the past (for financial history) */
  allPropertyIds: string[];
  properties: { id: string; name: string; code: string; city: string | null; type: string; status: string; pct: number }[];
  /** Ownership share (%) of a property, at a given date (defaults to current). */
  pctOf: (propertyId: string, at?: Date | null) => number;
}

export async function getOwnerScope(user: OwnerUser): Promise<OwnerScope> {
  const rows = await db.propertyOwnership.findMany({
    where: { ownerId: user.ownerId, property: { organizationId: user.organizationId } },
    include: { property: { select: { id: true, name: true, code: true, city: true, type: true, status: true } } },
    orderBy: { startDate: "desc" },
  });
  const all: OwnershipRow[] = rows.map((r) => ({ propertyId: r.propertyId, percentage: r.percentage, startDate: r.startDate, endDate: r.endDate }));
  const current = all.filter((r) => !r.endDate);
  const propertyIds = [...new Set(current.map((r) => r.propertyId))];
  const allPropertyIds = [...new Set(all.map((r) => r.propertyId))];
  // Same rule as statements (lib/engine ownershipPctAt): opening rows cover back-dated history, transfers apply from their start.
  const firstClose = await ownershipFirstClose(allPropertyIds);
  const pctOf = (propertyId: string, at?: Date | null) => {
    if (at) return ownershipPctAt(all, propertyId, new Date(at), firstClose);
    return all.filter((r) => r.propertyId === propertyId && !r.endDate).reduce((s, r) => s + r.percentage, 0);
  };
  const seen = new Set<string>();
  const properties = rows
    .filter((r) => {
      if (r.endDate || r.property.status === "ARCHIVED" || seen.has(r.propertyId)) return false;
      seen.add(r.propertyId);
      return true;
    })
    .map((r) => ({ ...r.property, pct: pctOf(r.propertyId) }));
  return { org: user.organizationId, ownerId: user.ownerId, current, all, propertyIds, allPropertyIds, properties, pctOf };
}

/** Contract ids on currently owned properties (used for document visibility). */
export async function ownedContractIds(scope: OwnerScope) {
  const rows = await db.contract.findMany({ where: { organizationId: scope.org, propertyId: { in: scope.propertyIds } }, select: { id: true } });
  return rows.map((r) => r.id);
}
