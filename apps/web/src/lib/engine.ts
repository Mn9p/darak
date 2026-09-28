// Workflow / Financial engine.
// - Computes installment & contract statuses from dates and amounts
// - Opens collection cases, scores priority, detects broken promises
// - Runs automation rules (tasks + notifications)
// Idempotent: safe to call on every page load of the dashboard or via a scheduled job.

import { db } from "./db";
import { DEFAULT_ORG_SETTINGS, type OrgSettings, FREQUENCY_MONTHS } from "./constants";
import { addMonths, daysFromToday, daysOverdue, safeJson, addDays, date as fmtDate, money as fmtMoney, ksaDate, startOfDay, endOfDay as fmtEndOfDay } from "./format";
import { autoTask, notify } from "./notify";
import { sendMessage, renderTemplate, type Channel, type SendResult } from "./channels";
import { logger } from "./logger";

export async function getOrgSettings(organizationId: string): Promise<OrgSettings> {
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { settings: true } });
  return { ...DEFAULT_ORG_SETTINGS, ...safeJson<Partial<OrgSettings>>(org?.settings, {}) };
}

// Schedule math lives in lib/schedule (pure, shared with the contract form preview).
export { buildSchedule, scheduleCount, contractMonths, annualRent } from "./schedule";

/**
 * Grace days after the due date before an installment counts as OVERDUE.
 * With `statutoryGrace` on (default) the office follows the statutory rule: 15 days for monthly / quarterly rent,
 * 30 days for semi-annual / annual / custom schedules. Otherwise the office-wide `graceDays` applies.
 */
export function graceDaysFor(frequency: string | null | undefined, settings: OrgSettings): number {
  if (!settings.statutoryGrace || !frequency) return settings.graceDays;
  return frequency === "MONTHLY" || frequency === "QUARTERLY" ? 15 : 30;
}

export function computeInstallmentStatus(
  inst: { dueDate: Date; amount: number; paidAmount: number; status: string },
  settings: OrgSettings,
  frequency?: string | null,
): string {
  // A waiver lowered amount to what was paid: it stays WAIVED only while that payment stands (a bounced cheque re-opens it).
  if (inst.status === "WAIVED" && inst.paidAmount >= inst.amount - 0.01) return "WAIVED";
  if (inst.paidAmount >= inst.amount - 0.01) return "PAID";
  const grace = graceDaysFor(frequency, settings);
  const d = daysFromToday(inst.dueDate); // positive => future
  if (inst.paidAmount > 0) {
    if (d < -grace) return "OVERDUE";
    return "PARTIALLY_PAID";
  }
  if (d > 0) return "UPCOMING";
  if (d >= -grace) return "DUE"; // due today or inside the grace period
  return "OVERDUE";
}

/**
 * An unpaid installment past the statutory grace period can be taken to enforcement (طلب تنفيذ مالي عبر ناجز).
 * Pure helper for badges and counters.
 */
export function enforcementEligible(
  inst: { dueDate: Date; amount: number; paidAmount: number; status: string },
  contract: { paymentFrequency: string },
  settings: OrgSettings,
): boolean {
  if (inst.status === "WAIVED" || inst.paidAmount >= inst.amount - 0.01) return false;
  return daysOverdue(inst.dueDate) > graceDaysFor(contract.paymentFrequency, settings);
}

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

/**
 * Deterministic late-payment indicator for a tenant (0-100 + reasons). No model involved: the reasons are
 * shown next to the level so the office can see why.
 */
export function tenantRisk(h: { overdueCount12m: number; brokenPromises: number; partialPayments: number; currentLateDays: number; riskLevel?: string | null }): { score: number; level: RiskLevel; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  if (h.overdueCount12m > 0) {
    score += Math.min(40, h.overdueCount12m * 15);
    reasons.push(`${h.overdueCount12m} دفعة متأخرة خلال سنة`);
  }
  if (h.brokenPromises > 0) {
    score += Math.min(30, h.brokenPromises * 15);
    reasons.push(`${h.brokenPromises} وعد سداد مكسور`);
  }
  if (h.partialPayments > 0) {
    score += Math.min(10, h.partialPayments * 5);
    reasons.push(`${h.partialPayments} سداد جزئي`);
  }
  if (h.currentLateDays > 0) {
    score += Math.min(20, Math.round(h.currentLateDays / 3));
    reasons.push(`متأخر حاليًا ${h.currentLateDays} يوم`);
  }
  if (h.riskLevel === "HIGH") {
    score += 15;
    reasons.push("مصنف مرتفع المخاطر");
  } else if (h.riskLevel === "MEDIUM") score += 5;
  score = Math.min(100, score);
  const level: RiskLevel = score >= 55 ? "HIGH" : score >= 25 ? "MEDIUM" : "LOW";
  if (!reasons.length) reasons.push("لا يوجد تأخر مسجل");
  return { score, level, reasons };
}

/** Renewal answers that mean a renewal is actually in progress (NO_RENEWAL / NO_RESPONSE keep the contract EXPIRING_SOON). */
const RENEWAL_IN_PROGRESS = ["WANTS_RENEWAL", "NEGOTIATING", "APPROVED"];

export function computeContractStatus(c: { startDate: Date; endDate: Date; status: string; renewalStatus: string | null }): string {
  const terminal = ["DRAFT", "PENDING_APPROVAL", "RENEWED", "TERMINATED", "CANCELLED"];
  if (terminal.includes(c.status)) return c.status;
  const toEnd = daysFromToday(c.endDate);
  if (toEnd < 0) return "EXPIRED";
  if (toEnd <= 90) {
    if (c.renewalStatus && RENEWAL_IN_PROGRESS.includes(c.renewalStatus)) return "RENEWAL_PENDING";
    return "EXPIRING_SOON";
  }
  return "ACTIVE";
}

/** 23:59:59.999 Riyadh time of the day that `d` falls on. Date-only inputs ("yyyy-mm-dd") are Riyadh calendar days. */
export function endOfDay(d: Date | string): Date {
  if (typeof d === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d.trim());
    if (m) return ksaDate(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999);
  }
  return fmtEndOfDay(d);
}

/**
 * Was a promise to pay kept? Money allocated to the installment since the promise was recorded (payments that still stand)
 * must reach the promised amount (or any amount when none was given).
 */
