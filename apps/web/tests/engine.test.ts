import { describe, it, expect } from "vitest";
import { buildSchedule, computeInstallmentStatus, computeContractStatus, scorePriority, graceDaysFor, enforcementEligible, tenantRisk, endOfDay, promiseBroken, ownershipPctAt } from "@/lib/engine";
import { wasPastGrace, isArrears } from "@/lib/collections";
import { DEFAULT_ORG_SETTINGS } from "@/lib/constants";
import { addDays, addMonths, daysBetween } from "@/lib/format";

const S = DEFAULT_ORG_SETTINGS;
const today = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

describe("buildSchedule", () => {
  it("splits an annual contract into 4 quarterly installments that sum exactly", () => {
    const rows = buildSchedule({ startDate: new Date("2026-01-01"), totalAmount: 45000, frequency: "QUARTERLY" });
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3, 4]);
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBeCloseTo(45000, 2);
    expect(rows[1].dueDate.getMonth()).toBe(3); // April
  });
  it("puts rounding remainder on the last installment", () => {
    const rows = buildSchedule({ startDate: new Date("2026-01-01"), totalAmount: 10000, frequency: "MONTHLY" });
    expect(rows).toHaveLength(12);
    expect(rows[0].amount).toBe(833.33);
    expect(rows[11].amount).toBeCloseTo(10000 - 833.33 * 11, 2);
  });
  it("supports a custom installment count", () => {
    const rows = buildSchedule({ startDate: new Date("2026-01-01"), totalAmount: 30000, frequency: "CUSTOM", installmentsCount: 3 });
    expect(rows).toHaveLength(3);
    expect(rows[2].amount).toBe(10000);
  });
  it("keeps month-end dates sane", () => {
    const rows = buildSchedule({ startDate: new Date("2026-01-31"), totalAmount: 1200, frequency: "MONTHLY" });
    expect(rows[1].dueDate.getMonth()).toBe(1); // Feb, clamped to 28
    expect(rows[1].dueDate.getDate()).toBe(28);
  });
});

describe("computeInstallmentStatus", () => {
  const base = { amount: 1000, paidAmount: 0, status: "UPCOMING" };
  it("UPCOMING far in the future", () => expect(computeInstallmentStatus({ ...base, dueDate: addDays(today(), 30) }, S)).toBe("UPCOMING"));
  it("UPCOMING until the due date", () => expect(computeInstallmentStatus({ ...base, dueDate: addDays(today(), 3) }, S)).toBe("UPCOMING"));
  it("DUE on the due date", () => expect(computeInstallmentStatus({ ...base, dueDate: today() }, S)).toBe("DUE"));
  it("DUE inside grace period", () => expect(computeInstallmentStatus({ ...base, dueDate: addDays(today(), -2) }, S)).toBe("DUE"));
  it("OVERDUE after grace", () => expect(computeInstallmentStatus({ ...base, dueDate: addDays(today(), -10) }, S)).toBe("OVERDUE"));
  it("PARTIALLY_PAID when partially paid and not past grace", () => expect(computeInstallmentStatus({ ...base, paidAmount: 400, dueDate: addDays(today(), -1) }, S)).toBe("PARTIALLY_PAID"));
  it("OVERDUE when partially paid and past grace", () => expect(computeInstallmentStatus({ ...base, paidAmount: 400, dueDate: addDays(today(), -20) }, S)).toBe("OVERDUE"));
  it("PAID when fully paid regardless of date", () => expect(computeInstallmentStatus({ ...base, paidAmount: 1000, dueDate: addDays(today(), -90) }, S)).toBe("PAID"));
  // A waiver lowers amount to what was paid: it holds while that money stands...
  it("WAIVED sticks while settled", () => expect(computeInstallmentStatus({ ...base, amount: 600, paidAmount: 600, status: "WAIVED", dueDate: addDays(today(), -90) }, S)).toBe("WAIVED"));
  it("WAIVED fully (nothing paid) sticks", () => expect(computeInstallmentStatus({ ...base, amount: 0, paidAmount: 0, status: "WAIVED", dueDate: addDays(today(), -90) }, S)).toBe("WAIVED"));
  // ...and re-opens when the payment behind it bounces.
  it("WAIVED re-opens after a bounced cheque", () => expect(computeInstallmentStatus({ ...base, amount: 600, paidAmount: 0, status: "WAIVED", dueDate: addDays(today(), -90) }, S)).toBe("OVERDUE"));
});

