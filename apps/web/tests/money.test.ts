import { describe, it, expect } from "vitest";
import { buildSchedule, scheduleCount, annualRent, contractMonths } from "@/lib/schedule";
import { ownershipPctAt } from "@/lib/engine";
import { ksaDay, startOfDay, endOfDay, startOfMonth, endOfMonth, inputDate, addMonths, daysBetween, ksaDate } from "@/lib/format";

const sum = (rows: { amount: number }[]) => Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100;

describe("buildSchedule", () => {
  it("splits an exact multiple evenly", () => {
    const rows = buildSchedule({ startDate: new Date("2026-01-01"), totalAmount: 120000, frequency: "QUARTERLY", months: 12 });
    expect(rows.map((r) => r.amount)).toEqual([30000, 30000, 30000, 30000]);
  });
  it("prorates the last installment when the term is not a multiple of the frequency", () => {
    expect(buildSchedule({ startDate: new Date("2026-01-01"), totalAmount: 150000, frequency: "ANNUAL", months: 18 }).map((r) => r.amount)).toEqual([100000, 50000]);
    expect(buildSchedule({ startDate: new Date("2026-01-01"), totalAmount: 40000, frequency: "QUARTERLY", months: 4 }).map((r) => r.amount)).toEqual([30000, 10000]);
    expect(buildSchedule({ startDate: new Date("2026-01-01"), totalAmount: 80000, frequency: "SEMI_ANNUAL", months: 8 }).map((r) => r.amount)).toEqual([60000, 20000]);
  });
  it("always totals the contract to the halala", () => {
    for (const [total, freq, months] of [[100000, "MONTHLY", 12], [99999.99, "QUARTERLY", 12], [10000, "MONTHLY", 7], [33333, "SEMI_ANNUAL", 24]] as const) {
      expect(sum(buildSchedule({ startDate: new Date("2026-03-31"), totalAmount: total, frequency: freq, months }))).toBe(total);
    }
  });
  it("counts one installment per started period", () => {
    expect(scheduleCount(12, "MONTHLY")).toBe(12);
    expect(scheduleCount(18, "ANNUAL")).toBe(2);
    expect(scheduleCount(12, "CUSTOM", 5)).toBe(5);
  });
  it("annualises contract totals", () => {
    expect(annualRent(200000, 24)).toBe(100000);
    expect(contractMonths(new Date("2026-01-01"), new Date("2026-12-31"))).toBe(12);
  });
});

describe("ownershipPctAt", () => {
  const created = new Date("2026-09-28T07:15:00Z");
  const opening = [{ propertyId: "p", percentage: 100, startDate: created, endDate: null }];
  it("opening ownership covers back-dated history", () => {
    const noClose = new Map([["p", null]]);
    expect(ownershipPctAt(opening, "p", new Date("2026-09-01"), noClose)).toBe(100);
    expect(ownershipPctAt(opening, "p", new Date("2025-01-01"), noClose)).toBe(100);
  });
  it("a transfer splits history at the transfer time, never 0% or 200%", () => {
    const transfer = new Date("2026-10-10T11:00:00Z");
    const rows = [
      { propertyId: "p", percentage: 100, startDate: created, endDate: transfer }, // A (opening)
      { propertyId: "p", percentage: 100, startDate: transfer, endDate: null }, // B (after transfer)
    ];
    const fc = new Map([["p", transfer.getTime()]]);
    const a = [rows[0]];
    const b = [rows[1]];
    for (const d of ["2026-09-01", "2026-10-01", "2026-10-09", "2026-10-11", "2026-12-01"]) {
      const at = new Date(d);
      expect(ownershipPctAt(a, "p", at, fc) + ownershipPctAt(b, "p", at, fc)).toBe(100);
    }
    expect(ownershipPctAt(a, "p", new Date("2026-09-01"), fc)).toBe(100);
    expect(ownershipPctAt(b, "p", new Date("2026-11-01"), fc)).toBe(100);
  });
});

describe("Riyadh calendar", () => {
  it("counts days in Riyadh time whatever the storage convention", () => {
    // 2026-10-01 stored at UTC midnight (03:00 Riyadh) and at Riyadh midnight (21:00Z the day before) are the same day.
    expect(ksaDay(new Date("2026-10-01T00:00:00Z"))).toBe(ksaDay(new Date("2026-09-30T21:00:00Z")));
    expect(daysBetween(new Date("2026-09-30T21:30:00Z"), new Date("2026-10-01T20:59:00Z"))).toBe(0);
  });
  it("uses Riyadh midnight for day and month boundaries", () => {
    const at = new Date("2026-10-15T22:30:00Z"); // 01:30 on Oct 16 in Riyadh
    expect(inputDate(at)).toBe("2026-10-16");
    expect(startOfDay(at).toISOString()).toBe("2026-10-15T21:00:00.000Z");
    expect(endOfDay(at).toISOString()).toBe("2026-10-16T20:59:59.999Z");
    expect(startOfMonth(at).toISOString()).toBe("2026-09-30T21:00:00.000Z");
    expect(endOfMonth(at).toISOString()).toBe("2026-10-31T20:59:59.999Z");
    expect(ksaDate(2026, 0, 1).toISOString()).toBe("2025-12-31T21:00:00.000Z");
  });
  it("adds calendar months with month-end clamping", () => {
    expect(inputDate(addMonths(new Date("2026-01-31T00:00:00Z"), 1))).toBe("2026-02-28");
    expect(inputDate(addMonths(new Date("2026-01-31T00:00:00Z"), 2))).toBe("2026-03-31");
  });
});
