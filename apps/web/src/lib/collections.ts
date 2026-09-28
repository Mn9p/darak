// Property-first collection queries shared by /collections and the property page.
// Every query is scoped to the caller's organization and property scope.
import { db } from "./db";
import type { SessionUser } from "./auth";
import { propertyScope, isScoped } from "./permissions";
import { getOrgSettings, enforcementEligible, tenantRisk, graceDaysFor, type RiskLevel } from "./engine";
import type { OrgSettings } from "./constants";
import { startOfMonth, endOfMonth, daysOverdue, daysFromToday, addDays, addMonths, startOfDay, endOfDay } from "./format";

type Staff = SessionUser & { organizationId: string };

/** Installment statuses that mean "money is expected now". */
export const OPEN_INSTALLMENT = ["DUE", "OVERDUE", "PARTIALLY_PAID"];
export const OPEN_CASE = ["OPEN", "PROMISE_TO_PAY", "BROKEN_PROMISE", "DISPUTED", "ESCALATED"];

export interface PropertyCollectionRow {
  id: string;
  name: string;
  code: string;
  city: string | null;
  units: { total: number; rented: number };
  dueMonth: number;
  paidMonth: number;
  rate: number;
  overdueAmt: number;
  overdueCount: number;
  oldestLate: number;
  enforceable: number;
  openCases: number;
  promisesToday: number;
  broken: number;
  unassigned: number;
}

/** One row per property with its collection health this month. */
export async function propertyCollectionBoard(user: Staff): Promise<{ rows: PropertyCollectionRow[]; totals: { overdueAmt: number; dueMonth: number; paidMonth: number; promisesToday: number; unassigned: number; enforceable: number } }> {
  const org = user.organizationId;
  const now = new Date();
  const dayStart = startOfDay(now);
  const dayEnd = endOfDay(now);
  const properties = await db.property.findMany({
    where: { organizationId: org, status: { not: "ARCHIVED" }, ...propertyScope(user) },
    select: { id: true, name: true, code: true, city: true, units: { where: { status: { not: "ARCHIVED" } }, select: { status: true } } },
    orderBy: { name: "asc" },
  });
  const ids = properties.map((p) => p.id);
  const [settings, monthInst, openInst, cases] = await Promise.all([
    getOrgSettings(org),
    db.installment.findMany({
      where: { organizationId: org, dueDate: { gte: startOfMonth(now), lte: endOfMonth(now) }, status: { not: "WAIVED" }, contract: { propertyId: { in: ids } } },
      select: { amount: true, paidAmount: true, contract: { select: { propertyId: true } } },
    }),
    db.installment.findMany({
      where: { organizationId: org, status: { in: OPEN_INSTALLMENT }, contract: { propertyId: { in: ids } } },
      select: { amount: true, paidAmount: true, dueDate: true, status: true, contract: { select: { propertyId: true, paymentFrequency: true } } },
    }),
    db.collectionCase.findMany({
      where: { organizationId: org, followUpStatus: { in: OPEN_CASE }, installment: { contract: { propertyId: { in: ids } } } },
      select: { followUpStatus: true, promiseDate: true, collectorId: true, installment: { select: { contract: { select: { propertyId: true } } } } },
    }),
  ]);

  const rows: PropertyCollectionRow[] = properties.map((p) => {
    const m = monthInst.filter((i) => i.contract.propertyId === p.id);
    const o = openInst.filter((i) => i.contract.propertyId === p.id && daysOverdue(i.dueDate) > 0);
    const k = cases.filter((c) => c.installment.contract.propertyId === p.id);
    const dueMonth = m.reduce((s, i) => s + i.amount, 0);
    const paidMonth = m.reduce((s, i) => s + i.paidAmount, 0);
    return {
      id: p.id,
      name: p.name,
      code: p.code,
      city: p.city,
      units: { total: p.units.length, rented: p.units.filter((u) => u.status === "RENTED").length },
      dueMonth,
      paidMonth,
      rate: dueMonth ? (paidMonth / dueMonth) * 100 : 0,
      overdueAmt: o.reduce((s, i) => s + (i.amount - i.paidAmount), 0),
      overdueCount: o.length,
      oldestLate: o.reduce((mx, i) => Math.max(mx, daysOverdue(i.dueDate)), 0),
      enforceable: o.filter((i) => enforcementEligible(i, i.contract, settings)).length,
      openCases: k.length,
      promisesToday: k.filter((c) => c.followUpStatus === "PROMISE_TO_PAY" && c.promiseDate && c.promiseDate >= dayStart && c.promiseDate <= dayEnd).length,
      broken: k.filter((c) => c.followUpStatus === "BROKEN_PROMISE").length,
      unassigned: k.filter((c) => !c.collectorId).length,
    };
  });
  const totals = rows.reduce(
    (t, r) => ({ overdueAmt: t.overdueAmt + r.overdueAmt, dueMonth: t.dueMonth + r.dueMonth, paidMonth: t.paidMonth + r.paidMonth, promisesToday: t.promisesToday + r.promisesToday, unassigned: t.unassigned + r.unassigned, enforceable: t.enforceable + r.enforceable }),
    { overdueAmt: 0, dueMonth: 0, paidMonth: 0, promisesToday: 0, unassigned: 0, enforceable: 0 },
  );
  return { rows, totals };
}