describe("computeContractStatus", () => {
  const c = (endInDays: number, status = "ACTIVE", renewalStatus: string | null = null) => ({ startDate: addMonths(today(), -6), endDate: addDays(today(), endInDays), status, renewalStatus });
  it("ACTIVE when > 90 days left", () => expect(computeContractStatus(c(120))).toBe("ACTIVE"));
  it("EXPIRING_SOON when <= 90 days", () => expect(computeContractStatus(c(45))).toBe("EXPIRING_SOON"));
  it("RENEWAL_PENDING when a renewal decision is in progress", () => {
    expect(computeContractStatus(c(45, "ACTIVE", "NEGOTIATING"))).toBe("RENEWAL_PENDING");
    expect(computeContractStatus(c(45, "ACTIVE", "WANTS_RENEWAL"))).toBe("RENEWAL_PENDING");
    expect(computeContractStatus(c(45, "ACTIVE", "APPROVED"))).toBe("RENEWAL_PENDING");
  });
  it("EXPIRING_SOON when the tenant declined or has not answered", () => {
    expect(computeContractStatus(c(45, "ACTIVE", "NO_RENEWAL"))).toBe("EXPIRING_SOON");
    expect(computeContractStatus(c(45, "ACTIVE", "NO_RESPONSE"))).toBe("EXPIRING_SOON");
  });
  it("EXPIRED after end date", () => expect(computeContractStatus(c(-1))).toBe("EXPIRED"));
  it("terminal statuses are untouched", () => {
    expect(computeContractStatus(c(-30, "TERMINATED"))).toBe("TERMINATED");
    expect(computeContractStatus(c(10, "DRAFT"))).toBe("DRAFT");
  });
});

describe("scorePriority", () => {
  it("is bounded 0..100 and monotonic in amount and lateness", () => {
    const low = scorePriority({ remaining: 500, daysLate: 1, brokenPromises: 0, daysSinceLastAction: 0, contractEndsInDays: 300, tenantRisk: "LOW" });
    const high = scorePriority({ remaining: 80000, daysLate: 90, brokenPromises: 3, daysSinceLastAction: null, contractEndsInDays: 10, tenantRisk: "HIGH" });
    expect(low).toBeGreaterThanOrEqual(0);
    expect(high).toBeLessThanOrEqual(100);
    expect(high).toBeGreaterThan(low);
    expect(high).toBe(100);
  });
  it("broken promises raise priority", () => {
    const a = scorePriority({ remaining: 5000, daysLate: 10, brokenPromises: 0, daysSinceLastAction: 2, contractEndsInDays: 200, tenantRisk: "LOW" });
    const b = scorePriority({ remaining: 5000, daysLate: 10, brokenPromises: 2, daysSinceLastAction: 2, contractEndsInDays: 200, tenantRisk: "LOW" });
    expect(b - a).toBe(14);
  });
});

describe("format.daysBetween", () => {
  it("ignores time of day", () => {
    expect(daysBetween(new Date("2026-01-01T23:00:00"), new Date("2026-01-02T01:00:00"))).toBe(1);
  });
});

