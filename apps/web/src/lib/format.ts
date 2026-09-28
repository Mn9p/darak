// Formatting helpers — Arabic locale, Latin digits for numbers (per brand: Inter for numbers).

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function money(v: number | null | undefined, opts?: { decimals?: boolean; compact?: boolean }) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  if (opts?.compact) {
    const abs = Math.abs(v);
    if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${Math.round(v / 1_000)}K`;
  }
  return opts?.decimals ? nf2.format(v) : nf.format(v);
}

/** Rounds money to 2 decimals. Use at every write boundary so Float columns never accumulate drift. */
export function r2(v: number) {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/*
 * Time zone. Every calendar rule (due today, overdue, month boundaries, "today" on dashboards) follows Riyadh time,
 * whatever the server's zone (Vercel runs in UTC and TZ cannot be set there). Saudi Arabia is UTC+3 all year (no DST),
 * so conversions are exact arithmetic. Dates entered as yyyy-mm-dd are stored at UTC midnight (03:00 Riyadh) — the same
 * Riyadh calendar day — and older rows stored at local midnight also fall on the right day.
 */
export const TIME_ZONE = "Asia/Riyadh";
const KSA_OFFSET_MS = 3 * 3600_000;
const DAY_MS = 86_400_000;

/** Riyadh calendar day number (days since 1970-01-01, Riyadh). */
export function ksaDay(d: Date | string | number): number {
  return Math.floor((new Date(d).getTime() + KSA_OFFSET_MS) / DAY_MS);
}

/** Riyadh wall-clock parts of an instant (m is 0-based). */
export function ksaParts(d: Date | string | number = new Date()): { y: number; m: number; d: number } {
  const x = new Date(new Date(d).getTime() + KSA_OFFSET_MS);
  return { y: x.getUTCFullYear(), m: x.getUTCMonth(), d: x.getUTCDate() };
}

/** The instant of a Riyadh wall-clock time (month 0-based; overflow rolls like Date). */
export function ksaDate(y: number, m: number, d = 1, h = 0, mi = 0, sec = 0, ms = 0): Date {
  return new Date(Date.UTC(y, m, d, h, mi, sec, ms) - KSA_OFFSET_MS);
}

export function startOfDay(d: Date | string | number = new Date()): Date {
  return new Date(ksaDay(d) * DAY_MS - KSA_OFFSET_MS);
}

export function endOfDay(d: Date | string | number = new Date()): Date {
  return new Date((ksaDay(d) + 1) * DAY_MS - KSA_OFFSET_MS - 1);
}

export function startOfYear(d: Date | string | number = new Date()): Date {
  return ksaDate(ksaParts(d).y, 0, 1);
}

const hijri = new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-islamic-umalqura", { year: "numeric", month: "long", day: "numeric", timeZone: TIME_ZONE });
/** Umm al-Qura Hijri date (e.g. "٢٩ ربيع الأول ١٤٤٨" with Latin digits). Saudi offices read both calendars. */
export function dateHijri(d: Date | string | null | undefined) {
  if (!d) return "—";
  try {
    return hijri.format(new Date(d)).replace(/s?هـ$/, "") + " هـ";
  } catch {
    return "—";
  }
}

export function sar(v: number | null | undefined, opts?: { decimals?: boolean }) {
  if (v === null || v === undefined) return "—";
  return `${money(v, opts)} ر.س`;
}

export function num(v: number | null | undefined) {
  if (v === null || v === undefined) return "—";
  return nf.format(v);
}

export function pct(v: number | null | undefined, digits = 1) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${v.toFixed(digits)}%`;
}

const df = new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", { year: "numeric", month: "short", day: "numeric", timeZone: TIME_ZONE });
const dfNumeric = new Intl.DateTimeFormat("en-GB", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: TIME_ZONE });
const dtf = new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: TIME_ZONE,
});
const tf = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TIME_ZONE });

export function date(d: Date | string | null | undefined) {
  if (!d) return "—";
  return df.format(new Date(d));
}

export function dateNumeric(d: Date | string | null | undefined) {
  if (!d) return "—";
  return dfNumeric.format(new Date(d));
}

export function datetime(d: Date | string | null | undefined) {
  if (!d) return "—";
  return dtf.format(new Date(d));
}

export function time(d: Date | string | null | undefined) {
  if (!d) return "—";
  return tf.format(new Date(d));
}

/** yyyy-mm-dd (Riyadh calendar) for <input type="date"> — also the default "today" of forms. */
export function inputDate(d: Date | string | null | undefined) {
  if (!d) return "";
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return "";
  const p = ksaParts(x);
  return `${p.y}-${String(p.m + 1).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** Whole Riyadh calendar days from a to b. */
export function daysBetween(a: Date | string, b: Date | string) {
  return ksaDay(b) - ksaDay(a);
}

export function daysFromToday(d: Date | string) {
  return daysBetween(new Date(), d);
}

export function daysOverdue(due: Date | string) {
  const n = -daysFromToday(due);
  return n > 0 ? n : 0;
}

export function relative(d: Date | string | null | undefined) {
  if (!d) return "—";
  const diff = daysFromToday(d);
  if (diff === 0) return "اليوم";
  if (diff === 1) return "غدًا";
  if (diff === -1) return "أمس";
  if (diff > 0) return `بعد ${diff} يوم`;
  return `قبل ${-diff} يوم`;
}

export function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((s) => s[0]).join("");
}

export function tagsToArray(tags: string | null | undefined) {
  return (tags ?? "").split(",").map((t) => t.trim()).filter(Boolean);
}

export function safeJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

/** Calendar months in Riyadh time, keeping the time of day; month-end clamps (Jan 31 + 1 → Feb 28/29). */
export function addMonths(d: Date, months: number) {
  const x = new Date(new Date(d).getTime() + KSA_OFFSET_MS);
  const day = x.getUTCDate();
  x.setUTCMonth(x.getUTCMonth() + months);
  if (x.getUTCDate() !== day) x.setUTCDate(0);
  return new Date(x.getTime() - KSA_OFFSET_MS);
}

export function addDays(d: Date, days: number) {
  return new Date(new Date(d).getTime() + days * DAY_MS);
}

export function startOfMonth(d: Date | string | number = new Date()) {
  const p = ksaParts(d);
  return ksaDate(p.y, p.m, 1);
}

export function endOfMonth(d: Date | string | number = new Date()) {
  const p = ksaParts(d);
  return new Date(ksaDate(p.y, p.m + 1, 1).getTime() - 1);
}

const monthLong = new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", { month: "long", year: "numeric", timeZone: TIME_ZONE });
const monthShort = new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", { month: "short", timeZone: TIME_ZONE });

export function monthLabel(d: Date) {
  return monthLong.format(d);
}

export function shortMonth(d: Date) {
  return monthShort.format(d);
}

/** Safe 1-based page number from a query string value ("abc", "-3", "" → 1). */
export function pageParam(v: string | string[] | undefined | null, max = 100000) {
  const n = Number.parseInt(Array.isArray(v) ? v[0] ?? "" : (v ?? ""), 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, max) : 1;
}
