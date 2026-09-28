// Contract payment schedule — pure (no DB), shared by the server (engine.buildSchedule) and the contract form's live preview.
import { FREQUENCY_MONTHS } from "./constants";
import { addMonths } from "./format";

/** Whole months between two dates (contract duration). */
export function contractMonths(startDate: Date, endDate: Date): number {
  return Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / (30.4375 * 86400000)));
}

/**
 * Number of installments. Fixed frequencies: one per started period (18 months ANNUAL = 2, 4 months QUARTERLY = 2).
 * CUSTOM: the count the user entered.
 */
export function scheduleCount(months: number, frequency: string, customCount?: number | null): number {
  const step = FREQUENCY_MONTHS[frequency];
  if (step) return Math.max(1, Math.ceil(months / step - 1e-9));
  return Math.max(1, Math.round(customCount ?? 1));
}

/**
 * Generates a payment schedule. Fixed frequencies bill each full period at the contract's monthly rate
 * (total × step / months) and the last installment the remainder, so a duration that is not a multiple of the
 * frequency is prorated (18 months ANNUAL 150,000 → 100,000 + 50,000). CUSTOM splits evenly.
 * Rounding: 2 decimals, the remainder always goes to the last installment (totals match to the halala).
 */
export function buildSchedule(opts: { startDate: Date; totalAmount: number; frequency: string; installmentsCount?: number; months?: number }): { seq: number; dueDate: Date; amount: number }[] {
  const months = Math.max(1, opts.months ?? 12);
  const step = FREQUENCY_MONTHS[opts.frequency];
  const count = scheduleCount(months, opts.frequency, opts.installmentsCount);
  const stepMonths = step ?? months / count;
  const perInstallment = step ? (opts.totalAmount * Math.min(step, months)) / months : opts.totalAmount / count;
  const base = Math.floor(perInstallment * 100) / 100;
  const rows: { seq: number; dueDate: Date; amount: number }[] = [];
  let allocated = 0;
  for (let i = 0; i < count; i++) {
    const amount = i === count - 1 ? Math.round((opts.totalAmount - allocated) * 100) / 100 : base;
    allocated += amount;
    rows.push({ seq: i + 1, dueDate: addMonths(opts.startDate, Math.round(i * stepMonths)), amount });
  }
  return rows;
}

/** Annual rent equivalent of a contract total (unit "current rent" and renewal prefill). */
export function annualRent(totalAmount: number, months: number): number {
  return Math.round(((totalAmount * 12) / Math.max(1, months)) * 100) / 100;
}