async function promiseKept(caseId: string, installmentId: string, promiseAmount: number | null): Promise<boolean> {
  const promise = await db.collectionAction.findFirst({ where: { caseId, type: "PROMISE" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  if (!promise) return false;
  const paid = await db.paymentAllocation.aggregate({
    where: { installmentId, createdAt: { gte: promise.createdAt }, payment: { status: { notIn: ["REVERSED", "RETURNED"] } } },
    _sum: { amount: true },
  });
  const sum = paid._sum.amount ?? 0;
  return promiseAmount && promiseAmount > 0 ? sum >= promiseAmount - 0.01 : sum > 0.009;
}

/**
 * A promise to pay is broken only once the whole promised day has passed (the tenant has until midnight),
 * whatever time of day the promise date was stored with.
 */
export function promiseBroken(promiseDate: Date | string | null | undefined, now: Date = new Date()): boolean {
  if (!promiseDate) return false;
  return now.getTime() > endOfDay(promiseDate).getTime();
}

/**
 * Ownership share (%) of a property at a given date: the sum of the ownership rows in force on that day.
 * Used so a change of ownership inside a statement period pays each line to whoever owned the property on the day the money moved.
 *
 * Opening rows (registered before any ownership row of the property was ever closed) have no lower bound: history entered
 * after the property was created — imported or back-dated contracts, payments, expenses — belongs to the original owners.
 * Rows created by a transfer (they start when earlier rows were closed) apply from their start only.
 * `firstClose`: per property, the earliest endDate across ALL owners' rows (see ownershipFirstClose). Without it every row
 * is bounded by its start date.
 */
export function ownershipPctAt(
  rows: { propertyId: string; percentage: number; startDate: Date; endDate: Date | null }[],
  propertyId: string,
  at: Date,
  firstClose?: Map<string, number | null>,
): number {
  const d = at.getTime();
  const opening = (r: { propertyId: string; startDate: Date }) => {
    if (!firstClose) return false;
    const fc = firstClose.get(r.propertyId);
    return fc == null || r.startDate.getTime() < fc;
  };
  return rows
    .filter((r) => r.propertyId === propertyId && (r.startDate.getTime() <= d || opening(r)) && (!r.endDate || r.endDate.getTime() >= d))
    .reduce((s, r) => s + r.percentage, 0);
}

/** Earliest ownership-row closure per property (all owners), or null when ownership never changed. Feeds ownershipPctAt. */
export async function ownershipFirstClose(propertyIds: string[]): Promise<Map<string, number | null>> {
  const map = new Map<string, number | null>(propertyIds.map((id) => [id, null]));
  if (!propertyIds.length) return map;
  const closed = await db.propertyOwnership.groupBy({ by: ["propertyId"], where: { propertyId: { in: propertyIds }, endDate: { not: null } }, _min: { endDate: true } });
  for (const c of closed) map.set(c.propertyId, c._min.endDate ? c._min.endDate.getTime() : null);
  return map;
}

/** Priority score 0-100 for a collection case. Higher = call first. */
export function scorePriority(input: {
  remaining: number;
  daysLate: number;
  brokenPromises: number;
  daysSinceLastAction: number | null;
  contractEndsInDays: number;
  tenantRisk: string;
}): number {
  let s = 0;
  s += Math.min(30, input.remaining / 2000); // 30 pts at 60k
  s += Math.min(30, input.daysLate * 0.5); // 30 pts at 60 days
  s += Math.min(15, input.brokenPromises * 7);
  if (input.daysSinceLastAction === null) s += 10;
  else s += Math.min(10, input.daysSinceLastAction);
  if (input.contractEndsInDays <= 30) s += 10;
  if (input.tenantRisk === "HIGH") s += 5;
  else if (input.tenantRisk === "MEDIUM") s += 2;
  return Math.round(Math.min(100, s));
}

const lastRun = new Map<string, number>();
const ENGINE_TTL_MS = 10 * 60 * 1000;
const LEASE_ENTITY = "engine_lease";

/**
 * Cross-instance lease: the Sequence row "engine_lease" holds the unix time (s) of the last engine start for the office.
 * The conditional update succeeds for exactly one caller per window, on every server instance (serverless-safe).
 */
async function takeEngineLease(organizationId: string, ttlMs: number): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  await db.sequence.upsert({ where: { organizationId_entity: { organizationId, entity: LEASE_ENTITY } }, create: { organizationId, entity: LEASE_ENTITY, value: 0 }, update: {} });
  const { count } = await db.sequence.updateMany({ where: { organizationId, entity: LEASE_ENTITY, value: { lt: now - Math.floor(ttlMs / 1000) } }, data: { value: now } });
  return count === 1;
}

async function releaseEngineLease(organizationId: string) {
  await db.sequence.updateMany({ where: { organizationId, entity: LEASE_ENTITY }, data: { value: 0 } }).catch(() => {});
}

/** Runs the engine at most once per 10 minutes per office (all server instances). Pages use this; never throws. */
export async function runEngineThrottled(organizationId: string) {
  const at = lastRun.get(organizationId) ?? 0;
  if (Date.now() - at < ENGINE_TTL_MS) return { updates: 0, skipped: true };
  lastRun.set(organizationId, Date.now());
  try {
    if (!(await takeEngineLease(organizationId, ENGINE_TTL_MS))) return { updates: 0, skipped: true };
    return { ...(await runEngine(organizationId)), skipped: false };
  } catch (e) {
    lastRun.delete(organizationId);
    await releaseEngineLease(organizationId);
    logger.error("engine.page_run_failed", { organizationId, error: String(e) });
    return { updates: 0, skipped: true };
  }
}

/** Cron: runs unless another instance started a run in the last few minutes. */
export async function runEngineLeased(organizationId: string, ttlMs = 5 * 60 * 1000) {
  if (!(await takeEngineLease(organizationId, ttlMs))) return { updates: 0, skipped: true };
  try {
    return { ...(await runEngine(organizationId)), skipped: false };
  } catch (e) {
    await releaseEngineLease(organizationId);
    throw e;
  }
}

/**
 * Recompute all statuses and run automations for an organization.
 * Called by /api/cron/run (and throttled from the dashboard).
 */
export async function runEngine(organizationId: string) {
  const settings = await getOrgSettings(organizationId);
  const now = new Date();
  let updates = 0;

  // ── 1. Contract statuses ──
  const contracts = await db.contract.findMany({
    where: { organizationId, status: { notIn: ["DRAFT", "PENDING_APPROVAL", "RENEWED", "TERMINATED", "CANCELLED"] } },
    include: { unit: { select: { id: true, number: true, status: true } }, tenant: { select: { id: true, name: true, phone: true, email: true } }, property: { select: { name: true, managerId: true } } },
  });
  for (const c of contracts) {
    const next = computeContractStatus(c);
    if (next !== c.status) {
      await db.contract.update({ where: { id: c.id }, data: { status: next } });
      updates++;
      if (next === "EXPIRED") {
        await db.unit.update({ where: { id: c.unitId }, data: { status: "VACANT" } });
        await autoTask({
          organizationId,
          title: `وحدة شاغرة بعد انتهاء العقد — ${c.unit.number}`,
          description: `انتهى العقد ${c.code} للمستأجر ${c.tenant.name}. يرجى تجهيز الوحدة للتأجير.`,
          role: "LEASING",
          priority: "HIGH",
          entityType: "UNIT",
          entityId: c.unitId,
          entityLabel: c.unit.number,
        });
      }
    }
    // Renewal workflow: 90 notify, 60 task, 30 escalate
    const toEnd = daysFromToday(c.endDate);
    if (toEnd >= 0 && toEnd <= 90 && !["RENEWED", "TERMINATED", "CANCELLED"].includes(next)) {
      const followUpDone = toEnd <= 60 && (Boolean(c.renewalStatus) || Boolean(await db.task.findFirst({ where: { organizationId, entityType: "CONTRACT", entityId: c.id, isAutomated: true, status: "COMPLETED" }, select: { id: true } })));
      if (toEnd <= 60 && !followUpDone) {
        await autoTask({
          organizationId,
          title: `متابعة تجديد العقد ${c.code} — ${c.tenant.name}`,
          description: `ينتهي العقد خلال ${toEnd} يومًا. تواصل مع المستأجر لتحديد رغبته بالتجديد.`,
          role: "LEASING",
          priority: toEnd <= 30 ? "URGENT" : "HIGH",
          dueDate: addDays(now, 7),
          entityType: "CONTRACT",
          entityId: c.id,
          entityLabel: c.code,
        });
      }
      // Tenant-facing notice (rule with TENANT target, e.g. email 60 days before) — sent once per contract.
      if (toEnd <= 60) {
        await sendTenantEvent(organizationId, "CONTRACT_EXPIRING", c.tenant, {
          tenant_name: c.tenant.name,
          unit_number: c.unit.number,
          property_name: c.property.name,
          contract_code: c.code,
          end_date: fmtDate(c.endDate),
          days_left: toEnd,
        }, { entityType: "CONTRACT", entityId: c.id, dedupeDays: 90 });
      }
      if (toEnd <= 30 && !c.renewalStatus) {
        await notifyOnce(organizationId, `تصعيد: العقد ${c.code} ينتهي خلال ${toEnd} يومًا بدون قرار تجديد`, {
          roles: ["OFFICE_MANAGER"],
          userIds: c.property.managerId ? [c.property.managerId] : [],
          severity: "DANGER",
          entityType: "CONTRACT",
          entityId: c.id,
          href: `/contracts/${c.id}`,
        });
      }
    }
  }

  // ── 2. Installment statuses + collection cases ──
  const installments = await db.installment.findMany({
    where: { organizationId, status: { notIn: ["PAID", "WAIVED"] } },
    include: {
      contract: { select: { id: true, code: true, endDate: true, status: true, paymentFrequency: true, unit: { select: { number: true } }, property: { select: { name: true } } } },
      tenant: { select: { id: true, name: true, riskLevel: true, phone: true, email: true } },
      collectionCase: { select: { id: true, followUpStatus: true, promiseDate: true, promiseAmount: true, brokenPromises: true, lastActionAt: true, collectorId: true, escalatedAt: true } },
    },
  });
  for (const inst of installments) {
    const next = computeInstallmentStatus(inst, settings, inst.contract.paymentFrequency);
    if (next !== inst.status) {
      await db.installment.update({ where: { id: inst.id }, data: { status: next } });
      updates++;
    }
    const remaining = inst.amount - inst.paidAmount;
    const late = daysOverdue(inst.dueDate);

    if (next === "PAID") {
      if (inst.collectionCase && inst.collectionCase.followUpStatus !== "PAID") {
        await db.collectionCase.update({ where: { id: inst.collectionCase.id }, data: { followUpStatus: "PAID", priority: 0 } });
      }
      continue;
    }

    // open a collection case on DUE / OVERDUE / partial-late
    if (["DUE", "OVERDUE"].includes(next) || (next === "PARTIALLY_PAID" && late > 0)) {
      let kase = inst.collectionCase;
      if (!kase) {
        const collector = await db.user.findFirst({ where: { organizationId, role: "COLLECTOR", status: "ACTIVE" }, select: { id: true } });
        try {
          const created = await db.collectionCase.create({
            data: { organizationId, installmentId: inst.id, collectorId: collector?.id ?? null, followUpStatus: "OPEN" },
          });
          kase = { id: created.id, followUpStatus: "OPEN", promiseDate: null, promiseAmount: null, brokenPromises: 0, lastActionAt: null, collectorId: collector?.id ?? null, escalatedAt: null };
          await db.collectionAction.create({ data: { caseId: created.id, type: "SYSTEM", note: "تم فتح مطالبة تلقائيًا عند حلول تاريخ الاستحقاق." } });
        } catch (e) {
          // Another run opened it a moment ago (installmentId is unique): continue with that case.
          const existing = await db.collectionCase.findUnique({ where: { installmentId: inst.id }, select: { id: true, followUpStatus: true, promiseDate: true, promiseAmount: true, brokenPromises: true, lastActionAt: true, collectorId: true, escalatedAt: true } });
          if (!existing) throw e;
          kase = existing;
        }
      }
      // The tenant hears "overdue" only when the statutory grace has really passed — once, on the move to OVERDUE.
      if (next === "OVERDUE" && inst.status !== "OVERDUE") {
        await sendTenantEvent(organizationId, "INSTALLMENT_OVERDUE", inst.tenant, installmentVars(inst, remaining), { entityType: "INSTALLMENT", entityId: inst.id, dedupeDays: 1 });
      }

      // Broken promise detection — the promised day must be fully over (see promiseBroken), so a promise
      // made "for today" is not flagged on the next engine run.
      let broken = kase.brokenPromises;
      let follow = kase.followUpStatus;
      if (follow === "PROMISE_TO_PAY" && promiseBroken(kase.promiseDate, now) && (await promiseKept(kase.id, inst.id, kase.promiseAmount))) {
        // Paid what was promised (partly or fully) by the promised day: the promise was kept, not broken.
        follow = "OPEN";
        await db.collectionAction.create({ data: { caseId: kase.id, type: "SYSTEM", note: "تم الوفاء بوعد السداد في موعده." } });
      } else if (follow === "PROMISE_TO_PAY" && promiseBroken(kase.promiseDate, now)) {
        follow = "BROKEN_PROMISE";
        broken += 1;
        await db.collectionAction.create({ data: { caseId: kase.id, type: "SYSTEM", outcome: "REFUSED", note: "مر تاريخ وعد السداد دون استلام دفعة — وعد مكسور." } });
        await notify({
          organizationId,
          roles: ["OFFICE_MANAGER"],
          title: `وعد سداد مكسور — ${inst.tenant.name}`,
          body: `الوحدة ${inst.contract.unit.number} · المتبقي ${Math.round(remaining)} ريال`,
          severity: "DANGER",
          entityType: "COLLECTION",
          entityId: kase.id,
          href: `/collections/${kase.id}`,
        });
      }

      const priority = scorePriority({
        remaining,
        daysLate: late,
        brokenPromises: broken,
        daysSinceLastAction: kase.lastActionAt ? -daysFromToday(kase.lastActionAt) : null,
        contractEndsInDays: daysFromToday(inst.contract.endDate),
        tenantRisk: inst.tenant.riskLevel,
      });
      await db.collectionCase.update({ where: { id: kase.id }, data: { priority, followUpStatus: follow, brokenPromises: broken } });

      // Escalation rule: > 30 days late and > 10k. Fires once per case (escalatedAt is the marker) and never
      // overrides a live promise or a dispute the collector is handling.
      const escalatable = !["ESCALATED", "PROMISE_TO_PAY", "DISPUTED"].includes(follow);
      if (late > 30 && remaining > 10000 && escalatable && !kase.escalatedAt) {
        await db.collectionCase.update({ where: { id: kase.id }, data: { followUpStatus: "ESCALATED", escalatedAt: now } });
        await db.collectionAction.create({ data: { caseId: kase.id, type: "ESCALATION", note: `تصعيد تلقائي: التأخر ${late} يومًا والمبلغ ${Math.round(remaining)} ريال.` } });
        await notifyOnce(organizationId, `تصعيد مطالبة — ${inst.tenant.name}`, {
          roles: ["OFFICE_MANAGER"],
          severity: "DANGER",
          entityType: "COLLECTION",
          entityId: kase.id,
          href: `/collections/${kase.id}`,
        });
      }
    }

    // Due soon reminder (tenant portal notification + template-driven SMS/WhatsApp/Email — once per installment per day)
    const daysUntilDue = daysFromToday(inst.dueDate);
    if (next === "UPCOMING" && daysUntilDue <= settings.dueSoonDays || next === "DUE" && daysUntilDue === 0) {
      const portal = await db.user.findFirst({ where: { tenantId: inst.tenant.id }, select: { id: true } });
      if (portal) {
        await notifyOnce(organizationId, `تذكير: دفعة بقيمة ${Math.round(remaining)} ريال تستحق ${daysUntilDue === 0 ? "اليوم" : "قريبًا"} — الوحدة ${inst.contract.unit.number}`, {
          userIds: [portal.id],
          severity: "WARNING",
          entityType: "INSTALLMENT",
          entityId: inst.id,
          href: `/tenant/payments`,
        });
      }
      await sendTenantEvent(organizationId, "INSTALLMENT_DUE", inst.tenant, installmentVars(inst, remaining), {
        entityType: "INSTALLMENT",
        entityId: inst.id,
        dedupeDays: 1,
        daysUntil: daysFromToday(inst.dueDate),
      });
    }
  }

  // ── 3. Unit status consistency ──
  // RESERVED only while a contract awaits approval on the unit (a pending contract moved to another unit releases it).
  const pendingUnits = new Set((await db.contract.findMany({ where: { organizationId, status: "PENDING_APPROVAL" }, select: { unitId: true } })).map((c) => c.unitId));
  const reserved = await db.unit.findMany({ where: { organizationId, status: "RESERVED" }, select: { id: true } });
  for (const u of reserved) {
    if (!pendingUnits.has(u.id)) {
      await db.unit.update({ where: { id: u.id }, data: { status: "VACANT" } });
      updates++;
    }
  }
  const activeUnits = await db.contract.findMany({
    where: { organizationId, status: { in: ["ACTIVE", "EXPIRING_SOON", "RENEWAL_PENDING"] } },
    select: { unitId: true },
  });
  const rentedIds = new Set(activeUnits.map((c) => c.unitId));
  const units = await db.unit.findMany({ where: { organizationId, status: { notIn: ["ARCHIVED", "UNDER_MAINTENANCE", "UNAVAILABLE", "RESERVED"] } }, select: { id: true, status: true, number: true } });
  for (const u of units) {
    const should = rentedIds.has(u.id) ? "RENTED" : u.status === "AVAILABLE" ? "AVAILABLE" : "VACANT";
    if (u.status !== should && !(u.status === "AVAILABLE" && should === "VACANT")) {
      await db.unit.update({ where: { id: u.id }, data: { status: should } });
      updates++;
    }
  }

  // ── 4. Document expiry ──
  const docs = await db.document.findMany({
    where: { organizationId, expiryDate: { not: null, lte: addDays(now, 30) } },
    select: { id: true, name: true, expiryDate: true, uploadedById: true, entityType: true, entityId: true, entityLabel: true },
  });
  for (const d of docs) {
    const left = daysFromToday(d.expiryDate!);
    await autoTask({
      organizationId,
      title: `تجديد مستند: ${d.name}`,
      description: left < 0 ? `انتهى المستند قبل ${-left} يومًا.` : `ينتهي المستند خلال ${left} يومًا.`,
      assignedToId: d.uploadedById,
      role: "OFFICE_MANAGER",
      priority: left <= 7 ? "URGENT" : "MEDIUM",
      dueDate: d.expiryDate,
      entityType: "DOCUMENT",
      entityId: d.id,
      entityLabel: d.name,
    });
  }

  // ── 6. Expense approvals pending ──
  const pending = await db.expense.count({ where: { organizationId, approvalStatus: "PENDING" } });
  if (pending > 0) {
    await notifyOnce(organizationId, `يوجد ${pending} مصروف بانتظار الاعتماد`, {
      roles: ["OFFICE_MANAGER"],
      severity: "INFO",
      entityType: "EXPENSE",
      href: "/expenses?approval=PENDING",
    });
  }

  // ── 7. Integration health ──
  const failed = await db.integration.findMany({ where: { organizationId, status: "ERROR" }, select: { id: true, name: true, lastError: true } });
  for (const f of failed) {
    await notifyOnce(organizationId, `فشل المزامنة: ${f.name}`, {
      roles: ["OFFICE_MANAGER"],
      severity: "DANGER",
      entityType: "INTEGRATION",
      entityId: f.id,
      href: "/integrations",
    });
  }

  return { updates };
}

/* ───────────── Template-driven tenant messaging ───────────── */

export type TenantEvent = "INSTALLMENT_DUE" | "INSTALLMENT_OVERDUE" | "PAYMENT_RECEIVED" | "CONTRACT_EXPIRING";
type TenantContact = { id?: string | null; name: string; phone?: string | null; email?: string | null };
type TemplateVars = Record<string, string | number | null | undefined>;
const EXTERNAL_CHANNELS: Channel[] = ["SMS", "WHATSAPP", "EMAIL"];
const EVENT_SUBJECT: Record<TenantEvent, string> = {
  INSTALLMENT_DUE: "تذكير باستحقاق دفعة",
  INSTALLMENT_OVERDUE: "تنبيه: دفعة متأخرة",
  PAYMENT_RECEIVED: "تأكيد استلام دفعة",
  CONTRACT_EXPIRING: "اقتراب انتهاء العقد",
};

function installmentVars(inst: { seq: number; dueDate: Date; amount: number; tenant: { name: string }; contract: { code: string; unit: { number: string }; property: { name: string } } }, remaining: number): TemplateVars {
  return {
    tenant_name: inst.tenant.name,
    unit_number: inst.contract.unit.number,
    property_name: inst.contract.property.name,
    contract_code: inst.contract.code,
    installment_seq: inst.seq,
    amount: fmtMoney(remaining),
    due_date: fmtDate(inst.dueDate),
  };
}

/**
 * Sends a tenant-facing message for an event through the channels configured in an active
 * NotificationRule whose targetRoles include TENANT, using the active NotificationTemplate of each channel.
 * Dedupes per entity for `dedupeDays` (marker = Notification row on the tenant portal user, or the
 * IntegrationLog written by the channel). Never throws — messaging must not break the workflow.
 */
export async function sendTenantEvent(
  organizationId: string,
  event: TenantEvent,
  tenant: TenantContact,
  vars: TemplateVars,
  opts: { entityType?: string; entityId?: string; dedupeDays?: number; daysUntil?: number } = {},
): Promise<{ sent: number; channels: Channel[]; results: Partial<Record<Channel, SendResult>> }> {
  const out: { sent: number; channels: Channel[]; results: Partial<Record<Channel, SendResult>> } = { sent: 0, channels: [], results: {} };
  try {
    const rules = (await db.notificationRule.findMany({ where: { organizationId, event, isActive: true } })).filter((r) => {
      if (!r.targetRoles.split(",").map((s) => s.trim()).includes("TENANT")) return false;
      // daysBefore acts as a window: only remind once the installment/contract is within N days.
      if (opts.daysUntil !== undefined && r.daysBefore > 0 && opts.daysUntil > r.daysBefore) return false;
      return true;
    });
    if (!rules.length) return out;
    const channels = [...new Set(rules.flatMap((r) => r.channels.split(",").map((s) => s.trim())))].filter((c): c is Channel => (EXTERNAL_CHANNELS as string[]).includes(c));
    if (!channels.length) return out;
    if (opts.entityId && (await sentRecently(organizationId, opts.entityId, opts.dedupeDays ?? 1))) return out;

    const templates = await db.notificationTemplate.findMany({ where: { organizationId, event, isActive: true, channel: { in: channels } }, orderBy: { createdAt: "asc" } });
    const portal = tenant.id ? await db.user.findFirst({ where: { tenantId: tenant.id, organizationId, status: "ACTIVE" }, select: { id: true } }) : null;
    for (const channel of channels) {
      const t = templates.find((x) => x.channel === channel);
      if (!t) continue;
      const to = channel === "EMAIL" ? tenant.email?.trim() : tenant.phone?.trim();
      if (!to) continue;
      const body = renderTemplate(t.body, vars);
      const r = await sendMessage({ organizationId, channel, to, body, subject: EVENT_SUBJECT[event], entityType: opts.entityType, entityId: opts.entityId });
      out.results[channel] = r;
      out.channels.push(channel);
      if (r.ok) out.sent++;
      // Marker row (also visible in the tenant portal): dedupes the next engine run.
      if (portal) {
        await db.notification.create({
          data: {
            organizationId,
            userId: portal.id,
            title: t.name,
            body,
            channel,
            severity: event === "INSTALLMENT_OVERDUE" ? "DANGER" : event === "PAYMENT_RECEIVED" ? "SUCCESS" : "WARNING",
            entityType: opts.entityType ?? null,
            entityId: opts.entityId ?? null,
            href: event === "CONTRACT_EXPIRING" ? "/tenant/contract" : "/tenant/payments",
            deliveredAt: r.ok ? new Date() : null,
          },
        });
      }
    }
  } catch (e) {
    logger.warn("engine.send_tenant_event_failed", { event, error: String(e) });
  }
  return out;
}

/** True when an external message for this entity was already sent within the window. */
async function sentRecently(organizationId: string, entityId: string, days: number) {
  const since = addDays(new Date(), -days);
  const marker = await db.notification.findFirst({ where: { organizationId, entityId, channel: { in: EXTERNAL_CHANNELS }, createdAt: { gte: since } }, select: { id: true } });
  if (marker) return true;
  const log = await db.integrationLog.findFirst({
    where: { integration: { organizationId, provider: { in: EXTERNAL_CHANNELS } }, createdAt: { gte: since }, payload: { contains: `"entityId":"${entityId}"` } },
    select: { id: true },
  });
  return Boolean(log);
}

/** Notification that is only created once per (title, entity) per 24h to avoid spam. */
async function notifyOnce(
  organizationId: string,
  title: string,
  opts: { roles?: string[]; userIds?: string[]; severity?: "INFO" | "WARNING" | "DANGER" | "SUCCESS"; entityType?: string; entityId?: string; href?: string },
) {
  const since = addDays(new Date(), -1);
  const exists = await db.notification.findFirst({
    where: { organizationId, title, entityId: opts.entityId ?? null, createdAt: { gte: since } },
    select: { id: true },
  });
  if (exists) return;
  await notify({ organizationId, title, ...opts });
}

/** Recalculate paid amounts & status for a set of installments after allocation changes. */
export async function refreshInstallments(organizationId: string, installmentIds: string[]) {
  const settings = await getOrgSettings(organizationId);
  for (const id of installmentIds) {
    const inst = await db.installment.findUnique({
      where: { id },
      include: { allocations: { include: { payment: { select: { status: true } } } }, collectionCase: true, contract: { select: { paymentFrequency: true, endDate: true } }, tenant: { select: { riskLevel: true } } },
    });
    if (!inst) continue;
    // Imported opening balance + live allocations of payments that still stand.
    const paid = Math.round((inst.openingPaid + inst.allocations.filter((a) => a.payment.status !== "REVERSED" && a.payment.status !== "RETURNED").reduce((s, a) => s + a.amount, 0)) * 100) / 100;
    const status = computeInstallmentStatus({ ...inst, paidAmount: paid }, settings, inst.contract.paymentFrequency);
    await db.installment.update({ where: { id }, data: { paidAmount: paid, status } });
    const kase = inst.collectionCase;
    if (!kase) continue;
    if (status === "PAID") {
      if (kase.followUpStatus !== "PAID" || kase.priority !== 0) {
        await db.collectionCase.update({ where: { id: kase.id }, data: { followUpStatus: "PAID", priority: 0 } });
      }
      await db.task.updateMany({ where: { organizationId, entityType: "INSTALLMENT", entityId: id, status: { notIn: ["COMPLETED", "CANCELLED"] } }, data: { status: "COMPLETED", completedAt: new Date() } });
      continue;
    }
    // A reversal / return put money back on the table: a case that was marked PAID (or closed after payment) goes back to
    // OPEN (same collector), gets a fresh priority and a note so the timeline explains the reopening.
    if ((kase.followUpStatus === "PAID" || kase.followUpStatus === "CLOSED") && status !== "WAIVED") {
      const remaining = inst.amount - paid;
      const priority = scorePriority({
        remaining,
        daysLate: daysOverdue(inst.dueDate),
        brokenPromises: kase.brokenPromises,
        daysSinceLastAction: kase.lastActionAt ? -daysFromToday(kase.lastActionAt) : null,
        contractEndsInDays: daysFromToday(inst.contract.endDate),
        tenantRisk: inst.tenant.riskLevel,
      });
      await db.collectionCase.update({ where: { id: kase.id }, data: { followUpStatus: "OPEN", priority, lastActionAt: new Date() } });
      await db.collectionAction.create({ data: { caseId: kase.id, type: "SYSTEM", note: "أعيد فتح المطالبة بعد عكس السداد." } });
    }
  }
}

/** One line of an owner statement (live or frozen). Amounts are the owner's share. */
export interface OwnerStatementLineView {
  /** ownerId:kind:refId:n — becomes OwnerStatementLine.ledgerKey when the statement is locked. */
  ledgerKey: string;
  kind: "RENT" | "EXPENSE";
  refId: string;
  propertyId: string;
  date: Date;
  label: string;
  category: string | null;
  /** Allocation amount (RENT) or expense total incl. VAT (EXPENSE), before the owner's share. 0 when unknown (removed source). */
  gross: number;
  amount: number;
  fee: number;
  /** Dated before the period, or corrects what an earlier locked statement paid. */
  carried: boolean;
  note: string | null;
}

export interface OwnerStatementOptions {
  /**
   * Ledger mode (owner statements). Each source row (allocation / expense) contributes the difference between its current
   * truth and what earlier locked statements already paid for it (OwnerStatementLine): late entries dated in locked periods,
   * bounced cheques and reversals (negative), and edits all settle here, and nothing is paid twice. Only approved سندات قبض count.
   * Carry-forward starts at the owner's first locked statement and never reaches before the owner's registration on the
   * property (older history was settled outside DARAK). Default false = plain figures for the period (reports, dashboards).
   */
  carry?: boolean;
  /** Statement being (re)computed, excluded from "already paid" (it is a draft while computed). */
  excludeStatementId?: string;
}

const LOCKED_STATEMENT = ["UNDER_REVIEW", "APPROVED", "PAID", "CLOSED"];
const EPS = 0.005;

/**
 * Owner statement figures for an owner over a period.
 * Share per line = ownership in force on the day the money moved (ownershipPctAt). Expenses charged to one owner
 * (Expense.ownerId) go 100% to that owner; other expenses are split by ownership. Management fee: the contract's rate for
 * the contract's own owner, each co-owner's own agreement rate otherwise.
 */
export async function computeOwnerStatement(
  organizationId: string,
  ownerId: string,
  periodStart: Date,
  periodEnd: Date,
  propertyId?: string | null,
  opts: OwnerStatementOptions = {},
) {
  const owner = await db.owner.findFirst({ where: { id: ownerId, organizationId }, include: { ownerships: { include: { property: { select: { id: true, name: true } } } } } });
  if (!owner) throw new Error("المالك غير موجود");
  const candidates = owner.ownerships.filter((o) => !propertyId || o.propertyId === propertyId);
  const firstClose = await ownershipFirstClose([...new Set(candidates.map((o) => o.propertyId))]);
  const opening = (o: { propertyId: string; startDate: Date }) => {
    const fc = firstClose.get(o.propertyId);
    return fc == null || o.startDate.getTime() < fc;
  };
  // Opening rows also cover periods before the property was registered (back-dated history).
  const ownerships = candidates.filter((o) => (o.startDate <= periodEnd || opening(o)) && (!o.endDate || o.endDate >= periodStart));
  const propertyIds = [...new Set(ownerships.map((o) => o.propertyId))];
  // All of the owner's rows: ownershipPctAt applies each row's own dates (a property sold earlier still has a share on old dates).
  const pctAt = (pid: string, at: Date) => ownershipPctAt(candidates, pid, at, firstClose);
  const everPropertyIds = [...new Set(candidates.map((o) => o.propertyId))];
  const ledger = Boolean(opts.carry);

  // What earlier locked statements already paid, per source row.
  type Frozen = { amount: number; fee: number; count: number; kind: "RENT" | "EXPENSE"; refId: string; propertyId: string; date: Date; label: string; category: string | null };
  const frozen = new Map<string, Frozen>();
  let carryFrom: Date | null = null;
  if (ledger && everPropertyIds.length) {
    const lockedWhere = { organizationId, ownerId, status: { in: LOCKED_STATEMENT }, ...(opts.excludeStatementId ? { id: { not: opts.excludeStatementId } } : {}) };
    const [first, rows] = await Promise.all([
      db.ownerStatement.aggregate({ where: lockedWhere, _min: { periodStart: true } }),
      db.ownerStatementLine.findMany({
        where: { ownerId, propertyId: { in: everPropertyIds }, date: { lte: periodEnd }, statement: lockedWhere },
        select: { kind: true, refId: true, propertyId: true, date: true, label: true, category: true, amount: true, fee: true },
        orderBy: { createdAt: "asc" },
      }),
    ]);
    carryFrom = first._min.periodStart ?? null;
    for (const r of rows) {
      const key = `${r.kind}:${r.refId}`;
      const f = frozen.get(key);
      if (f) {
        f.amount += r.amount;
        f.fee += r.fee;
        f.count += 1;
      } else {
        frozen.set(key, { amount: r.amount, fee: r.fee, count: 1, kind: r.kind as "RENT" | "EXPENSE", refId: r.refId, propertyId: r.propertyId, date: r.date, label: r.label, category: r.category });
      }
    }
  }
  // Carry window per property: from the owner's first locked statement, never before the owner's registration on it.
  const registeredAt = new Map<string, number>();
  for (const o of ownerships) {
    const t = startOfDay(o.startDate);
    const prev = registeredAt.get(o.propertyId);
    if (prev === undefined || t.getTime() < prev) registeredAt.set(o.propertyId, t.getTime());
  }
  const carryStart = (pid: string) => (carryFrom ? Math.max(carryFrom.getTime(), registeredAt.get(pid) ?? 0) : Number.POSITIVE_INFINITY);
  const windowStart = ledger && carryFrom && carryFrom < periodStart ? carryFrom : periodStart;
  const inPeriod = (d: Date) => d >= periodStart && d <= periodEnd;
  const eligible = (kind: string, id: string, pid: string, d: Date) => inPeriod(d) || frozen.has(`${kind}:${id}`) || (ledger && d.getTime() >= carryStart(pid) && d < periodStart);

  const frozenIds = (kind: "RENT" | "EXPENSE") => [...frozen.values()].filter((f) => f.kind === kind).map((f) => f.refId);
  const paymentStatuses = ledger ? ["APPROVED"] : ["RECORDED", "APPROVED"];
  const [allocations, expenseRows] = await Promise.all([
    everPropertyIds.length
      ? db.paymentAllocation.findMany({
          where: {
            payment: { organizationId, status: { in: paymentStatuses } },
            OR: [
              { payment: { paidAt: { gte: windowStart, lte: periodEnd } }, installment: { contract: { propertyId: { in: propertyIds } } } },
              { id: { in: frozenIds("RENT") } },
            ],
          },
          include: {
            installment: { select: { contract: { select: { propertyId: true, ownerId: true, managementFeePct: true, totalAmount: true, vatAmount: true, code: true, unit: { select: { number: true } } } } } },
            payment: { select: { paidAt: true, code: true } },
          },
        })
      : Promise.resolve([]),
    everPropertyIds.length
      ? db.expense.findMany({
          where: {
            organizationId,
            approvalStatus: "APPROVED",
            OR: [{ ownerId: null }, { ownerId }],
            AND: [{ OR: [{ date: { gte: windowStart, lte: periodEnd }, propertyId: { in: propertyIds } }, { id: { in: frozenIds("EXPENSE") } }] }],
          },
          select: { id: true, code: true, description: true, amount: true, vatAmount: true, propertyId: true, date: true, category: true, ownerId: true },
        })
      : Promise.resolve([]),
  ]);

  const seen = new Set<string>();
  const out: OwnerStatementLineView[] = [];
  const push = (kind: "RENT" | "EXPENSE", refId: string, pid: string, d: Date, label: string, category: string | null, gross: number, amount: number, fee: number) => {
    const key = `${kind}:${refId}`;
    seen.add(key);
    const prior = frozen.get(key);
    const dAmount = amount - (prior?.amount ?? 0);
    const dFee = fee - (prior?.fee ?? 0);
    if (Math.abs(dAmount) < EPS && Math.abs(dFee) < EPS) return;
    const carried = Boolean(prior) || !inPeriod(d);
    const note = prior ? "تسوية لما صُرف في كشف سابق" : carried ? "قيد متأخر من فترة سابقة" : null;
    out.push({ ledgerKey: `${ownerId}:${kind}:${refId}:${prior?.count ?? 0}`, kind, refId, propertyId: pid, date: d, label, category, gross, amount: r2(dAmount), fee: r2(dFee), carried, note });
  };

  for (const a of allocations) {
    const c = a.installment.contract;
    if (!eligible("RENT", a.id, c.propertyId, a.payment.paidAt)) continue;
    const share = (a.amount * pctAt(c.propertyId, a.payment.paidAt)) / 100;
    const feePct = c.ownerId === ownerId ? c.managementFeePct : owner.managementFeePct;
    // Installments carry rent + VAT; the management fee applies to the rent part only.
    const rentPart = c.vatAmount > 0 && c.totalAmount > 0 ? c.totalAmount / (c.totalAmount + c.vatAmount) : 1;
    push("RENT", a.id, c.propertyId, a.payment.paidAt, `${a.payment.code} · العقد ${c.code} · وحدة ${c.unit.number}`, null, a.amount, share, (share * rentPart * feePct) / 100);
  }
  for (const e of expenseRows) {
    if (!eligible("EXPENSE", e.id, e.propertyId, e.date)) continue;
    const total = e.amount + e.vatAmount;
    const share = e.ownerId === ownerId ? total : (total * pctAt(e.propertyId, e.date)) / 100;
    push("EXPENSE", e.id, e.propertyId, e.date, `${e.code} · ${e.description}`, e.category, total, share, 0);
  }
  // Sources an earlier statement paid that no longer count (reversed / returned payment, rejected or re-assigned expense).
  for (const [key, f] of frozen) {
    if (seen.has(key) || (Math.abs(f.amount) < EPS && Math.abs(f.fee) < EPS)) continue;
    out.push({
      ledgerKey: `${ownerId}:${f.kind}:${f.refId}:${f.count}`,
      kind: f.kind,
      refId: f.refId,
      propertyId: f.propertyId,
      date: f.date,
      label: f.label,
      category: f.category,
      gross: 0,
      amount: r2(-f.amount),
      fee: r2(-f.fee),
      carried: true,
      note: f.kind === "RENT" ? "عكس: السند أُلغي أو ارتد بعد صرفه في كشف سابق" : "عكس: المصروف أُلغي أو عُدّل بعد صرفه في كشف سابق",
    });
  }
  out.sort((x, y) => x.date.getTime() - y.date.getTime());
  return summarizeStatement(owner, ownerships, out);
}

/** Totals + view shape shared by live and frozen statements. */
function summarizeStatement<O extends { id: string; name: string }>(
  owner: O,
  ownerships: { propertyId: string; percentage: number; property: { name: string } }[],
  all: OwnerStatementLineView[],
) {
  const rent = all.filter((l) => l.kind === "RENT");
  const exp = all.filter((l) => l.kind === "EXPENSE");
  const collectedRent = r2(rent.reduce((s, l) => s + l.amount, 0));
  const managementFees = r2(rent.reduce((s, l) => s + l.fee, 0));
  const expenses = r2(exp.reduce((s, l) => s + l.amount, 0));
  const seenProps = new Set<string>();
  return {
    owner,
    properties: ownerships
      .filter((o) => (seenProps.has(o.propertyId) ? false : (seenProps.add(o.propertyId), true)))
      .map((o) => ({ id: o.propertyId, name: o.property.name, pct: o.percentage })),
    collectedRent,
    managementFees,
    expenses,
    netDue: r2(collectedRent - managementFees - expenses),
    all,
    lines: rent,
    expenseLines: exp,
    carriedCount: all.filter((l) => l.carried).length,
  };
}

export type OwnerStatementFigures = Awaited<ReturnType<typeof computeOwnerStatement>>;

/**
 * Lines + totals to show for a statement: live (ledger mode) while DRAFT, the frozen lines once locked.
 * Locked statements written before the ledger existed have no lines: they fall back to a live, period-only view.
 */
export async function statementFigures(s: { id: string; organizationId: string; ownerId: string; propertyId: string | null; periodStart: Date; periodEnd: Date; status: string }) {
  if (s.status === "DRAFT" || s.status === "CANCELLED") {
    return computeOwnerStatement(s.organizationId, s.ownerId, s.periodStart, s.periodEnd, s.propertyId, { carry: true, excludeStatementId: s.id });
  }
  const rows = await db.ownerStatementLine.findMany({ where: { statementId: s.id }, orderBy: { date: "asc" } });
  if (!rows.length) return computeOwnerStatement(s.organizationId, s.ownerId, s.periodStart, s.periodEnd, s.propertyId);
  const owner = await db.owner.findFirst({ where: { id: s.ownerId, organizationId: s.organizationId }, include: { ownerships: { include: { property: { select: { id: true, name: true } } } } } });
  if (!owner) throw new Error("المالك غير موجود");
  const props = new Set(rows.map((r) => r.propertyId));
  const lines: OwnerStatementLineView[] = rows.map((r) => ({
    ledgerKey: r.ledgerKey,
    kind: r.kind as "RENT" | "EXPENSE",
    refId: r.refId,
    propertyId: r.propertyId,
    date: r.date,
    label: r.label,
    category: r.category,
    gross: r.gross,
    amount: r.amount,
    fee: r.fee,
    carried: r.carried,
    note: r.note,
  }));
  return summarizeStatement(owner, owner.ownerships.filter((o) => props.has(o.propertyId) && !o.endDate), lines);
}

/**
 * Freezes a statement's lines (ledger mode, recomputed now) and stores its totals. Runs when the statement leaves DRAFT.
 * A concurrent lock of another statement that includes the same money fails on OwnerStatementLine.ledgerKey (unique).
 */
export async function freezeStatement(statementId: string) {
  const s = await db.ownerStatement.findUnique({ where: { id: statementId } });
  if (!s) throw new Error("التسوية غير موجودة");
  const f = await computeOwnerStatement(s.organizationId, s.ownerId, s.periodStart, s.periodEnd, s.propertyId, { carry: true, excludeStatementId: s.id });
  const netDue = r2(f.collectedRent - f.managementFees - f.expenses - s.otherDeductions);
  await db.$transaction([
    db.ownerStatementLine.deleteMany({ where: { statementId } }),
    db.ownerStatementLine.createMany({
      data: f.all.map((l) => ({
        statementId,
        ownerId: s.ownerId,
        propertyId: l.propertyId,
        kind: l.kind,
        refId: l.refId,
        ledgerKey: l.ledgerKey,
        date: l.date,
        label: l.label,
        category: l.category,
        gross: l.gross,
        amount: l.amount,
        fee: l.fee,
        carried: l.carried,
        note: l.note,
      })),
    }),
    db.ownerStatement.update({ where: { id: statementId }, data: { collectedRent: f.collectedRent, managementFees: f.managementFees, expenses: f.expenses, netDue } }),
  ]);
  return { ...f, netDue };
}

/** Drops a statement's frozen lines (statement returned to DRAFT): its money becomes unpaid again for later statements. */
export async function unfreezeStatement(statementId: string) {
  await db.ownerStatementLine.deleteMany({ where: { statementId } });
}

const r2 = (n: number) => Math.round(n * 100) / 100;