describe("statutory grace rule", () => {
  const base = { amount: 1000, paidAmount: 0, status: "UPCOMING" };
  it("graceDaysFor follows the 15/30 split when enabled", () => {
    expect(graceDaysFor("MONTHLY", S)).toBe(15);
    expect(graceDaysFor("QUARTERLY", S)).toBe(15);
    expect(graceDaysFor("SEMI_ANNUAL", S)).toBe(30);
    expect(graceDaysFor("ANNUAL", S)).toBe(30);
    expect(graceDaysFor("CUSTOM", S)).toBe(30);
  });
  it("falls back to office graceDays when disabled or frequency unknown", () => {
    expect(graceDaysFor("MONTHLY", { ...S, statutoryGrace: false })).toBe(S.graceDays);
    expect(graceDaysFor(null, S)).toBe(S.graceDays);
  });
  it("quarterly installment stays DUE for 15 days then OVERDUE", () => {
    expect(computeInstallmentStatus({ ...base, dueDate: addDays(today(), -10) }, S, "QUARTERLY")).toBe("DUE");
    expect(computeInstallmentStatus({ ...base, dueDate: addDays(today(), -16) }, S, "QUARTERLY")).toBe("OVERDUE");
  });
  it("annual installment stays DUE for 30 days", () => {
    expect(computeInstallmentStatus({ ...base, dueDate: addDays(today(), -25) }, S, "ANNUAL")).toBe("DUE");
    expect(computeInstallmentStatus({ ...base, dueDate: addDays(today(), -31) }, S, "ANNUAL")).toBe("OVERDUE");
  });
  it("enforcement needs lateness past grace and an unpaid balance", () => {
    const inst = { ...base, dueDate: addDays(today(), -20) };
    expect(enforcementEligible(inst, { paymentFrequency: "QUARTERLY" }, S)).toBe(true);
    expect(enforcementEligible(inst, { paymentFrequency: "ANNUAL" }, S)).toBe(false);
    expect(enforcementEligible({ ...inst, paidAmount: 1000 }, { paymentFrequency: "QUARTERLY" }, S)).toBe(false);
  });
});

describe("promise dates (end of day)", () => {
  it("endOfDay reads yyyy-mm-dd as a local calendar day ending at 23:59:59.999", () => {
    const d = endOfDay("2026-03-05");
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 2, 5]);
    expect([d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()]).toEqual([23, 59, 59, 999]);
  });
  it("endOfDay keeps the day of a Date and moves to its end", () => {
    const d = endOfDay(new Date(2026, 4, 10, 9, 30));
    expect(d.getDate()).toBe(10);
    expect(d.getHours()).toBe(23);
  });
  it("a promise for today is not broken during the day", () => {
    const noon = new Date();
    noon.setHours(12, 0, 0, 0);
    const midnightUtcStyle = new Date(today()); // how a yyyy-mm-dd value used to be stored
    expect(promiseBroken(midnightUtcStyle, noon)).toBe(false);
    expect(promiseBroken(endOfDay(today()), noon)).toBe(false);
  });
  it("a promise is broken the day after", () => {
    const tomorrowMorning = addDays(today(), 1);
    tomorrowMorning.setHours(0, 5, 0, 0);
    expect(promiseBroken(today(), tomorrowMorning)).toBe(true);
    expect(promiseBroken(endOfDay(today()), tomorrowMorning)).toBe(true);
  });
  it("no promise date is never broken", () => expect(promiseBroken(null)).toBe(false));
});