export interface ClaimRow {
  installmentId: string;
  caseId: string | null;
  seq: number;
  tenantId: string;
  tenantName: string;
  phone: string | null;
  email: string | null;
  unitId: string;
  unitNumber: string;
  contractId: string;
  contractCode: string;
  dueDate: string;
  amount: number;
  paidAmount: number;
  remaining: number;
  late: number;
  graceDays: number;
  enforceable: boolean;
  status: string;
  followUpStatus: string | null;
  priority: number;
  collectorId: string | null;
  collectorName: string | null;
  nextAction: string | null;
  nextActionDate: string | null;
  promiseAmount: number | null;
  promiseDate: string | null;
  brokenPromises: number;
  lastAction: { type: string; at: string; note: string | null } | null;
  risk: { level: RiskLevel; score: number; reasons: string[] };
}

export type ClaimFilter = "all" | "overdue" | "promise" | "broken" | "escalated" | "unassigned";

/** Open claims for one property, enriched with grace, enforcement and tenant risk. Caller must have checked scope. */
export async function propertyClaims(user: Staff, propertyId: string, filter: ClaimFilter = "all", unitId?: string): Promise<{ claims: ClaimRow[]; upcoming: { id: string; seq: number; tenantName: string; tenantId: string; unitNumber: string; contractCode: string; contractId: string; dueDate: Date; amount: number }[]; stats: { dueMonth: number; paidMonth: number; overdueAmt: number; rate: number } }> {
  const org = user.organizationId;
  if (isScoped(user) && !user.assignedPropertyIds.includes(propertyId)) return { claims: [], upcoming: [], stats: { dueMonth: 0, paidMonth: 0, overdueAmt: 0, rate: 0 } };
  const now = new Date();
  const [settings, inst, monthInst, upcomingRows] = await Promise.all([
    getOrgSettings(org),
    db.installment.findMany({
      where: { organizationId: org, status: { in: OPEN_INSTALLMENT }, contract: { propertyId, ...(unitId ? { unitId } : {}) } },
      orderBy: { dueDate: "asc" },
      include: {
        tenant: { select: { id: true, name: true, phone: true, email: true, riskLevel: true } },
        contract: { select: { id: true, code: true, paymentFrequency: true, unit: { select: { id: true, number: true } } } },
        collectionCase: { include: { collector: { select: { id: true, name: true } }, actions: { orderBy: { createdAt: "desc" }, take: 1, select: { type: true, createdAt: true, note: true } } } },
      },
    }),
    db.installment.findMany({ where: { organizationId: org, dueDate: { gte: startOfMonth(now), lte: endOfMonth(now) }, status: { not: "WAIVED" }, contract: { propertyId } }, select: { amount: true, paidAmount: true } }),
    db.installment.findMany({
      where: { organizationId: org, status: "UPCOMING", dueDate: { lte: addDays(now, 60) }, contract: { propertyId, ...(unitId ? { unitId } : {}) } },
      orderBy: { dueDate: "asc" },
      take: 20,
      select: { id: true, seq: true, dueDate: true, amount: true, tenant: { select: { id: true, name: true } }, contract: { select: { id: true, code: true, unit: { select: { number: true } } } } },
    }),
  ]);

  // Tenant history for the risk indicator (one query for all tenants on the property).
  const tenantIds = [...new Set(inst.map((i) => i.tenantId))];
  const since = addMonths(now, -12);
  const history = tenantIds.length
    ? await db.installment.findMany({
        where: { organizationId: org, tenantId: { in: tenantIds }, dueDate: { gte: since } },
        select: {
          tenantId: true,
          status: true,
          dueDate: true,
          amount: true,
          paidAmount: true,
          contract: { select: { paymentFrequency: true } },
          collectionCase: { select: { brokenPromises: true } },
          allocations: { select: { payment: { select: { paidAt: true, status: true } } } },
        },
      })
    : [];
  const riskOf = (tenantId: string, riskLevel: string | null) => {
    const h = history.filter((x) => x.tenantId === tenantId);
    return tenantRisk({
      overdueCount12m: h.filter((x) => wasPastGrace(x, settings)).length,
      brokenPromises: h.reduce((s, x) => s + (x.collectionCase?.brokenPromises ?? 0), 0),
      partialPayments: h.filter((x) => x.status === "PARTIALLY_PAID").length,
      currentLateDays: h.filter((x) => OPEN_INSTALLMENT.includes(x.status)).reduce((m, x) => Math.max(m, daysOverdue(x.dueDate)), 0),
      riskLevel,
    });
  };

  const all: ClaimRow[] = inst.map((i) => {
    const k = i.collectionCase;
    const remaining = i.amount - i.paidAmount;
    const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
    return {
      installmentId: i.id,
      caseId: k?.id ?? null,
      seq: i.seq,
      tenantId: i.tenant.id,
      tenantName: i.tenant.name,
      phone: i.tenant.phone,
      email: i.tenant.email,
      unitId: i.contract.unit.id,
      unitNumber: i.contract.unit.number,
      contractId: i.contract.id,
      contractCode: i.contract.code,
      dueDate: i.dueDate.toISOString(),
      amount: i.amount,
      paidAmount: i.paidAmount,
      remaining,
      late: daysOverdue(i.dueDate),
      graceDays: graceDaysFor(i.contract.paymentFrequency, settings),
      enforceable: enforcementEligible(i, i.contract, settings),
      status: i.status,
      followUpStatus: k?.followUpStatus ?? null,
      priority: k?.priority ?? 0,
      collectorId: k?.collectorId ?? null,
      collectorName: k?.collector?.name ?? null,
      nextAction: k?.nextAction ?? null,
      nextActionDate: iso(k?.nextActionDate),
      promiseAmount: k?.promiseAmount ?? null,
      promiseDate: iso(k?.promiseDate),
      brokenPromises: k?.brokenPromises ?? 0,
      lastAction: k?.actions[0] ? { type: k.actions[0].type, at: k.actions[0].createdAt.toISOString(), note: k.actions[0].note } : null,
      risk: riskOf(i.tenant.id, i.tenant.riskLevel),
    };
  });
  const claims = all
    .filter((c) => {
      switch (filter) {
        case "overdue":
          return c.late > 0;
        case "promise":
          return c.followUpStatus === "PROMISE_TO_PAY";
        case "broken":
          return c.followUpStatus === "BROKEN_PROMISE";
        case "escalated":
          return c.followUpStatus === "ESCALATED";
        case "unassigned":
          return !!c.caseId && !c.collectorId;
        default:
          return true;
      }
    })
    .sort((a, b) => b.priority - a.priority || b.late - a.late);
  const dueMonth = monthInst.reduce((s, i) => s + i.amount, 0);
  const paidMonth = monthInst.reduce((s, i) => s + i.paidAmount, 0);
  return {
    claims,
    upcoming: upcomingRows.map((u) => ({ id: u.id, seq: u.seq, tenantName: u.tenant.name, tenantId: u.tenant.id, unitNumber: u.contract.unit.number, contractCode: u.contract.code, contractId: u.contract.id, dueDate: u.dueDate, amount: u.amount })),
    stats: { dueMonth, paidMonth, overdueAmt: all.filter((c) => c.late > 0).reduce((s, c) => s + c.remaining, 0), rate: dueMonth ? (paidMonth / dueMonth) * 100 : 0 },
  };
}