describe("ownershipPctAt", () => {
  const rows = [
    { propertyId: "p1", percentage: 50, startDate: new Date(2025, 0, 1), endDate: new Date(2026, 5, 30) },
    { propertyId: "p1", percentage: 100, startDate: new Date(2026, 6, 1), endDate: null },
    { propertyId: "p2", percentage: 25, startDate: new Date(2025, 0, 1), endDate: null },
  ];
  it("uses the rows in force on the given day", () => {
    expect(ownershipPctAt(rows, "p1", new Date(2026, 2, 15))).toBe(50);
    expect(ownershipPctAt(rows, "p1", new Date(2026, 8, 15))).toBe(100);
    expect(ownershipPctAt(rows, "p2", new Date(2026, 8, 15))).toBe(25);
  });
  it("never sums consecutive periods (50% then 100% is not 150%)", () => {
    for (const at of [new Date(2026, 0, 1), new Date(2026, 5, 30), new Date(2026, 6, 1), new Date(2026, 11, 31)]) {
      expect(ownershipPctAt(rows, "p1", at)).toBeLessThanOrEqual(100);
    }
  });
  it("is 0 outside any ownership period or for an unknown property", () => {
    expect(ownershipPctAt(rows, "p1", new Date(2024, 11, 31))).toBe(0);
    expect(ownershipPctAt(rows, "p9", new Date(2026, 2, 15))).toBe(0);
  });
});

describe("late-payment history (wasPastGrace / isArrears)", () => {
  const pay = (at: Date, status = "APPROVED") => ({ payment: { paidAt: at, status } });
  const inst = (over: Partial<Parameters<typeof wasPastGrace>[0]>) => ({
    status: "PAID",
    dueDate: addDays(today(), -60),
    amount: 1000,
    paidAmount: 1000,
    contract: { paymentFrequency: "QUARTERLY" },
    allocations: [] as { payment: { paidAt: Date; status: string } }[],
    ...over,
  });
  it("paying inside the grace period is not late", () => {
    expect(wasPastGrace(inst({ allocations: [pay(addDays(today(), -50))] }), S)).toBe(false);
  });
  it("paying after the grace period is late", () => {
    expect(wasPastGrace(inst({ allocations: [pay(addDays(today(), -30))] }), S)).toBe(true);
  });
  it("reversed payments do not count as a settlement", () => {
    expect(wasPastGrace(inst({ allocations: [pay(addDays(today(), -30), "REVERSED"), pay(addDays(today(), -50))] }), S)).toBe(false);
  });
  it("an open installment is late only once grace has run out", () => {
    expect(wasPastGrace(inst({ status: "DUE", paidAmount: 0, dueDate: addDays(today(), -5) }), S)).toBe(false);
    expect(wasPastGrace(inst({ status: "OVERDUE", paidAmount: 0, dueDate: addDays(today(), -20) }), S)).toBe(true);
  });
  it("waived installments never count", () => {
    expect(wasPastGrace(inst({ status: "WAIVED", paidAmount: 0 }), S)).toBe(false);
  });
  it("isArrears excludes a partial payment still inside grace", () => {
    const partial = { status: "PARTIALLY_PAID", dueDate: addDays(today(), -5), amount: 1000, paidAmount: 300, contract: { paymentFrequency: "MONTHLY" } };
    expect(isArrears(partial, S)).toBe(false);
    expect(isArrears({ ...partial, dueDate: addDays(today(), -20) }, S)).toBe(true);
    expect(isArrears({ ...partial, status: "OVERDUE" }, S)).toBe(true);
  });
});

describe("tenantRisk", () => {
  it("clean history is LOW with a plain reason", () => {
    const r = tenantRisk({ overdueCount12m: 0, brokenPromises: 0, partialPayments: 0, currentLateDays: 0 });
    expect(r.level).toBe("LOW");
    expect(r.score).toBe(0);
    expect(r.reasons).toEqual(["لا يوجد تأخر مسجل"]);
  });
  it("repeated lateness and broken promises reach HIGH", () => {
    const r = tenantRisk({ overdueCount12m: 3, brokenPromises: 2, partialPayments: 1, currentLateDays: 40, riskLevel: "MEDIUM" });
    expect(r.level).toBe("HIGH");
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.reasons.length).toBe(4);
  });
  it("one late payment is MEDIUM at most", () => {
    const r = tenantRisk({ overdueCount12m: 1, brokenPromises: 0, partialPayments: 0, currentLateDays: 12 });
    expect(["LOW", "MEDIUM"]).toContain(r.level);
  });
});