/**
 * True when an installment was actually late — i.e. it went (or is) past the statutory grace period.
 * A case being open is not enough: cases open on DUE, inside grace, and tenants paying inside grace are not late.
 * Data used: the installment has no "paidAt", so for settled installments the settlement date is the latest
 * live (non-reversed / non-returned) allocation's payment date; for open ones the calendar decides.
 */
export function wasPastGrace(
  x: { status: string; dueDate: Date; amount: number; paidAmount: number; contract: { paymentFrequency: string | null }; allocations: { payment: { paidAt: Date; status: string } }[] },
  settings: OrgSettings,
): boolean {
  if (x.status === "WAIVED") return false;
  const graceEnd = addDays(x.dueDate, graceDaysFor(x.contract.paymentFrequency, settings));
  graceEnd.setHours(23, 59, 59, 999);
  const settled = x.status === "PAID" || x.paidAmount >= x.amount - 0.01;
  if (!settled) return new Date() > graceEnd;
  const live = x.allocations.filter((a) => a.payment.status !== "REVERSED" && a.payment.status !== "RETURNED");
  if (!live.length) return false;
  const settledAt = live.reduce((m, a) => (a.payment.paidAt > m ? a.payment.paidAt : m), live[0].payment.paidAt);
  return settledAt > graceEnd;
}

/**
 * "المتأخرات" for owner-facing figures: only money past the statutory grace period counts —
 * OVERDUE installments, or PARTIALLY_PAID ones whose grace has already run out (the engine is throttled,
 * so the stored status can lag the calendar).
 */
export function isArrears(
  i: { status: string; dueDate: Date; amount: number; paidAmount: number; contract: { paymentFrequency: string } },
  settings: OrgSettings,
): boolean {
  if (i.status === "OVERDUE") return true;
  return i.status === "PARTIALLY_PAID" && enforcementEligible(i, i.contract, settings);
}

/** Days until the grace period ends for an open claim (negative = already past). */
export function daysToEnforcement(c: Pick<ClaimRow, "late" | "graceDays">) {
  return c.graceDays - c.late;
}

export { daysFromToday };
