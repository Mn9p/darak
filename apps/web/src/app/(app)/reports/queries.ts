// Report center — shared, scope-aware query layer used by the report page and the CSV export route.
// Every function receives the session user and filters and only touches rows inside the user's organization & property scope.

import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import { propertyIdScope, contractScope, isScoped, can } from "@/lib/permissions";
import { computeOwnerStatement } from "@/lib/engine";
import { money, pct, date, daysOverdue, daysFromToday, startOfMonth, endOfMonth, addMonths, addDays, shortMonth, monthLabel, ksaParts, ksaDate, startOfDay, endOfDay, inputDate } from "@/lib/format";
import {
  AGING_BUCKETS,
  INSTALLMENT_STATUS,
  CONTRACT_STATUS,
  RENEWAL_STATUS,
  PAYMENT_METHODS,
  PAYMENT_STATUS,
  RECONCILIATION_STATUS,
  EXPENSE_CATEGORIES,
  STATEMENT_STATUS,
  TASK_STATUS,
  TASK_PRIORITY,
  UNIT_STATUS,
  UNIT_TYPES,
  PAYMENT_FREQUENCY,
  COLLECTION_ACTION_TYPES,
  COLLECTION_STATUS,
  ROLES,
  type StatusMeta,
  type Tone,
} from "@/lib/constants";

/* ───────────────────────── Catalog ───────────────────────── */

export interface ReportMeta {
  slug: string;
  title: string;
  description: string;
  group: "financial" | "properties" | "contracts" | "employees";
  financial?: boolean;
  groupBy?: { key: string; label: string }[];
  needsOwner?: boolean;
  days?: boolean;
}

export const REPORT_GROUPS: { key: ReportMeta["group"]; label: string; icon: string }[] = [
  { key: "financial", label: "المالية", icon: "💰" },
  { key: "properties", label: "العقارات", icon: "🏢" },
  { key: "contracts", label: "العقود", icon: "📄" },
  { key: "employees", label: "الموظفون", icon: "👥" },
];

export const REPORTS: ReportMeta[] = [
  { slug: "revenue", title: "الإيرادات", description: "الدفعات المحصلة حسب الشهر أو العقار أو طريقة الدفع.", group: "financial", financial: true, groupBy: [{ key: "month", label: "الشهر" }, { key: "property", label: "العقار" }, { key: "method", label: "طريقة الدفع" }] },
  { slug: "receivables", title: "المستحقات", description: "الأقساط المستحقة خلال الفترة وحالة كل قسط.", group: "financial", financial: true },
  { slug: "collections", title: "التحصيل", description: "المستحق مقابل المحصل شهريًا ونسبة التحصيل.", group: "financial", financial: true },
  { slug: "overdue", title: "المتأخرات", description: "الأقساط المتأخرة مع أيام التأخر والمبلغ المتبقي.", group: "financial", financial: true, groupBy: [{ key: "list", label: "تفصيلي" }, { key: "tenant", label: "المستأجر" }, { key: "property", label: "العقار" }] },
  { slug: "aging", title: "أعمار المتأخرات", description: "أعمار المتأخرات حسب الفئات الزمنية لكل عقار أو مستأجر.", group: "financial", financial: true, groupBy: [{ key: "property", label: "العقار" }, { key: "tenant", label: "المستأجر" }] },
  { slug: "cashflow", title: "التدفق النقدي", description: "التدفق النقدي: الإيراد المحصل مقابل المصروفات المعتمدة شهريًا.", group: "financial", financial: true },
  { slug: "expenses", title: "المصروفات", description: "المصروفات المعتمدة حسب الفئة أو العقار أو الشهر.", group: "financial", financial: true, groupBy: [{ key: "category", label: "الفئة" }, { key: "property", label: "العقار" }, { key: "month", label: "الشهر" }] },
  { slug: "property-noi", title: "صافي دخل العقار", description: "الإيراد والمصروفات وصافي دخل التشغيل لكل عقار.", group: "financial", financial: true },
  { slug: "owner-dues", title: "مستحقات الملاك", description: "صافي المستحق لكل مالك خلال الفترة مقارنة بالتسويات المسجلة.", group: "financial", financial: true },
  { slug: "owner-statement", title: "كشف حساب مالك", description: "كشف حساب مالك تفصيلي: التحصيل، الأتعاب، المصروفات، الصافي.", group: "financial", financial: true, needsOwner: true },
  { slug: "reconciliation", title: "مطابقة سندات القبض", description: "الدفعات حسب حالة المطابقة البنكية.", group: "financial", financial: true },
  { slug: "collection-performance", title: "أداء التحصيل", description: "أداء المحصلين: المطالبات، الإجراءات، الوعود، والمبالغ المحصلة.", group: "financial", financial: true },

  { slug: "property-performance", title: "أداء العقارات", description: "مؤشرات كل عقار: الإشغال، الإيراد، المصروفات، المتأخرات.", group: "properties" },
  { slug: "occupancy", title: "الإشغال", description: "حالة الوحدات ونسبة الإشغال لكل عقار.", group: "properties" },
  { slug: "vacancy", title: "الوحدات الشاغرة", description: "الوحدات الشاغرة ومدة الشغور التقريبية والإيراد المفقود.", group: "properties" },
  { slug: "rent-roll", title: "سجل الإيجارات", description: "العقود النشطة لكل وحدة مع الإيجار والمستأجر وتاريخ الانتهاء.", group: "properties" },
  { slug: "revenue-per-property", title: "الإيراد لكل عقار", description: "الإيراد المحصل لكل عقار خلال الفترة.", group: "properties", financial: true },
  { slug: "expense-per-property", title: "المصروفات لكل عقار", description: "المصروفات المعتمدة لكل عقار خلال الفترة.", group: "properties", financial: true },
  { slug: "noi", title: "صافي دخل التشغيل", description: "صافي دخل التشغيل لكل عقار خلال الفترة.", group: "properties", financial: true },

  { slug: "contracts-active", title: "العقود النشطة", description: "كل العقود السارية حاليًا.", group: "contracts" },
  { slug: "contracts-expiring", title: "العقود القريبة من الانتهاء", description: "العقود التي تنتهي خلال 30 / 60 / 90 يومًا.", group: "contracts", days: true },
  { slug: "contracts-expired", title: "العقود المنتهية", description: "العقود التي انتهت خلال الفترة.", group: "contracts" },
  { slug: "contracts-renewals", title: "التجديدات", description: "حالة التجديد للعقود القريبة من الانتهاء.", group: "contracts" },
  { slug: "contracts-values", title: "قيم العقود", description: "إجمالي قيم العقود حسب العقار أو شهر البداية.", group: "contracts", groupBy: [{ key: "property", label: "العقار" }, { key: "month", label: "شهر البداية" }] },
  { slug: "contracts-status", title: "حالة العقود", description: "توزيع العقود حسب الحالة.", group: "contracts" },

  { slug: "employee-tasks", title: "مهام الموظفين", description: "المهام لكل موظف: مفتوحة، منجزة، متأخرة.", group: "employees" },
  { slug: "collection-actions", title: "إجراءات التحصيل", description: "إجراءات التحصيل حسب الموظف والنوع خلال الفترة.", group: "employees" },
  { slug: "overdue-tasks", title: "المهام المتأخرة", description: "المهام التي تجاوزت تاريخ استحقاقها.", group: "employees" },
  { slug: "workload", title: "عبء العمل", description: "توزيع المهام والمطالبات على الموظفين.", group: "employees" },
];

export const reportBySlug = (slug: string) => REPORTS.find((r) => r.slug === slug);

/**
 * Who may open a report. Financial reports need reports.financial. Staff reports (employees group) cover the whole office,
 * so property-scoped roles (PROPERTY_MANAGER) do not get them.
 */
export function reportAllowed(user: SessionUser, meta: ReportMeta): boolean {
  if (!can(user, "reports.view")) return false;
  if (meta.financial && !can(user, "reports.financial")) return false;
  if (meta.group === "employees" && isScoped(user)) return false;
  return true;
}

/* ───────────────────────── Filters ───────────────────────── */

export const PERIODS: Record<string, string> = {
  daily: "اليوم",
  weekly: "هذا الأسبوع",
  monthly: "هذا الشهر",
  quarterly: "هذا الربع",
  "semi-annual": "نصف السنة",
  annual: "هذه السنة",
  custom: "فترة مخصصة",
};

export interface ReportFilters {
  period: string;
  from: Date;
  to: Date;
  propertyId?: string;
  ownerId?: string;
  groupBy?: string;
  days: number;
}

export function parseFilters(sp: Record<string, string | undefined>): ReportFilters {
  const now = new Date();
  const period = sp.period && PERIODS[sp.period] ? sp.period : "annual";
  let from: Date;
  let to: Date;
  // All periods are Riyadh calendar periods (the server may run in UTC).
  const { y, m } = ksaParts(now);
  const day0 = startOfDay(now);
  switch (period) {
    case "daily":
      from = day0;
      to = new Date(day0.getTime() + 86400000 - 1);
      break;
    case "weekly": {
      const dow = (new Date(day0.getTime() + 3 * 3600_000).getUTCDay() + 1) % 7; // Riyadh weekday, Saturday = 0
      from = addDays(day0, -dow);
      to = new Date(addDays(from, 7).getTime() - 1);
      break;
    }
    case "monthly":
      from = startOfMonth(now);
      to = endOfMonth(now);
      break;
    case "quarterly": {
      const q = Math.floor(m / 3) * 3;
      from = ksaDate(y, q, 1);
      to = endOfMonth(ksaDate(y, q + 2, 1));
      break;
    }
    case "semi-annual": {
      const h = m < 6 ? 0 : 6;
      from = ksaDate(y, h, 1);
      to = endOfMonth(ksaDate(y, h + 5, 1));
      break;
    }
    case "custom": {
      from = sp.from ? new Date(sp.from) : ksaDate(y, 0, 1);
      to = sp.to ? new Date(sp.to) : now;
      if (Number.isNaN(from.getTime())) from = ksaDate(y, 0, 1);
      if (Number.isNaN(to.getTime())) to = now;
      from = startOfDay(from);
      to = endOfDay(to);
      break;
    }
    default:
      from = ksaDate(y, 0, 1);
      to = new Date(ksaDate(y + 1, 0, 1).getTime() - 1);
  }
  const days = [30, 60, 90].includes(Number(sp.days)) ? Number(sp.days) : 30;
  return { period, from, to, propertyId: sp.propertyId || undefined, ownerId: sp.ownerId || undefined, groupBy: sp.groupBy || undefined, days };
}

export function filtersToQuery(f: ReportFilters, extra?: Record<string, string | undefined>) {
  const sp = new URLSearchParams();
  sp.set("period", f.period);
  if (f.period === "custom") {
    sp.set("from", inputDate(f.from));
    sp.set("to", inputDate(f.to));
  }
  if (f.propertyId) sp.set("propertyId", f.propertyId);
  if (f.ownerId) sp.set("ownerId", f.ownerId);
  if (f.groupBy) sp.set("groupBy", f.groupBy);
  if (f.days) sp.set("days", String(f.days));
  Object.entries(extra ?? {}).forEach(([k, v]) => v && sp.set(k, v));
  return sp.toString();
}

/* ───────────────────────── Result shape ───────────────────────── */

export type CellKind = "text" | "num" | "money" | "pct" | "date" | "status" | "link";
export interface Column {
  key: string;
  label: string;
  kind?: CellKind;
  map?: Record<string, StatusMeta>;
}
export type LinkCell = { href: string; label: string; sub?: string };
export type Cell = string | number | Date | null | undefined | LinkCell;
export type Row = Record<string, Cell>;

export interface ChartSeries {
  key: string;
  label: string;
  color: string; // css var or tailwind class name
}
export interface Chart {
  title: string;
  format?: "money" | "pct" | "num";
  series: ChartSeries[];
  points: { label: string; values: Record<string, number> }[];
  stacked?: boolean;
}

export interface ReportResult {
  stats: { label: string; value: string; sub?: string; tone?: Tone }[];
  chart?: Chart;
  columns: Column[];
  rows: Row[];
  summary: string;
  note?: string;
}

/* ───────────────────────── Scope helpers ───────────────────────── */

interface Ctx {
  org: string;
  user: SessionUser;
  f: ReportFilters;
  /** Effective property ids (scope ∩ propertyId ∩ owner's properties). undefined = all in org. */
  propertyIds?: string[];
}

async function buildCtx(user: SessionUser & { organizationId: string }, f: ReportFilters): Promise<Ctx> {
  let ids: string[] | undefined = isScoped(user) ? [...user.assignedPropertyIds] : undefined;
  if (f.ownerId) {
    const own = await db.propertyOwnership.findMany({ where: { ownerId: f.ownerId, endDate: null, property: { organizationId: user.organizationId } }, select: { propertyId: true } });
    const set = own.map((o) => o.propertyId);
    ids = ids ? ids.filter((i) => set.includes(i)) : set;
  }
  if (f.propertyId) {
    ids = ids ? ids.filter((i) => i === f.propertyId) : [f.propertyId];
  }
  return { org: user.organizationId, user, f, propertyIds: ids };
}

const propWhere = (c: Ctx) => (c.propertyIds ? { propertyId: { in: c.propertyIds } } : {});
const contractWhere = (c: Ctx) => (c.propertyIds ? { contract: { propertyId: { in: c.propertyIds } } } : {});
const propScope = (c: Ctx) => (c.propertyIds ? { id: { in: c.propertyIds } } : {});

function monthsBetween(from: Date, to: Date) {
  const out: Date[] = [];
  let m = startOfMonth(from);
  while (m <= to && out.length < 36) {
    out.push(m);
    m = addMonths(m, 1);
  }
  return out.length ? out : [startOfMonth(from)];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const change = (cur: number, prev: number) => (prev ? ((cur - prev) / prev) * 100 : cur ? 100 : 0);

function prevRange(f: ReportFilters) {
  const len = f.to.getTime() - f.from.getTime() + 1;
  return { from: new Date(f.from.getTime() - len), to: new Date(f.from.getTime() - 1) };
}

function trendSentence(label: string, cur: number, prev: number, unit = "ريال") {
  if (!prev && !cur) return `لا توجد بيانات ${label} في الفترة الحالية أو السابقة.`;
  if (!prev) return `بلغ ${label} ${money(cur)} ${unit} في هذه الفترة دون بيانات مقارنة في الفترة السابقة.`;
  const ch = change(cur, prev);
  const verb = ch > 0.5 ? "ارتفع" : ch < -0.5 ? "انخفض" : "استقر";
  if (verb === "استقر") return `استقر ${label} عند ${money(cur)} ${unit} تقريبًا مقارنة بالفترة السابقة.`;
  return `${verb} ${label} بنسبة ${pct(Math.abs(ch), 0)} من ${money(prev)} إلى ${money(cur)} ${unit} مقارنة بالفترة السابقة.`;
}

const periodLabel = (f: ReportFilters) => `${date(f.from)} — ${date(f.to)}`;

/* ───────────────────────── Dispatcher ───────────────────────── */

export async function runReport(slug: string, user: SessionUser & { organizationId: string }, f: ReportFilters): Promise<ReportResult> {
  const c = await buildCtx(user, f);
  switch (slug) {
    case "revenue":
      return revenue(c);
    case "receivables":
      return receivables(c);
    case "collections":
      return collections(c);
    case "overdue":
      return overdue(c);
    case "aging":
      return aging(c);
    case "cashflow":
      return cashflow(c);
    case "expenses":
      return expenses(c);
    case "property-noi":
    case "noi":
      return propertyNoi(c);
    case "owner-dues":
      return ownerDues(c);
    case "owner-statement":
      return ownerStatement(c);
    case "reconciliation":
      return reconciliation(c);
    case "collection-performance":
      return collectionPerformance(c);
    case "property-performance":
      return propertyPerformance(c);
    case "occupancy":
      return occupancy(c, false);
    case "vacancy":
      return vacancy(c);
    case "rent-roll":
      return rentRoll(c);
    case "revenue-per-property":
      return revenuePerProperty(c);
    case "expense-per-property":
      return expensePerProperty(c);
    case "contracts-active":
      return contractsList(c, "active");
    case "contracts-expiring":
      return contractsList(c, "expiring");
    case "contracts-expired":
      return contractsList(c, "expired");
    case "contracts-renewals":
      return contractsRenewals(c);
    case "contracts-values":
      return contractsValues(c);
    case "contracts-status":
      return contractsStatus(c);
    case "employee-tasks":
      return employeeTasks(c);
    case "collection-actions":
      return collectionActions(c);
    case "overdue-tasks":
      return overdueTasks(c);
    case "workload":
      return workload(c);
    default:
      throw new Error("التقرير غير موجود");
  }
}

/* ───────────────────────── Financial ───────────────────────── */

async function revenue(c: Ctx): Promise<ReportResult> {
  const { f, org } = c;
  const base = { organizationId: org, status: { in: ["RECORDED", "APPROVED"] }, ...contractWhere(c) };
  const [rows, prevAgg] = await Promise.all([
    db.payment.findMany({ where: { ...base, paidAt: { gte: f.from, lte: f.to } }, select: { id: true, code: true, amount: true, paidAt: true, method: true, contract: { select: { propertyId: true, property: { select: { id: true, name: true } } } } } }),
    db.payment.aggregate({ where: { ...base, paidAt: { gte: prevRange(f).from, lte: prevRange(f).to } }, _sum: { amount: true }, _count: true }),
  ]);
  const total = sum(rows.map((r) => r.amount));
  const prev = prevAgg._sum.amount ?? 0;
  const groupBy = f.groupBy ?? "month";
  const months = monthsBetween(f.from, f.to);
  const byMonth = months.map((m) => {
    const e = endOfMonth(m);
    const inMonth = rows.filter((r) => r.paidAt >= m && r.paidAt <= e);
    return { m, count: inMonth.length, amount: sum(inMonth.map((r) => r.amount)) };
  });
  let columns: Column[];
  let table: Row[];
  if (groupBy === "property") {
    const map = new Map<string, { name: string; id: string; count: number; amount: number }>();
    rows.forEach((r) => {
      const k = r.contract?.propertyId ?? "none";
      const cur = map.get(k) ?? { id: k, name: r.contract?.property.name ?? "بدون عقد", count: 0, amount: 0 };
      cur.count++;
      cur.amount += r.amount;
      map.set(k, cur);
    });
    columns = [
      { key: "name", label: "العقار", kind: "link" },
      { key: "count", label: "عدد الدفعات", kind: "num" },
      { key: "amount", label: "الإيراد", kind: "money" },
      { key: "share", label: "الحصة", kind: "pct" },
    ];
    table = [...map.values()].sort((a, b) => b.amount - a.amount).map((v) => ({ name: v.id === "none" ? v.name : { href: `/properties/${v.id}`, label: v.name }, count: v.count, amount: v.amount, share: total ? (v.amount / total) * 100 : 0 }));
  } else if (groupBy === "method") {
    const map = new Map<string, { count: number; amount: number }>();
    rows.forEach((r) => {
      const cur = map.get(r.method) ?? { count: 0, amount: 0 };
      cur.count++;
      cur.amount += r.amount;
      map.set(r.method, cur);
    });
    columns = [
      { key: "method", label: "طريقة الدفع" },
      { key: "count", label: "عدد الدفعات", kind: "num" },
      { key: "amount", label: "الإيراد", kind: "money" },
      { key: "share", label: "الحصة", kind: "pct" },
    ];
    table = [...map.entries()].sort((a, b) => b[1].amount - a[1].amount).map(([k, v]) => ({ method: PAYMENT_METHODS[k] ?? k, count: v.count, amount: v.amount, share: total ? (v.amount / total) * 100 : 0 }));
  } else {
    columns = [
      { key: "month", label: "الشهر" },
      { key: "count", label: "عدد الدفعات", kind: "num" },
      { key: "amount", label: "الإيراد", kind: "money" },
      { key: "avg", label: "متوسط الدفعة", kind: "money" },
    ];
    table = byMonth.map((b) => ({ month: monthLabel(b.m), count: b.count, amount: b.amount, avg: b.count ? b.amount / b.count : 0 }));
  }
  const best = [...byMonth].sort((a, b) => b.amount - a.amount)[0];
  return {
    stats: [
      { label: "إجمالي الإيراد المحصل", value: money(total), sub: periodLabel(f) },
      { label: "عدد الدفعات", value: money(rows.length) },
      { label: "متوسط الدفعة", value: money(rows.length ? total / rows.length : 0) },
      { label: "مقارنة بالفترة السابقة", value: pct(change(total, prev), 0), tone: total >= prev ? "success" : "danger", sub: `السابقة: ${money(prev)}` },
    ],
    chart: { title: "الإيراد المحصل شهريًا", format: "money", series: [{ key: "amount", label: "الإيراد", color: "var(--dk-green-500)" }], points: byMonth.map((b) => ({ label: shortMonth(b.m), values: { amount: b.amount } })) },
    columns,
    rows: table,
    summary: `${trendSentence("الإيراد المحصل", total, prev)}${best && best.amount ? ` أعلى شهر كان ${monthLabel(best.m)} بإيراد ${money(best.amount)} ريال.` : ""}`,
  };
}

async function receivables(c: Ctx): Promise<ReportResult> {
  const { f, org } = c;
  const rows = await db.installment.findMany({
    where: { organizationId: org, dueDate: { gte: f.from, lte: f.to }, ...contractWhere(c) },
    orderBy: { dueDate: "asc" },
    take: 800,
    include: { tenant: { select: { id: true, name: true } }, contract: { select: { id: true, code: true, unit: { select: { number: true } }, property: { select: { name: true } } } } },
  });
  const active = rows.filter((r) => r.status !== "WAIVED");
  const total = sum(active.map((r) => r.amount));
  const paid = sum(active.map((r) => r.paidAmount));
  const remaining = total - paid;
  const overdueAmt = sum(rows.filter((r) => r.status === "OVERDUE").map((r) => r.amount - r.paidAmount));
  const byStatus = Object.keys(INSTALLMENT_STATUS).map((s) => ({ s, amount: sum(rows.filter((r) => r.status === s).map((r) => r.amount - (s === "PAID" ? 0 : r.paidAmount))), count: rows.filter((r) => r.status === s).length })).filter((x) => x.count);
  const upcoming = rows.filter((r) => r.status === "UPCOMING");
  return {
    stats: [
      { label: "إجمالي المستحق", value: money(total), sub: `${active.length} قسط` },
      { label: "تم التحصيل", value: money(paid), tone: "success" },
      { label: "المتبقي", value: money(remaining), tone: remaining > 0 ? "warning" : undefined },
      { label: "منها متأخر", value: money(overdueAmt), tone: overdueAmt > 0 ? "danger" : undefined },
    ],
    chart: { title: "توزيع الأقساط حسب الحالة", format: "money", series: [{ key: "amount", label: "المبلغ", color: "var(--dk-green-500)" }], points: byStatus.map((b) => ({ label: INSTALLMENT_STATUS[b.s].label, values: { amount: b.amount } })) },
    columns: [
      { key: "tenant", label: "المستأجر", kind: "link" },
      { key: "contract", label: "العقد", kind: "link" },
      { key: "unit", label: "الوحدة / العقار" },
      { key: "dueDate", label: "الاستحقاق", kind: "date" },
      { key: "amount", label: "المبلغ", kind: "money" },
      { key: "paid", label: "المدفوع", kind: "money" },
      { key: "remaining", label: "المتبقي", kind: "money" },
      { key: "status", label: "الحالة", kind: "status", map: INSTALLMENT_STATUS },
    ],
    rows: rows.map((r) => ({
      tenant: { href: `/tenants/${r.tenant.id}`, label: r.tenant.name },
      contract: { href: `/contracts/${r.contract.id}`, label: `${r.contract.code} / ${r.seq}` },
      unit: `${r.contract.unit.number} — ${r.contract.property.name}`,
      dueDate: r.dueDate,
      amount: r.amount,
      paid: r.paidAmount,
      remaining: r.amount - r.paidAmount,
      status: r.status,
    })),
    summary: `المستحقات خلال الفترة ${money(total)} ريال في ${active.length} قسطًا، تم تحصيل ${pct(total ? (paid / total) * 100 : 0, 0)} منها. ${overdueAmt > 0 ? `يوجد ${money(overdueAmt)} ريال متأخرة تحتاج متابعة التحصيل.` : "لا توجد أقساط متأخرة في هذه الفترة."} ${upcoming.length ? `و${upcoming.length} قسطًا قادمًا بقيمة ${money(sum(upcoming.map((r) => r.amount - r.paidAmount)))} ريال.` : ""}`,
  };
}

async function collections(c: Ctx): Promise<ReportResult> {
  const { f, org } = c;
  const months = monthsBetween(f.from, f.to);
  const cw = contractWhere(c);
  const data = await Promise.all(
    months.map(async (m) => {
      const e = endOfMonth(m);
      const a = await db.installment.aggregate({ where: { organizationId: org, dueDate: { gte: m, lte: e }, status: { not: "WAIVED" }, ...cw }, _sum: { amount: true, paidAmount: true }, _count: true });
      const due = a._sum.amount ?? 0;
      const paid = a._sum.paidAmount ?? 0;
      return { m, due, paid, count: a._count, rate: due ? (paid / due) * 100 : 0 };
    }),
  );
  const totalDue = sum(data.map((d) => d.due));
  const totalPaid = sum(data.map((d) => d.paid));
  const rate = totalDue ? (totalPaid / totalDue) * 100 : 0;
  const pr = prevRange(f);
  const prevAgg = await db.installment.aggregate({ where: { organizationId: org, dueDate: { gte: pr.from, lte: pr.to }, status: { not: "WAIVED" }, ...cw }, _sum: { amount: true, paidAmount: true } });
  const prevRate = prevAgg._sum.amount ? ((prevAgg._sum.paidAmount ?? 0) / prevAgg._sum.amount) * 100 : 0;
  // Biggest unpaid contracts contributing to the gap
  const gap = await db.installment.findMany({ where: { organizationId: org, dueDate: { gte: f.from, lte: f.to }, status: { notIn: ["PAID", "WAIVED"] }, ...cw }, select: { amount: true, paidAmount: true, contract: { select: { code: true } } } });
  const byContract = new Map<string, number>();
  gap.forEach((g) => byContract.set(g.contract.code, (byContract.get(g.contract.code) ?? 0) + g.amount - g.paidAmount));
  const top = [...byContract.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const topAmt = sum(top.map((t) => t[1]));
  const diff = rate - prevRate;
  let summary: string;
  if (!prevAgg._sum.amount) summary = `بلغت نسبة التحصيل ${pct(rate, 0)} عن الفترة (${money(totalPaid)} من ${money(totalDue)} ريال).`;
  else if (Math.abs(diff) < 1) summary = `استقرت نسبة التحصيل عند ${pct(rate, 0)} مقارنة بـ ${pct(prevRate, 0)} في الفترة السابقة.`;
  else summary = `${diff < 0 ? "انخفضت" : "ارتفعت"} نسبة التحصيل من ${pct(prevRate, 0)} إلى ${pct(rate, 0)} مقارنة بالفترة السابقة.`;
  if (top.length && totalDue - totalPaid > 0) summary += ` يرجع معظم الفارق إلى ${top.length} عقود بقيمة ${money(topAmt)} ريال (${top.map((t) => t[0]).join("، ")}).`;
  return {
    stats: [
      { label: "إجمالي المستحق", value: money(totalDue) },
      { label: "تم التحصيل", value: money(totalPaid), tone: "success" },
      { label: "المتبقي", value: money(totalDue - totalPaid), tone: totalDue - totalPaid > 0 ? "warning" : undefined },
      { label: "نسبة التحصيل", value: pct(rate, 1), tone: rate >= 90 ? "success" : rate >= 75 ? "warning" : "danger", sub: `الفترة السابقة: ${pct(prevRate, 0)}` },
    ],
    chart: {
      title: "المستحق مقابل المحصل شهريًا",
      format: "money",
      series: [
        { key: "due", label: "المستحق", color: "var(--dk-sand-500)" },
        { key: "paid", label: "المحصل", color: "var(--dk-green-500)" },
      ],
      points: data.map((d) => ({ label: shortMonth(d.m), values: { due: d.due, paid: d.paid } })),
    },
    columns: [
      { key: "month", label: "الشهر" },
      { key: "count", label: "الأقساط", kind: "num" },
      { key: "due", label: "المستحق", kind: "money" },
      { key: "paid", label: "المحصل", kind: "money" },
      { key: "remaining", label: "المتبقي", kind: "money" },
      { key: "rate", label: "نسبة التحصيل", kind: "pct" },
    ],
    rows: data.map((d) => ({ month: monthLabel(d.m), count: d.count, due: d.due, paid: d.paid, remaining: d.due - d.paid, rate: d.rate })),
    summary,
  };
}

async function overdueRows(c: Ctx) {
  return db.installment.findMany({
    where: { organizationId: c.org, status: { in: ["OVERDUE", "PARTIALLY_PAID", "DUE"] }, ...contractWhere(c) },
    orderBy: { dueDate: "asc" },
    include: { tenant: { select: { id: true, name: true, phone: true } }, contract: { select: { id: true, code: true, propertyId: true, unit: { select: { number: true } }, property: { select: { name: true } } } }, collectionCase: { select: { id: true, followUpStatus: true } } },
  });
}

async function overdue(c: Ctx): Promise<ReportResult> {
  const rows = (await overdueRows(c)).filter((r) => daysOverdue(r.dueDate) > 0);
  const total = sum(rows.map((r) => r.amount - r.paidAmount));
  const tenants = new Set(rows.map((r) => r.tenantId)).size;
  const over90 = rows.filter((r) => daysOverdue(r.dueDate) > 90);
  const groupBy = c.f.groupBy ?? "list";
  const buckets = AGING_BUCKETS.map((b) => ({ label: b.label, amount: sum(rows.filter((r) => daysOverdue(r.dueDate) >= b.min && daysOverdue(r.dueDate) <= b.max).map((r) => r.amount - r.paidAmount)) }));
  let columns: Column[];
  let table: Row[];
  if (groupBy === "tenant" || groupBy === "property") {
    const map = new Map<string, { id: string; name: string; count: number; amount: number; maxDays: number }>();
    rows.forEach((r) => {
      const id = groupBy === "tenant" ? r.tenant.id : r.contract.propertyId;
      const name = groupBy === "tenant" ? r.tenant.name : r.contract.property.name;
      const cur = map.get(id) ?? { id, name, count: 0, amount: 0, maxDays: 0 };
      cur.count++;
      cur.amount += r.amount - r.paidAmount;
      cur.maxDays = Math.max(cur.maxDays, daysOverdue(r.dueDate));
      map.set(id, cur);
    });
    columns = [
      { key: "name", label: groupBy === "tenant" ? "المستأجر" : "العقار", kind: "link" },
      { key: "count", label: "الأقساط المتأخرة", kind: "num" },
      { key: "amount", label: "المتبقي", kind: "money" },
      { key: "maxDays", label: "أقصى تأخر (يوم)", kind: "num" },
      { key: "share", label: "الحصة", kind: "pct" },
    ];
    table = [...map.values()].sort((a, b) => b.amount - a.amount).map((v) => ({ name: { href: `${groupBy === "tenant" ? "/tenants" : "/properties"}/${v.id}`, label: v.name }, count: v.count, amount: v.amount, maxDays: v.maxDays, share: total ? (v.amount / total) * 100 : 0 }));
  } else {
    columns = [
      { key: "tenant", label: "المستأجر", kind: "link" },
      { key: "unit", label: "الوحدة / العقار" },
      { key: "contract", label: "العقد", kind: "link" },
      { key: "dueDate", label: "الاستحقاق", kind: "date" },
      { key: "days", label: "أيام التأخر", kind: "num" },
      { key: "remaining", label: "المتبقي", kind: "money" },
      { key: "status", label: "الحالة", kind: "status", map: INSTALLMENT_STATUS },
      { key: "case", label: "المطالبة", kind: "link" },
    ];
    table = rows.map((r) => ({
      tenant: { href: `/tenants/${r.tenant.id}`, label: r.tenant.name, sub: r.tenant.phone ?? undefined },
      unit: `${r.contract.unit.number} — ${r.contract.property.name}`,
      contract: { href: `/contracts/${r.contract.id}`, label: `${r.contract.code} / ${r.seq}` },
      dueDate: r.dueDate,
      days: daysOverdue(r.dueDate),
      remaining: r.amount - r.paidAmount,
      status: r.status,
      case: r.collectionCase ? { href: `/collections/${r.collectionCase.id}`, label: COLLECTION_STATUS[r.collectionCase.followUpStatus]?.label ?? r.collectionCase.followUpStatus } : null,
    }));
  }
  const topTenant = [...rows.reduce((m, r) => m.set(r.tenant.name, (m.get(r.tenant.name) ?? 0) + r.amount - r.paidAmount), new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    stats: [
      { label: "إجمالي المتأخرات", value: money(total), tone: total > 0 ? "danger" : "success" },
      { label: "الأقساط المتأخرة", value: money(rows.length) },
      { label: "المستأجرون المتأخرون", value: money(tenants) },
      { label: "أكثر من 90 يوم", value: money(sum(over90.map((r) => r.amount - r.paidAmount))), tone: over90.length ? "danger" : undefined, sub: `${over90.length} قسط` },
    ],
    chart: { title: "أعمار المتأخرات", format: "money", series: [{ key: "amount", label: "المتبقي", color: "var(--dk-danger)" }], points: buckets.map((b) => ({ label: b.label, values: { amount: b.amount } })) },
    columns,
    rows: table,
    summary: rows.length
      ? `إجمالي المتأخرات ${money(total)} ريال موزعة على ${tenants} مستأجرًا. ${topTenant ? `أكبر مبلغ متأخر على ${topTenant[0]} بقيمة ${money(topTenant[1])} ريال (${pct((topTenant[1] / total) * 100, 0)} من الإجمالي).` : ""} ${over90.length ? `${over90.length} قسطًا تجاوزت 90 يومًا وتحتاج تصعيدًا.` : ""}`
      : "لا توجد أقساط متأخرة حاليًا — نسبة التحصيل ممتازة.",
    note: "المتأخرات تُحسب حسب الحالة الحالية للأقساط بغض النظر عن الفترة المختارة.",
  };
}

async function aging(c: Ctx): Promise<ReportResult> {
  const rows = (await overdueRows(c)).filter((r) => daysOverdue(r.dueDate) > 0);
  const groupBy = c.f.groupBy === "tenant" ? "tenant" : "property";
  const map = new Map<string, { id: string; name: string; b1: number; b2: number; b3: number; b4: number; total: number }>();
  const bucketOf = (d: number) => AGING_BUCKETS.find((b) => d >= b.min && d <= b.max)?.key ?? "b4";
  rows.forEach((r) => {
    const id = groupBy === "tenant" ? r.tenant.id : r.contract.propertyId;
    const name = groupBy === "tenant" ? r.tenant.name : r.contract.property.name;
    const cur = map.get(id) ?? { id, name, b1: 0, b2: 0, b3: 0, b4: 0, total: 0 };
    const rem = r.amount - r.paidAmount;
    const k = bucketOf(daysOverdue(r.dueDate)) as "b1" | "b2" | "b3" | "b4";
    cur[k] += rem;
    cur.total += rem;
    map.set(id, cur);
  });
  const list = [...map.values()].sort((a, b) => b.total - a.total);
  const totals = AGING_BUCKETS.map((b) => ({ ...b, amount: sum(list.map((l) => l[b.key as "b1"])) }));
  const grand = sum(totals.map((t) => t.amount));
  const worst = totals[3];
  return {
    stats: totals.map((t) => ({ label: t.label, value: money(t.amount), tone: (t.key === "b4" && t.amount > 0 ? "danger" : t.key === "b3" && t.amount > 0 ? "warning" : undefined) as Tone | undefined, sub: grand ? pct((t.amount / grand) * 100, 0) : undefined })),
    chart: { title: "توزيع المتأخرات حسب العمر", format: "money", series: [{ key: "amount", label: "المتبقي", color: "var(--dk-sand-500)" }], points: totals.map((t) => ({ label: t.label, values: { amount: t.amount } })) },
    columns: [
      { key: "name", label: groupBy === "tenant" ? "المستأجر" : "العقار", kind: "link" },
      ...AGING_BUCKETS.map((b) => ({ key: b.key, label: b.label, kind: "money" as CellKind })),
      { key: "total", label: "الإجمالي", kind: "money" },
    ],
    rows: list.map((l) => ({ name: { href: `${groupBy === "tenant" ? "/tenants" : "/properties"}/${l.id}`, label: l.name }, b1: l.b1, b2: l.b2, b3: l.b3, b4: l.b4, total: l.total })),
    summary: grand
      ? `إجمالي المتأخرات ${money(grand)} ريال؛ ${worst.amount > 0 ? `${pct((worst.amount / grand) * 100, 0)} منها تجاوزت 90 يومًا (${money(worst.amount)} ريال) وهي الأعلى خطورة.` : "لا توجد متأخرات تجاوزت 90 يومًا."} ${list[0] ? `أعلى ${groupBy === "tenant" ? "مستأجر" : "عقار"}: ${list[0].name} بمبلغ ${money(list[0].total)} ريال.` : ""}`
      : "لا توجد متأخرات — جميع الأقساط المستحقة مسددة.",
    note: "يُحسب العمر من تاريخ الاستحقاق حتى اليوم للأقساط غير المسددة.",
  };
}

async function cashflow(c: Ctx): Promise<ReportResult> {
  const { f, org } = c;
  const months = monthsBetween(f.from, f.to);
  const cw = contractWhere(c);
  const pw = propWhere(c);
  const data = await Promise.all(
    months.map(async (m) => {
      const e = endOfMonth(m);
      const [inc, exp] = await Promise.all([
        db.payment.aggregate({ where: { organizationId: org, paidAt: { gte: m, lte: e }, status: { in: ["RECORDED", "APPROVED"] }, ...cw }, _sum: { amount: true } }),
        db.expense.aggregate({ where: { organizationId: org, date: { gte: m, lte: e }, approvalStatus: "APPROVED", ...pw }, _sum: { amount: true, vatAmount: true } }),
      ]);
      const income = inc._sum.amount ?? 0;
      const expense = (exp._sum.amount ?? 0) + (exp._sum.vatAmount ?? 0);
      return { m, income, expense, net: income - expense };
    }),
  );
  let cum = 0;
  const table = data.map((d) => {
    cum += d.net;
    return { month: monthLabel(d.m), income: d.income, expense: d.expense, net: d.net, cum };
  });
  const income = sum(data.map((d) => d.income));
  const expense = sum(data.map((d) => d.expense));
  const negative = data.filter((d) => d.net < 0);
  const pr = prevRange(f);
  const [pInc, pExp] = await Promise.all([
    db.payment.aggregate({ where: { organizationId: org, paidAt: { gte: pr.from, lte: pr.to }, status: { in: ["RECORDED", "APPROVED"] }, ...cw }, _sum: { amount: true } }),
    db.expense.aggregate({ where: { organizationId: org, date: { gte: pr.from, lte: pr.to }, approvalStatus: "APPROVED", ...pw }, _sum: { amount: true, vatAmount: true } }),
  ]);
  const prevNet = (pInc._sum.amount ?? 0) - (pExp._sum.amount ?? 0) - (pExp._sum.vatAmount ?? 0);
  return {
    stats: [
      { label: "الإيراد المحصل", value: money(income), tone: "success" },
      { label: "المصروفات المعتمدة", value: money(expense) },
      { label: "صافي التدفق النقدي", value: money(income - expense), tone: income - expense >= 0 ? "success" : "danger" },
      { label: "هامش التشغيل", value: pct(income ? ((income - expense) / income) * 100 : 0, 0), sub: `الفترة السابقة: ${money(prevNet)}` },
    ],
    chart: {
      title: "الإيراد مقابل المصروفات شهريًا",
      format: "money",
      series: [
        { key: "income", label: "الإيراد", color: "var(--dk-green-500)" },
        { key: "expense", label: "المصروفات", color: "var(--dk-sand-500)" },
      ],
      points: data.map((d) => ({ label: shortMonth(d.m), values: { income: d.income, expense: d.expense } })),
    },
    columns: [
      { key: "month", label: "الشهر" },
      { key: "income", label: "الإيراد", kind: "money" },
      { key: "expense", label: "المصروفات", kind: "money" },
      { key: "net", label: "الصافي", kind: "money" },
      { key: "cum", label: "التراكمي", kind: "money" },
    ],
    rows: table,
    summary: `${trendSentence("صافي التدفق النقدي", income - expense, prevNet)} نسبة المصروفات إلى الإيراد ${pct(income ? (expense / income) * 100 : 0, 0)}.${negative.length ? ` ${negative.length} شهرًا سجل تدفقًا سالبًا (${negative.map((n) => shortMonth(n.m)).join("، ")}).` : ""}`,
  };
}

async function expenses(c: Ctx): Promise<ReportResult> {
  const { f, org } = c;
  const rows = await db.expense.findMany({
    where: { organizationId: org, date: { gte: f.from, lte: f.to }, ...propWhere(c) },
    include: { property: { select: { id: true, name: true } } },
  });
  const approved = rows.filter((r) => r.approvalStatus === "APPROVED");
  const total = sum(approved.map((r) => r.amount + r.vatAmount));
  const pending = rows.filter((r) => r.approvalStatus === "PENDING");
  const groupBy = f.groupBy ?? "category";
  const pr = prevRange(f);
  const prevAgg = await db.expense.aggregate({ where: { organizationId: org, date: { gte: pr.from, lte: pr.to }, approvalStatus: "APPROVED", ...propWhere(c) }, _sum: { amount: true, vatAmount: true } });
  const prev = (prevAgg._sum.amount ?? 0) + (prevAgg._sum.vatAmount ?? 0);
  const byCat = Object.keys(EXPENSE_CATEGORIES).map((k) => ({ k, amount: sum(approved.filter((r) => r.category === k).map((r) => r.amount + r.vatAmount)), count: approved.filter((r) => r.category === k).length })).filter((x) => x.count);
  let columns: Column[];
  let table: Row[];
  if (groupBy === "property") {
    const map = new Map<string, { id: string; name: string; count: number; amount: number }>();
    approved.forEach((r) => {
      const cur = map.get(r.propertyId) ?? { id: r.propertyId, name: r.property.name, count: 0, amount: 0 };
      cur.count++;
      cur.amount += r.amount + r.vatAmount;
      map.set(r.propertyId, cur);
    });
    columns = [
      { key: "name", label: "العقار", kind: "link" },
      { key: "count", label: "عدد المصروفات", kind: "num" },
      { key: "amount", label: "المبلغ (شامل الضريبة)", kind: "money" },
      { key: "share", label: "الحصة", kind: "pct" },
    ];
    table = [...map.values()].sort((a, b) => b.amount - a.amount).map((v) => ({ name: { href: `/properties/${v.id}`, label: v.name }, count: v.count, amount: v.amount, share: total ? (v.amount / total) * 100 : 0 }));
  } else if (groupBy === "month") {
    columns = [
      { key: "month", label: "الشهر" },
      { key: "count", label: "عدد المصروفات", kind: "num" },
      { key: "amount", label: "المبلغ", kind: "money" },
    ];
    table = monthsBetween(f.from, f.to).map((m) => {
      const e = endOfMonth(m);
      const inM = approved.filter((r) => r.date >= m && r.date <= e);
      return { month: monthLabel(m), count: inM.length, amount: sum(inM.map((r) => r.amount + r.vatAmount)) };
    });
  } else {
    columns = [
      { key: "category", label: "الفئة" },
      { key: "count", label: "عدد المصروفات", kind: "num" },
      { key: "amount", label: "المبلغ (شامل الضريبة)", kind: "money" },
      { key: "share", label: "الحصة", kind: "pct" },
    ];
    table = byCat.sort((a, b) => b.amount - a.amount).map((b) => ({ category: EXPENSE_CATEGORIES[b.k], count: b.count, amount: b.amount, share: total ? (b.amount / total) * 100 : 0 }));
  }
  const top = [...byCat].sort((a, b) => b.amount - a.amount)[0];
  return {
    stats: [
      { label: "المصروفات المعتمدة", value: money(total), sub: `${approved.length} مصروف` },
      { label: "بانتظار الاعتماد", value: money(sum(pending.map((r) => r.amount + r.vatAmount))), tone: pending.length ? "warning" : undefined, sub: `${pending.length} مصروف` },
      { label: "متوسط المصروف", value: money(approved.length ? total / approved.length : 0) },
      { label: "مقارنة بالفترة السابقة", value: pct(change(total, prev), 0), tone: total <= prev ? "success" : "warning", sub: `السابقة: ${money(prev)}` },
    ],
    chart: { title: "المصروفات حسب الفئة", format: "money", series: [{ key: "amount", label: "المبلغ", color: "var(--dk-sand-500)" }], points: byCat.map((b) => ({ label: EXPENSE_CATEGORIES[b.k], values: { amount: b.amount } })) },
    columns,
    rows: table,
    summary: `${trendSentence("إجمالي المصروفات المعتمدة", total, prev)}${top ? ` الفئة الأعلى: ${EXPENSE_CATEGORIES[top.k]} بنسبة ${pct((top.amount / total) * 100, 0)} من الإجمالي.` : ""}${pending.length ? ` يوجد ${pending.length} مصروف بانتظار الاعتماد.` : ""}`,
  };
}

async function propertyRows(c: Ctx) {
  const { f, org } = c;
  const props = await db.property.findMany({
    where: { organizationId: org, status: { not: "ARCHIVED" }, ...propScope(c) },
    orderBy: { name: "asc" },
    include: { units: { where: { status: { not: "ARCHIVED" } }, select: { status: true, currentRent: true, targetRent: true } } },
  });
  const ids = props.map((p) => p.id);
  const [allocs, exps, overdueInst] = await Promise.all([
    db.paymentAllocation.findMany({ where: { installment: { contract: { propertyId: { in: ids } } }, payment: { paidAt: { gte: f.from, lte: f.to }, status: { in: ["RECORDED", "APPROVED"] } } }, select: { amount: true, installment: { select: { contract: { select: { propertyId: true } } } } } }),
    db.expense.groupBy({ by: ["propertyId"], where: { propertyId: { in: ids }, approvalStatus: "APPROVED", date: { gte: f.from, lte: f.to } }, _sum: { amount: true, vatAmount: true } }),
    db.installment.findMany({ where: { contract: { propertyId: { in: ids } }, status: { in: ["OVERDUE", "PARTIALLY_PAID"] } }, select: { amount: true, paidAmount: true, contract: { select: { propertyId: true } } } }),
  ]);
  return props.map((p) => {
    const income = sum(allocs.filter((a) => a.installment.contract.propertyId === p.id).map((a) => a.amount));
    const e = exps.find((x) => x.propertyId === p.id);
    const expense = (e?._sum.amount ?? 0) + (e?._sum.vatAmount ?? 0);
    const od = sum(overdueInst.filter((i) => i.contract.propertyId === p.id).map((i) => i.amount - i.paidAmount));
    const rented = p.units.filter((u) => u.status === "RENTED").length;
    const vacant = p.units.filter((u) => ["VACANT", "AVAILABLE"].includes(u.status)).length;
    return { id: p.id, name: p.name, city: p.city, units: p.units.length, rented, vacant, occupancy: p.units.length ? (rented / p.units.length) * 100 : 0, income, expense, noi: income - expense, overdue: od, annualRent: sum(p.units.map((u) => u.currentRent ?? 0)) };
  });
}

async function propertyNoi(c: Ctx): Promise<ReportResult> {
  const rows = (await propertyRows(c)).sort((a, b) => b.noi - a.noi);
  const income = sum(rows.map((r) => r.income));
  const expense = sum(rows.map((r) => r.expense));
  const negative = rows.filter((r) => r.noi < 0);
  return {
    stats: [
      { label: "إجمالي الإيراد", value: money(income), tone: "success" },
      { label: "إجمالي المصروفات", value: money(expense) },
      { label: "صافي دخل التشغيل (NOI)", value: money(income - expense), tone: income - expense >= 0 ? "success" : "danger" },
      { label: "هامش NOI", value: pct(income ? ((income - expense) / income) * 100 : 0, 0) },
    ],
    chart: {
      title: "صافي دخل التشغيل لكل عقار",
      format: "money",
      series: [
        { key: "income", label: "الإيراد", color: "var(--dk-green-500)" },
        { key: "expense", label: "المصروفات", color: "var(--dk-sand-500)" },
      ],
      points: rows.slice(0, 12).map((r) => ({ label: r.name, values: { income: r.income, expense: r.expense } })),
    },
    columns: [
      { key: "name", label: "العقار", kind: "link" },
      { key: "income", label: "الإيراد المحصل", kind: "money" },
      { key: "expense", label: "المصروفات", kind: "money" },
      { key: "noi", label: "NOI", kind: "money" },
      { key: "margin", label: "الهامش", kind: "pct" },
      { key: "occupancy", label: "الإشغال", kind: "pct" },
    ],
    rows: rows.map((r) => ({ name: { href: `/properties/${r.id}`, label: r.name, sub: r.city ?? undefined }, income: r.income, expense: r.expense, noi: r.noi, margin: r.income ? (r.noi / r.income) * 100 : 0, occupancy: r.occupancy })),
    summary: rows.length
      ? `صافي دخل التشغيل للمحفظة ${money(income - expense)} ريال بهامش ${pct(income ? ((income - expense) / income) * 100 : 0, 0)}. أعلى عقار: ${rows[0].name} (${money(rows[0].noi)} ريال).${negative.length ? ` ${negative.length} عقار سجل NOI سالبًا: ${negative.map((n) => n.name).join("، ")}.` : ""}`
      : "لا توجد عقارات ضمن النطاق.",
  };
}

async function ownerDues(c: Ctx): Promise<ReportResult> {
  const { f, org } = c;
  const owners = await db.owner.findMany({
    where: { organizationId: org, status: { not: "ARCHIVED" }, ...(f.ownerId ? { id: f.ownerId } : {}), ...(c.propertyIds ? { ownerships: { some: { propertyId: { in: c.propertyIds }, endDate: null } } } : {}) },
    orderBy: { name: "asc" },
    take: 60,
    select: { id: true, name: true },
  });
  const statements = await db.ownerStatement.findMany({ where: { organizationId: org, ownerId: { in: owners.map((o) => o.id) }, periodStart: { lte: f.to }, periodEnd: { gte: f.from } }, select: { ownerId: true, netDue: true, status: true } });
  const rows = await Promise.all(
    owners.map(async (o) => {
      const s = await computeOwnerStatement(org, o.id, f.from, f.to, f.propertyId ?? null);
      const st = statements.filter((x) => x.ownerId === o.id);
      return { id: o.id, name: o.name, collected: s.collectedRent, fees: s.managementFees, expenses: s.expenses, net: s.netDue, statements: st.length, paid: sum(st.filter((x) => x.status === "PAID").map((x) => x.netDue)), pending: sum(st.filter((x) => ["DRAFT", "UNDER_REVIEW", "APPROVED"].includes(x.status)).map((x) => x.netDue)) };
    }),
  );
  rows.sort((a, b) => b.net - a.net);
  const net = sum(rows.map((r) => r.net));
  const paid = sum(rows.map((r) => r.paid));
  const pending = sum(rows.map((r) => r.pending));
  return {
    stats: [
      { label: "صافي مستحقات الملاك (محسوب)", value: money(net) },
      { label: "تم تحويله", value: money(paid), tone: "success" },
      { label: "تسويات قيد الإعداد/الاعتماد", value: money(pending), tone: pending > 0 ? "warning" : undefined },
      { label: "غير مسوّى", value: money(Math.max(0, net - paid - pending)), tone: net - paid - pending > 0 ? "danger" : undefined },
    ],
    chart: { title: "صافي المستحق لكل مالك", format: "money", series: [{ key: "net", label: "الصافي", color: "var(--dk-green-500)" }], points: rows.slice(0, 12).map((r) => ({ label: r.name, values: { net: r.net } })) },
    columns: [
      { key: "name", label: "المالك", kind: "link" },
      { key: "collected", label: "الإيجار المحصل", kind: "money" },
      { key: "fees", label: "أتعاب الإدارة", kind: "money" },
      { key: "expenses", label: "المصروفات", kind: "money" },
      { key: "net", label: "الصافي المستحق", kind: "money" },
      { key: "statements", label: "التسويات", kind: "num" },
      { key: "paid", label: "المحوّل", kind: "money" },
      { key: "statement", label: "كشف الحساب", kind: "link" },
    ],
    rows: rows.map((r) => ({ name: { href: `/owners/${r.id}`, label: r.name }, collected: r.collected, fees: r.fees, expenses: r.expenses, net: r.net, statements: r.statements, paid: r.paid, statement: { href: `/reports/owner-statement?${filtersToQuery({ ...f, ownerId: r.id })}`, label: "عرض" } })),
    summary: rows.length
      ? `صافي المستحق للملاك عن الفترة ${money(net)} ريال، تم تحويل ${money(paid)} ريال منها (${pct(net ? (paid / net) * 100 : 0, 0)}).${rows[0] ? ` أعلى مالك: ${rows[0].name} بصافي ${money(rows[0].net)} ريال.` : ""}${net - paid - pending > 0 ? ` يوجد ${money(net - paid - pending)} ريال لم تُعد لها تسوية بعد.` : ""}`
      : "لا يوجد ملاك ضمن النطاق.",
  };
}

async function ownerStatement(c: Ctx): Promise<ReportResult> {
  const { f, org } = c;
  if (!f.ownerId) {
    return { stats: [], columns: [], rows: [], summary: "اختر مالكًا من الفلاتر لعرض كشف الحساب التفصيلي.", note: "يتطلب هذا التقرير تحديد المالك." };
  }
  const owner = await db.owner.findFirst({ where: { id: f.ownerId, organizationId: org }, select: { id: true } });
  if (!owner) return { stats: [], columns: [], rows: [], summary: "المالك غير موجود ضمن هذا المكتب." };
  const s = await computeOwnerStatement(org, f.ownerId, f.from, f.to, f.propertyId ?? null);
  const rows: Row[] = [
    ...s.lines.map((l) => ({ date: l.date, kind: "تحصيل", label: l.label, amount: l.amount, fee: -l.fee, expense: 0 })),
    ...s.expenseLines.map((e) => ({ date: e.date, kind: "مصروف", label: `${e.label}${e.category ? ` (${EXPENSE_CATEGORIES[e.category] ?? e.category})` : ""}`, amount: 0, fee: 0, expense: -e.amount })),
  ].sort((a, b) => (a.date as Date).getTime() - (b.date as Date).getTime());
  return {
    stats: [
      { label: "الإيجار المحصل (حصة المالك)", value: money(s.collectedRent), tone: "success" },
      { label: "أتعاب الإدارة", value: money(s.managementFees) },
      { label: "المصروفات", value: money(s.expenses) },
      { label: "الصافي المستحق", value: money(s.netDue), tone: s.netDue >= 0 ? "success" : "danger" },
    ],
    chart: {
      title: "مكونات كشف الحساب",
      format: "money",
      series: [{ key: "v", label: "المبلغ", color: "var(--dk-green-500)" }],
      points: [
        { label: "المحصل", values: { v: s.collectedRent } },
        { label: "الأتعاب", values: { v: s.managementFees } },
        { label: "المصروفات", values: { v: s.expenses } },
        { label: "الصافي", values: { v: Math.max(0, s.netDue) } },
      ],
    },
    columns: [
      { key: "date", label: "التاريخ", kind: "date" },
      { key: "kind", label: "النوع" },
      { key: "label", label: "البيان" },
      { key: "amount", label: "تحصيل", kind: "money" },
      { key: "fee", label: "أتعاب", kind: "money" },
      { key: "expense", label: "مصروف", kind: "money" },
    ],
    rows,
    summary: `كشف حساب ${s.owner.name} عن الفترة ${periodLabel(f)}: تم تحصيل ${money(s.collectedRent)} ريال من ${s.properties.length} عقار، خُصمت أتعاب إدارة ${money(s.managementFees)} ريال ومصروفات ${money(s.expenses)} ريال، ليكون الصافي المستحق ${money(s.netDue)} ريال.`,
    note: `العقارات: ${s.properties.map((p) => `${p.name} (${p.pct}%)`).join("، ") || "—"}`,
  };
}

async function reconciliation(c: Ctx): Promise<ReportResult> {
  const { f, org } = c;
  const rows = await db.payment.findMany({
    where: { organizationId: org, paidAt: { gte: f.from, lte: f.to }, ...contractWhere(c) },
    orderBy: { paidAt: "desc" },
    take: 800,
    include: { tenant: { select: { id: true, name: true } }, bankTxn: { select: { reference: true, bank: true, date: true } } },
  });
  const byStatus = Object.keys(RECONCILIATION_STATUS).map((k) => ({ k, count: rows.filter((r) => r.reconciliationStatus === k).length, amount: sum(rows.filter((r) => r.reconciliationStatus === k).map((r) => r.amount)) }));
  const matched = byStatus.find((b) => b.k === "MATCHED")!;
  const total = sum(rows.map((r) => r.amount));
  const issues = rows.filter((r) => ["DUPLICATE", "NEEDS_REVIEW"].includes(r.reconciliationStatus));
  return {
    stats: [
      { label: "إجمالي الدفعات", value: money(total), sub: `${rows.length} دفعة` },
      { label: "مطابقة", value: money(matched.amount), tone: "success", sub: `${matched.count} دفعة` },
      { label: "غير مطابقة", value: money(byStatus.find((b) => b.k === "UNMATCHED")!.amount), tone: "warning" },
      { label: "تحتاج مراجعة / مكررة", value: money(issues.length), tone: issues.length ? "danger" : undefined },
    ],
    chart: { title: "الدفعات حسب حالة المطابقة", format: "money", series: [{ key: "amount", label: "المبلغ", color: "var(--dk-green-500)" }], points: byStatus.filter((b) => b.count).map((b) => ({ label: RECONCILIATION_STATUS[b.k].label, values: { amount: b.amount } })) },
    columns: [
      { key: "code", label: "الدفعة", kind: "link" },
      { key: "tenant", label: "المستأجر", kind: "link" },
      { key: "paidAt", label: "التاريخ", kind: "date" },
      { key: "amount", label: "المبلغ", kind: "money" },
      { key: "method", label: "الطريقة" },
      { key: "reference", label: "المرجع" },
      { key: "bank", label: "الحركة البنكية" },
      { key: "status", label: "حالة الدفعة", kind: "status", map: PAYMENT_STATUS },
      { key: "recon", label: "المطابقة", kind: "status", map: RECONCILIATION_STATUS },
    ],
    rows: rows.map((r) => ({
      code: { href: `/payments/${r.id}`, label: r.code },
      tenant: { href: `/tenants/${r.tenant.id}`, label: r.tenant.name },
      paidAt: r.paidAt,
      amount: r.amount,
      method: PAYMENT_METHODS[r.method] ?? r.method,
      reference: r.reference ?? "—",
      bank: r.bankTxn ? `${r.bankTxn.bank ?? ""} ${r.bankTxn.reference ?? ""}`.trim() || "—" : "—",
      status: r.status,
      recon: r.reconciliationStatus,
    })),
    summary: `تمت مطابقة ${pct(rows.length ? (matched.count / rows.length) * 100 : 0, 0)} من الدفعات (${matched.count} من ${rows.length}).${issues.length ? ` ${issues.length} دفعة تحتاج مراجعة أو مكررة بقيمة ${money(sum(issues.map((i) => i.amount)))} ريال.` : " لا توجد دفعات مكررة أو تحتاج مراجعة."}`,
  };
}

async function collectionPerformance(c: Ctx): Promise<ReportResult> {
  const { f, org } = c;
  const cw = contractWhere(c);
  const [cases, actions, collectors] = await Promise.all([
    db.collectionCase.findMany({ where: { organizationId: org, ...(cw.contract ? { installment: { contract: cw.contract } } : {}) }, select: { id: true, collectorId: true, followUpStatus: true, brokenPromises: true, updatedAt: true, installment: { select: { amount: true, paidAmount: true } } } }),
    db.collectionAction.findMany({ where: { createdAt: { gte: f.from, lte: f.to }, case: { organizationId: org } }, select: { byUserId: true, type: true, outcome: true } }),
    db.user.findMany({ where: { organizationId: org, role: "COLLECTOR" }, select: { id: true, name: true } }),
  ]);
  const ids = new Set<string>([...collectors.map((u) => u.id), ...cases.map((k) => k.collectorId).filter((x): x is string => Boolean(x))]);
  const users = await db.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true } });
  const rows = users
    .map((u) => {
      const mine = cases.filter((k) => k.collectorId === u.id);
      const open = mine.filter((k) => !["PAID", "CLOSED"].includes(k.followUpStatus));
      const resolved = mine.filter((k) => k.followUpStatus === "PAID" && k.updatedAt >= f.from && k.updatedAt <= f.to);
      const acts = actions.filter((a) => a.byUserId === u.id);
      return {
        id: u.id,
        name: u.name,
        open: open.length,
        openAmount: sum(open.map((k) => k.installment.amount - k.installment.paidAmount)),
        resolved: resolved.length,
        resolvedAmount: sum(resolved.map((k) => k.installment.amount)),
        actions: acts.length,
        promises: acts.filter((a) => a.type === "PROMISE" || a.outcome === "PROMISED").length,
        broken: sum(mine.map((k) => k.brokenPromises)),
        rate: mine.length ? (mine.filter((k) => k.followUpStatus === "PAID").length / mine.length) * 100 : 0,
      };
    })
    .sort((a, b) => b.resolvedAmount - a.resolvedAmount);
  const totalActions = actions.length;
  const best = rows[0];
  return {
    stats: [
      { label: "المطالبات المفتوحة", value: money(cases.filter((k) => !["PAID", "CLOSED"].includes(k.followUpStatus)).length) },
      { label: "إجراءات خلال الفترة", value: money(totalActions) },
      { label: "مطالبات سُددت", value: money(sum(rows.map((r) => r.resolved))), tone: "success" },
      { label: "وعود مكسورة", value: money(sum(rows.map((r) => r.broken))), tone: sum(rows.map((r) => r.broken)) ? "danger" : undefined },
    ],
    chart: {
      title: "الإجراءات والمطالبات المسددة لكل محصل",
      format: "num",
      series: [
        { key: "actions", label: "الإجراءات", color: "var(--dk-sand-500)" },
        { key: "resolved", label: "مسددة", color: "var(--dk-green-500)" },
      ],
      points: rows.map((r) => ({ label: r.name, values: { actions: r.actions, resolved: r.resolved } })),
    },
    columns: [
      { key: "name", label: "المحصل", kind: "link" },
      { key: "open", label: "مفتوحة", kind: "num" },
      { key: "openAmount", label: "المبلغ المفتوح", kind: "money" },
      { key: "actions", label: "الإجراءات", kind: "num" },
      { key: "promises", label: "وعود", kind: "num" },
      { key: "broken", label: "وعود مكسورة", kind: "num" },
      { key: "resolved", label: "سُددت", kind: "num" },
      { key: "resolvedAmount", label: "المبلغ المسدد", kind: "money" },
      { key: "rate", label: "نسبة الإغلاق", kind: "pct" },
    ],
    rows: rows.map((r) => ({ name: { href: `/employees/${r.id}`, label: r.name }, open: r.open, openAmount: r.openAmount, actions: r.actions, promises: r.promises, broken: r.broken, resolved: r.resolved, resolvedAmount: r.resolvedAmount, rate: r.rate })),
    summary: rows.length ? `سجل الفريق ${totalActions} إجراء تحصيل خلال الفترة وأغلق ${sum(rows.map((r) => r.resolved))} مطالبة.${best ? ` الأعلى أداءً: ${best.name} بإغلاق ${best.resolved} مطالبة بقيمة ${money(best.resolvedAmount)} ريال.` : ""}` : "لا يوجد محصلون أو مطالبات ضمن النطاق.",
  };
}

/* ───────────────────────── Properties ───────────────────────── */

async function propertyPerformance(c: Ctx): Promise<ReportResult> {
  const rows = (await propertyRows(c)).sort((a, b) => b.income - a.income);
  const units = sum(rows.map((r) => r.units));
  const rented = sum(rows.map((r) => r.rented));
  const income = sum(rows.map((r) => r.income));
  const od = sum(rows.map((r) => r.overdue));
  const low = rows.filter((r) => r.units && r.occupancy < 70);
  return {
    stats: [
      { label: "العقارات", value: money(rows.length) },
      { label: "الإشغال الإجمالي", value: pct(units ? (rented / units) * 100 : 0, 0), tone: units && rented / units >= 0.85 ? "success" : "warning" },
      { label: "الإيراد المحصل", value: money(income), tone: "success" },
      { label: "المتأخرات", value: money(od), tone: od ? "danger" : undefined },
    ],
    chart: { title: "الإيراد المحصل لكل عقار", format: "money", series: [{ key: "income", label: "الإيراد", color: "var(--dk-green-500)" }], points: rows.slice(0, 12).map((r) => ({ label: r.name, values: { income: r.income } })) },
    columns: [
      { key: "name", label: "العقار", kind: "link" },
      { key: "units", label: "الوحدات", kind: "num" },
      { key: "occupancy", label: "الإشغال", kind: "pct" },
      { key: "annualRent", label: "الإيجار السنوي", kind: "money" },
      { key: "income", label: "الإيراد المحصل", kind: "money" },
      { key: "expense", label: "المصروفات", kind: "money" },
      { key: "noi", label: "NOI", kind: "money" },
      { key: "overdue", label: "المتأخرات", kind: "money" },
    ],
    rows: rows.map((r) => ({ name: { href: `/properties/${r.id}`, label: r.name, sub: r.city ?? undefined }, units: r.units, occupancy: r.occupancy, annualRent: r.annualRent, income: r.income, expense: r.expense, noi: r.noi, overdue: r.overdue })),
    summary: rows.length ? `إشغال المحفظة ${pct(units ? (rented / units) * 100 : 0, 0)} (${rented} من ${units} وحدة). ${rows[0] ? `أعلى عقار إيرادًا: ${rows[0].name} بـ ${money(rows[0].income)} ريال.` : ""}${low.length ? ` ${low.length} عقار بإشغال أقل من 70%: ${low.map((l) => l.name).join("، ")}.` : ""}` : "لا توجد عقارات ضمن النطاق.",
  };
}

async function occupancy(c: Ctx, _v: boolean): Promise<ReportResult> {
  const props = await db.property.findMany({ where: { organizationId: c.org, status: { not: "ARCHIVED" }, ...propScope(c) }, orderBy: { name: "asc" }, include: { units: { where: { status: { not: "ARCHIVED" } }, select: { status: true } } } });
  const rows = props.map((p) => {
    const cnt = (s: string[]) => p.units.filter((u) => s.includes(u.status)).length;
    const rented = cnt(["RENTED"]);
    return { id: p.id, name: p.name, city: p.city, total: p.units.length, rented, vacant: cnt(["VACANT", "AVAILABLE"]), reserved: cnt(["RESERVED"]), maint: cnt(["UNDER_MAINTENANCE"]), unavailable: cnt(["UNAVAILABLE"]), occupancy: p.units.length ? (rented / p.units.length) * 100 : 0 };
  });
  const total = sum(rows.map((r) => r.total));
  const rented = sum(rows.map((r) => r.rented));
  const vacant = sum(rows.map((r) => r.vacant));
  const occ = total ? (rented / total) * 100 : 0;
  const best = [...rows].filter((r) => r.total).sort((a, b) => b.occupancy - a.occupancy)[0];
  const worst = [...rows].filter((r) => r.total).sort((a, b) => a.occupancy - b.occupancy)[0];
  return {
    stats: [
      { label: "إجمالي الوحدات", value: money(total) },
      { label: "مؤجرة", value: money(rented), tone: "success" },
      { label: "شاغرة", value: money(vacant), tone: vacant ? "warning" : undefined },
      { label: "نسبة الإشغال", value: pct(occ, 1), tone: occ >= 85 ? "success" : occ >= 70 ? "warning" : "danger" },
    ],
    chart: { title: "نسبة الإشغال لكل عقار", format: "pct", series: [{ key: "occ", label: "الإشغال %", color: "var(--dk-green-500)" }], points: rows.slice(0, 14).map((r) => ({ label: r.name, values: { occ: r.occupancy } })) },
    columns: [
      { key: "name", label: "العقار", kind: "link" },
      { key: "total", label: "الوحدات", kind: "num" },
      { key: "rented", label: "مؤجرة", kind: "num" },
      { key: "vacant", label: "شاغرة", kind: "num" },
      { key: "reserved", label: "محجوزة", kind: "num" },
      { key: "maint", label: "تحت الصيانة", kind: "num" },
      { key: "unavailable", label: "غير متاحة", kind: "num" },
      { key: "occupancy", label: "الإشغال", kind: "pct" },
    ],
    rows: rows.map((r) => ({ name: { href: `/properties/${r.id}`, label: r.name, sub: r.city ?? undefined }, total: r.total, rented: r.rented, vacant: r.vacant, reserved: r.reserved, maint: r.maint, unavailable: r.unavailable, occupancy: r.occupancy })),
    summary: total ? `نسبة الإشغال الإجمالية ${pct(occ, 0)} مع ${vacant} وحدة شاغرة.${best ? ` الأعلى إشغالًا: ${best.name} (${pct(best.occupancy, 0)})` : ""}${worst && worst.id !== best?.id ? `، والأدنى: ${worst.name} (${pct(worst.occupancy, 0)}).` : "."}` : "لا توجد وحدات ضمن النطاق.",
  };
}

async function vacancy(c: Ctx): Promise<ReportResult> {
  const units = await db.unit.findMany({
    where: { organizationId: c.org, status: { in: ["VACANT", "AVAILABLE"] }, ...propWhere(c) },
    orderBy: [{ propertyId: "asc" }, { number: "asc" }],
    include: { property: { select: { id: true, name: true, city: true } }, contracts: { orderBy: { endDate: "desc" }, take: 1, select: { endDate: true } } },
  });
  const rows = units.map((u) => {
    const lastEnd = u.contracts[0]?.endDate;
    const since = lastEnd && lastEnd < new Date() ? lastEnd : u.createdAt;
    const days = Math.max(0, -daysFromToday(since));
    const monthly = (u.targetRent ?? u.currentRent ?? 0) / 12;
    return { id: u.id, number: u.number, property: u.property, type: u.type, area: u.area, targetRent: u.targetRent ?? 0, days, lost: (monthly * days) / 30, status: u.status };
  });
  const lost = sum(rows.map((r) => r.lost));
  const avg = rows.length ? sum(rows.map((r) => r.days)) / rows.length : 0;
  const longest = [...rows].sort((a, b) => b.days - a.days)[0];
  const byProp = new Map<string, number>();
  rows.forEach((r) => byProp.set(r.property.name, (byProp.get(r.property.name) ?? 0) + 1));
  return {
    stats: [
      { label: "الوحدات الشاغرة", value: money(rows.length), tone: rows.length ? "warning" : "success" },
      { label: "متوسط مدة الشغور", value: `${Math.round(avg)} يوم` },
      { label: "الإيراد المفقود التقديري", value: money(lost), tone: lost ? "danger" : undefined },
      { label: "الإيجار المستهدف السنوي", value: money(sum(rows.map((r) => r.targetRent))) },
    ],
    chart: { title: "الوحدات الشاغرة لكل عقار", format: "num", series: [{ key: "n", label: "شاغرة", color: "var(--dk-sand-500)" }], points: [...byProp.entries()].slice(0, 14).map(([k, v]) => ({ label: k, values: { n: v } })) },
    columns: [
      { key: "unit", label: "الوحدة", kind: "link" },
      { key: "property", label: "العقار", kind: "link" },
      { key: "type", label: "النوع" },
      { key: "targetRent", label: "الإيجار المستهدف", kind: "money" },
      { key: "days", label: "أيام الشغور", kind: "num" },
      { key: "lost", label: "إيراد مفقود تقديري", kind: "money" },
      { key: "status", label: "الحالة", kind: "status", map: UNIT_STATUS },
    ],
    rows: rows.map((r) => ({ unit: { href: `/units/${r.id}`, label: r.number }, property: { href: `/properties/${r.property.id}`, label: r.property.name, sub: r.property.city ?? undefined }, type: UNIT_TYPES[r.type] ?? r.type, targetRent: r.targetRent, days: r.days, lost: r.lost, status: r.status })),
    summary: rows.length ? `${rows.length} وحدة شاغرة بمتوسط شغور ${Math.round(avg)} يومًا وإيراد مفقود تقديري ${money(lost)} ريال.${longest ? ` أطول شغور: الوحدة ${longest.number} في ${longest.property.name} (${longest.days} يومًا).` : ""}` : "لا توجد وحدات شاغرة — الإشغال كامل.",
    note: "مدة الشغور تُقدّر من تاريخ انتهاء آخر عقد على الوحدة (أو تاريخ إضافتها)، والإيراد المفقود من الإيجار المستهدف.",
  };
}

async function rentRoll(c: Ctx): Promise<ReportResult> {
  const rows = await db.contract.findMany({
    where: { organizationId: c.org, status: { in: ["ACTIVE", "EXPIRING_SOON", "RENEWAL_PENDING"] }, ...propWhere(c) },
    orderBy: [{ propertyId: "asc" }, { endDate: "asc" }],
    include: { property: { select: { id: true, name: true } }, unit: { select: { id: true, number: true, type: true } }, tenant: { select: { id: true, name: true, phone: true } } },
  });
  const total = sum(rows.map((r) => r.totalAmount));
  const exp90 = rows.filter((r) => daysFromToday(r.endDate) <= 90);
  return {
    stats: [
      { label: "العقود النشطة", value: money(rows.length) },
      { label: "إجمالي الإيجار السنوي", value: money(total), tone: "success" },
      { label: "متوسط الإيجار", value: money(rows.length ? total / rows.length : 0) },
      { label: "تنتهي خلال 90 يوم", value: money(exp90.length), tone: exp90.length ? "warning" : undefined },
    ],
    columns: [
      { key: "property", label: "العقار", kind: "link" },
      { key: "unit", label: "الوحدة", kind: "link" },
      { key: "tenant", label: "المستأجر", kind: "link" },
      { key: "contract", label: "العقد", kind: "link" },
      { key: "rent", label: "الإيجار السنوي", kind: "money" },
      { key: "frequency", label: "الدورية" },
      { key: "start", label: "البداية", kind: "date" },
      { key: "end", label: "النهاية", kind: "date" },
      { key: "left", label: "متبقٍ (يوم)", kind: "num" },
      { key: "status", label: "الحالة", kind: "status", map: CONTRACT_STATUS },
    ],
    rows: rows.map((r) => ({
      property: { href: `/properties/${r.property.id}`, label: r.property.name },
      unit: { href: `/units/${r.unit.id}`, label: r.unit.number, sub: UNIT_TYPES[r.unit.type] },
      tenant: { href: `/tenants/${r.tenant.id}`, label: r.tenant.name, sub: r.tenant.phone ?? undefined },
      contract: { href: `/contracts/${r.id}`, label: r.code },
      rent: r.totalAmount,
      frequency: PAYMENT_FREQUENCY[r.paymentFrequency] ?? r.paymentFrequency,
      start: r.startDate,
      end: r.endDate,
      left: daysFromToday(r.endDate),
      status: r.status,
    })),
    summary: rows.length ? `${rows.length} عقدًا نشطًا بإجمالي إيجار سنوي ${money(total)} ريال.${exp90.length ? ` ${exp90.length} منها تنتهي خلال 90 يومًا بقيمة ${money(sum(exp90.map((r) => r.totalAmount)))} ريال — تابع التجديدات.` : ""}` : "لا توجد عقود نشطة ضمن النطاق.",
  };
}

async function revenuePerProperty(c: Ctx): Promise<ReportResult> {
  const rows = (await propertyRows(c)).sort((a, b) => b.income - a.income);
  const total = sum(rows.map((r) => r.income));
  return {
    stats: [
      { label: "إجمالي الإيراد", value: money(total), tone: "success" },
      { label: "العقارات", value: money(rows.length) },
      { label: "متوسط الإيراد للعقار", value: money(rows.length ? total / rows.length : 0) },
      { label: "أعلى عقار", value: rows[0] ? money(rows[0].income) : "—", sub: rows[0]?.name },
    ],
    chart: { title: "الإيراد المحصل لكل عقار", format: "money", series: [{ key: "income", label: "الإيراد", color: "var(--dk-green-500)" }], points: rows.slice(0, 14).map((r) => ({ label: r.name, values: { income: r.income } })) },
    columns: [
      { key: "name", label: "العقار", kind: "link" },
      { key: "units", label: "الوحدات", kind: "num" },
      { key: "income", label: "الإيراد المحصل", kind: "money" },
      { key: "perUnit", label: "لكل وحدة", kind: "money" },
      { key: "share", label: "الحصة", kind: "pct" },
    ],
    rows: rows.map((r) => ({ name: { href: `/properties/${r.id}`, label: r.name }, units: r.units, income: r.income, perUnit: r.units ? r.income / r.units : 0, share: total ? (r.income / total) * 100 : 0 })),
    summary: rows.length && total ? `إجمالي الإيراد ${money(total)} ريال؛ يساهم ${rows[0].name} بنسبة ${pct((rows[0].income / total) * 100, 0)}. ${rows.slice(0, 3).length >= 3 ? `أعلى 3 عقارات تمثل ${pct((sum(rows.slice(0, 3).map((r) => r.income)) / total) * 100, 0)} من الإيراد.` : ""}` : "لا يوجد إيراد محصل خلال الفترة.",
  };
}

async function expensePerProperty(c: Ctx): Promise<ReportResult> {
  const rows = (await propertyRows(c)).sort((a, b) => b.expense - a.expense);
  const total = sum(rows.map((r) => r.expense));
  return {
    stats: [
      { label: "إجمالي المصروفات", value: money(total) },
      { label: "العقارات", value: money(rows.length) },
      { label: "متوسط المصروف للعقار", value: money(rows.length ? total / rows.length : 0) },
      { label: "أعلى عقار", value: rows[0] ? money(rows[0].expense) : "—", sub: rows[0]?.name },
    ],
    chart: { title: "المصروفات المعتمدة لكل عقار", format: "money", series: [{ key: "expense", label: "المصروفات", color: "var(--dk-sand-500)" }], points: rows.slice(0, 14).map((r) => ({ label: r.name, values: { expense: r.expense } })) },
    columns: [
      { key: "name", label: "العقار", kind: "link" },
      { key: "units", label: "الوحدات", kind: "num" },
      { key: "expense", label: "المصروفات", kind: "money" },
      { key: "perUnit", label: "لكل وحدة", kind: "money" },
      { key: "ratio", label: "نسبة إلى الإيراد", kind: "pct" },
    ],
    rows: rows.map((r) => ({ name: { href: `/properties/${r.id}`, label: r.name }, units: r.units, expense: r.expense, perUnit: r.units ? r.expense / r.units : 0, ratio: r.income ? (r.expense / r.income) * 100 : 0 })),
    summary: rows.length && total ? `إجمالي المصروفات ${money(total)} ريال؛ الأعلى ${rows[0].name} بنسبة ${pct((rows[0].expense / total) * 100, 0)}.${rows.filter((r) => r.income && r.expense / r.income > 0.5).length ? ` عقارات تتجاوز مصروفاتها 50% من إيرادها: ${rows.filter((r) => r.income && r.expense / r.income > 0.5).map((r) => r.name).join("، ")}.` : ""}` : "لا توجد مصروفات معتمدة خلال الفترة.",
  };
}

/* ───────────────────────── Contracts ───────────────────────── */

const contractInclude = { property: { select: { id: true, name: true } }, unit: { select: { id: true, number: true } }, tenant: { select: { id: true, name: true } } } as const;

function contractRow(r: { id: string; code: string; property: { id: string; name: string }; unit: { id: string; number: string }; tenant: { id: string; name: string }; startDate: Date; endDate: Date; totalAmount: number; status: string; renewalStatus: string | null }): Row {
  return {
    contract: { href: `/contracts/${r.id}`, label: r.code },
    property: { href: `/properties/${r.property.id}`, label: r.property.name },
    unit: { href: `/units/${r.unit.id}`, label: r.unit.number },
    tenant: { href: `/tenants/${r.tenant.id}`, label: r.tenant.name },
    start: r.startDate,
    end: r.endDate,
    left: daysFromToday(r.endDate),
    amount: r.totalAmount,
    status: r.status,
    renewal: r.renewalStatus,
  };
}
const contractColumns: Column[] = [
  { key: "contract", label: "العقد", kind: "link" },
  { key: "property", label: "العقار", kind: "link" },
  { key: "unit", label: "الوحدة", kind: "link" },
  { key: "tenant", label: "المستأجر", kind: "link" },
  { key: "start", label: "البداية", kind: "date" },
  { key: "end", label: "النهاية", kind: "date" },
  { key: "left", label: "متبقٍ (يوم)", kind: "num" },
  { key: "amount", label: "القيمة", kind: "money" },
  { key: "status", label: "الحالة", kind: "status", map: CONTRACT_STATUS },
];
const ACTIVE = ["ACTIVE", "EXPIRING_SOON", "RENEWAL_PENDING"];

async function contractsList(c: Ctx, mode: "active" | "expiring" | "expired"): Promise<ReportResult> {
  const { f, org } = c;
  const where =
    mode === "active"
      ? { status: { in: ACTIVE } }
      : mode === "expiring"
        ? { status: { in: ACTIVE }, endDate: { gte: new Date(), lte: addDays(new Date(), f.days) } }
        : { status: { in: ["EXPIRED", "TERMINATED"] }, endDate: { gte: f.from, lte: f.to } };
  const rows = await db.contract.findMany({ where: { organizationId: org, ...where, ...propWhere(c) }, orderBy: { endDate: "asc" }, include: contractInclude });
  const total = sum(rows.map((r) => r.totalAmount));
  const months = monthsBetween(mode === "expired" ? f.from : new Date(), mode === "expired" ? f.to : addDays(new Date(), mode === "expiring" ? f.days : 365));
  const chart: Chart = { title: mode === "expired" ? "العقود المنتهية شهريًا" : "العقود حسب شهر الانتهاء", format: "num", series: [{ key: "n", label: "عقود", color: "var(--dk-green-500)" }], points: months.map((m) => ({ label: shortMonth(m), values: { n: rows.filter((r) => r.endDate >= m && r.endDate <= endOfMonth(m)).length } })) };
  let summary: string;
  let stats: ReportResult["stats"];
  if (mode === "active") {
    const exp = rows.filter((r) => daysFromToday(r.endDate) <= 90);
    stats = [
      { label: "العقود النشطة", value: money(rows.length) },
      { label: "إجمالي القيمة", value: money(total), tone: "success" },
      { label: "متوسط القيمة", value: money(rows.length ? total / rows.length : 0) },
      { label: "تنتهي خلال 90 يوم", value: money(exp.length), tone: exp.length ? "warning" : undefined },
    ];
    summary = rows.length ? `${rows.length} عقدًا نشطًا بقيمة ${money(total)} ريال؛ ${exp.length} منها تنتهي خلال 90 يومًا.` : "لا توجد عقود نشطة.";
  } else if (mode === "expiring") {
    const noDecision = rows.filter((r) => !r.renewalStatus);
    stats = [
      { label: `تنتهي خلال ${f.days} يوم`, value: money(rows.length), tone: rows.length ? "warning" : "success" },
      { label: "القيمة المعرضة", value: money(total) },
      { label: "بدون قرار تجديد", value: money(noDecision.length), tone: noDecision.length ? "danger" : undefined },
      { label: "يرغب بالتجديد", value: money(rows.filter((r) => ["WANTS_RENEWAL", "APPROVED"].includes(r.renewalStatus ?? "")).length), tone: "success" },
    ];
    summary = rows.length ? `${rows.length} عقدًا تنتهي خلال ${f.days} يومًا بقيمة ${money(total)} ريال، ${noDecision.length} منها بدون قرار تجديد بعد${noDecision.length ? ` (${noDecision.slice(0, 3).map((r) => r.code).join("، ")}${noDecision.length > 3 ? "…" : ""})` : ""}.` : `لا توجد عقود تنتهي خلال ${f.days} يومًا.`;
  } else {
    const terminated = rows.filter((r) => r.status === "TERMINATED");
    stats = [
      { label: "عقود منتهية", value: money(rows.length) },
      { label: "منها منهاة مبكرًا", value: money(terminated.length), tone: terminated.length ? "danger" : undefined },
      { label: "القيمة", value: money(total) },
      { label: "الفترة", value: periodLabel(f) },
    ];
    summary = rows.length ? `انتهى ${rows.length} عقدًا خلال الفترة بقيمة ${money(total)} ريال، منها ${terminated.length} إنهاء مبكر.` : "لم تنتهِ عقود خلال الفترة.";
  }
  return { stats, chart, columns: mode === "expiring" ? [...contractColumns, { key: "renewal", label: "قرار التجديد", kind: "status", map: RENEWAL_STATUS }] : contractColumns, rows: rows.map(contractRow), summary };
}

async function contractsRenewals(c: Ctx): Promise<ReportResult> {
  const rows = await db.contract.findMany({ where: { organizationId: c.org, OR: [{ status: { in: ["RENEWAL_PENDING", "RENEWED", "EXPIRING_SOON"] } }, { renewalStatus: { not: null } }], ...propWhere(c) }, orderBy: { endDate: "asc" }, include: contractInclude });
  const by = (k: string | null) => rows.filter((r) => (r.renewalStatus ?? "NONE") === k);
  const keys = ["WANTS_RENEWAL", "APPROVED", "NEGOTIATING", "NO_RESPONSE", "NO_RENEWAL"];
  const renewed = rows.filter((r) => r.status === "RENEWED");
  const wants = rows.filter((r) => ["WANTS_RENEWAL", "APPROVED"].includes(r.renewalStatus ?? ""));
  const decided = rows.filter((r) => r.renewalStatus && r.renewalStatus !== "NO_RESPONSE");
  return {
    stats: [
      { label: "عقود في مرحلة التجديد", value: money(rows.length) },
      { label: "يرغب / تمت الموافقة", value: money(wants.length), tone: "success" },
      { label: "لا يرغب", value: money(by("NO_RENEWAL").length), tone: by("NO_RENEWAL").length ? "danger" : undefined },
      { label: "بدون رد / قرار", value: money(by("NO_RESPONSE").length + by("NONE").length), tone: "warning" },
    ],
    chart: { title: "حالة التجديد", format: "num", series: [{ key: "n", label: "عقود", color: "var(--dk-green-500)" }], points: [...keys.map((k) => ({ label: RENEWAL_STATUS[k].label, values: { n: by(k).length } })), { label: "بدون قرار", values: { n: by("NONE").length } }] },
    columns: [...contractColumns, { key: "renewal", label: "قرار التجديد", kind: "status", map: RENEWAL_STATUS }],
    rows: rows.map(contractRow),
    summary: rows.length ? `نسبة الرغبة بالتجديد ${pct(decided.length ? (wants.length / decided.length) * 100 : 0, 0)} من العقود التي اتُخذ فيها قرار (${wants.length} من ${decided.length})، و${renewed.length} عقدًا جُدد فعليًا. ${by("NO_RESPONSE").length + by("NONE").length} عقدًا لا يزال بدون رد.` : "لا توجد عقود في مرحلة التجديد.",
  };
}

async function contractsValues(c: Ctx): Promise<ReportResult> {
  const { f, org } = c;
  const rows = await db.contract.findMany({ where: { organizationId: org, startDate: { gte: f.from, lte: f.to }, status: { notIn: ["DRAFT", "CANCELLED"] }, ...propWhere(c) }, include: contractInclude });
  const total = sum(rows.map((r) => r.totalAmount));
  const groupBy = f.groupBy === "month" ? "month" : "property";
  let table: Row[];
  let columns: Column[];
  let chart: Chart;
  if (groupBy === "month") {
    const months = monthsBetween(f.from, f.to);
    const data = months.map((m) => {
      const inM = rows.filter((r) => r.startDate >= m && r.startDate <= endOfMonth(m));
      return { m, count: inM.length, amount: sum(inM.map((r) => r.totalAmount)) };
    });
    columns = [
      { key: "month", label: "شهر البداية" },
      { key: "count", label: "العقود", kind: "num" },
      { key: "amount", label: "إجمالي القيمة", kind: "money" },
      { key: "avg", label: "متوسط القيمة", kind: "money" },
    ];
    table = data.map((d) => ({ month: monthLabel(d.m), count: d.count, amount: d.amount, avg: d.count ? d.amount / d.count : 0 }));
    chart = { title: "قيم العقود الجديدة شهريًا", format: "money", series: [{ key: "amount", label: "القيمة", color: "var(--dk-green-500)" }], points: data.map((d) => ({ label: shortMonth(d.m), values: { amount: d.amount } })) };
  } else {
    const map = new Map<string, { id: string; name: string; count: number; amount: number }>();
    rows.forEach((r) => {
      const cur = map.get(r.propertyId) ?? { id: r.propertyId, name: r.property.name, count: 0, amount: 0 };
      cur.count++;
      cur.amount += r.totalAmount;
      map.set(r.propertyId, cur);
    });
    const list = [...map.values()].sort((a, b) => b.amount - a.amount);
    columns = [
      { key: "name", label: "العقار", kind: "link" },
      { key: "count", label: "العقود", kind: "num" },
      { key: "amount", label: "إجمالي القيمة", kind: "money" },
      { key: "avg", label: "متوسط القيمة", kind: "money" },
    ];
    table = list.map((l) => ({ name: { href: `/properties/${l.id}`, label: l.name }, count: l.count, amount: l.amount, avg: l.count ? l.amount / l.count : 0 }));
    chart = { title: "قيم العقود لكل عقار", format: "money", series: [{ key: "amount", label: "القيمة", color: "var(--dk-green-500)" }], points: list.slice(0, 14).map((l) => ({ label: l.name, values: { amount: l.amount } })) };
  }
  return {
    stats: [
      { label: "عقود بدأت خلال الفترة", value: money(rows.length) },
      { label: "إجمالي القيمة", value: money(total), tone: "success" },
      { label: "متوسط قيمة العقد", value: money(rows.length ? total / rows.length : 0) },
    ],
    chart,
    columns,
    rows: table,
    summary: rows.length ? `بدأ ${rows.length} عقدًا خلال الفترة بقيمة إجمالية ${money(total)} ريال ومتوسط ${money(total / rows.length)} ريال للعقد.` : "لم تبدأ عقود خلال الفترة المختارة.",
  };
}

async function contractsStatus(c: Ctx): Promise<ReportResult> {
  const groups = await db.contract.groupBy({ by: ["status"], where: { organizationId: c.org, ...propWhere(c) }, _count: true, _sum: { totalAmount: true } });
  const order = Object.keys(CONTRACT_STATUS);
  const list = order.map((s) => ({ s, count: groups.find((g) => g.status === s)?._count ?? 0, amount: groups.find((g) => g.status === s)?._sum.totalAmount ?? 0 })).filter((x) => x.count);
  const total = sum(list.map((l) => l.count));
  const active = sum(list.filter((l) => ACTIVE.includes(l.s)).map((l) => l.count));
  return {
    stats: [
      { label: "إجمالي العقود", value: money(total) },
      { label: "سارية", value: money(active), tone: "success" },
      { label: "مسودة / بانتظار الاعتماد", value: money(sum(list.filter((l) => ["PENDING_APPROVAL", "DRAFT"].includes(l.s)).map((l) => l.count))), tone: "warning" },
      { label: "منتهية / منهاة", value: money(sum(list.filter((l) => ["EXPIRED", "TERMINATED", "CANCELLED"].includes(l.s)).map((l) => l.count))) },
    ],
    chart: { title: "توزيع العقود حسب الحالة", format: "num", series: [{ key: "n", label: "عقود", color: "var(--dk-green-500)" }], points: list.map((l) => ({ label: CONTRACT_STATUS[l.s].label, values: { n: l.count } })) },
    columns: [
      { key: "status", label: "الحالة", kind: "status", map: CONTRACT_STATUS },
      { key: "count", label: "العقود", kind: "num" },
      { key: "share", label: "الحصة", kind: "pct" },
      { key: "amount", label: "إجمالي القيمة", kind: "money" },
      { key: "link", label: "", kind: "link" },
    ],
    rows: list.map((l) => ({ status: l.s, count: l.count, share: total ? (l.count / total) * 100 : 0, amount: l.amount, link: { href: `/contracts?status=${l.s}`, label: "عرض القائمة" } })),
    summary: total ? `${pct((active / total) * 100, 0)} من العقود سارية (${active} من ${total}).${list.find((l) => l.s === "EXPIRING_SOON")?.count ? ` ${list.find((l) => l.s === "EXPIRING_SOON")!.count} عقدًا قريب الانتهاء يحتاج متابعة.` : ""}` : "لا توجد عقود.",
  };
}

/* ───────────────────────── Employees ───────────────────────── */

async function staff(org: string) {
  return db.user.findMany({ where: { organizationId: org, role: { notIn: ["OWNER", "TENANT", "SUPER_ADMIN"] } }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } });
}

async function employeeTasks(c: Ctx): Promise<ReportResult> {
  const { f, org } = c;
  const now = new Date();
  const [users, tasks] = await Promise.all([staff(org), db.task.findMany({ where: { organizationId: org, OR: [{ createdAt: { gte: f.from, lte: f.to } }, { status: { notIn: ["COMPLETED", "CANCELLED"] } }] }, select: { assignedToId: true, status: true, dueDate: true, completedAt: true, createdAt: true } })]);
  const rows = users
    .map((u) => {
      const mine = tasks.filter((t) => t.assignedToId === u.id);
      const open = mine.filter((t) => !["COMPLETED", "CANCELLED"].includes(t.status));
      const done = mine.filter((t) => t.status === "COMPLETED" && t.completedAt && t.completedAt >= f.from && t.completedAt <= f.to);
      const overdueT = open.filter((t) => t.dueDate && t.dueDate < now);
      const onTime = done.filter((t) => !t.dueDate || (t.completedAt && t.completedAt <= t.dueDate));
      return { id: u.id, name: u.name, role: u.role, open: open.length, done: done.length, overdue: overdueT.length, onTime: done.length ? (onTime.length / done.length) * 100 : 0 };
    })
    .filter((r) => r.open || r.done)
    .sort((a, b) => b.done - a.done);
  const totalDone = sum(rows.map((r) => r.done));
  const totalOverdue = sum(rows.map((r) => r.overdue));
  return {
    stats: [
      { label: "مهام مفتوحة", value: money(sum(rows.map((r) => r.open))) },
      { label: "منجزة خلال الفترة", value: money(totalDone), tone: "success" },
      { label: "متأخرة", value: money(totalOverdue), tone: totalOverdue ? "danger" : undefined },
      { label: "موظفون لديهم مهام", value: money(rows.length) },
    ],
    chart: {
      title: "المهام لكل موظف",
      format: "num",
      series: [
        { key: "done", label: "منجزة", color: "var(--dk-green-500)" },
        { key: "open", label: "مفتوحة", color: "var(--dk-sand-500)" },
        { key: "overdue", label: "متأخرة", color: "var(--dk-danger)" },
      ],
      points: rows.slice(0, 12).map((r) => ({ label: r.name, values: { done: r.done, open: r.open, overdue: r.overdue } })),
    },
    columns: [
      { key: "name", label: "الموظف", kind: "link" },
      { key: "role", label: "الدور" },
      { key: "open", label: "مفتوحة", kind: "num" },
      { key: "done", label: "منجزة", kind: "num" },
      { key: "overdue", label: "متأخرة", kind: "num" },
      { key: "onTime", label: "الإنجاز في الوقت", kind: "pct" },
    ],
    rows: rows.map((r) => ({ name: { href: `/employees/${r.id}`, label: r.name }, role: ROLES[r.role as keyof typeof ROLES]?.label ?? r.role, open: r.open, done: r.done, overdue: r.overdue, onTime: r.onTime })),
    summary: rows.length ? `أُنجزت ${totalDone} مهمة خلال الفترة.${rows[0] ? ` الأعلى إنجازًا: ${rows[0].name} (${rows[0].done} مهمة).` : ""}${totalOverdue ? ` يوجد ${totalOverdue} مهمة متأخرة، أكثرها لدى ${[...rows].sort((a, b) => b.overdue - a.overdue)[0].name}.` : " لا توجد مهام متأخرة."}` : "لا توجد مهام مسندة خلال الفترة.",
  };
}

async function collectionActions(c: Ctx): Promise<ReportResult> {
  const { f, org } = c;
  const acts = await db.collectionAction.findMany({ where: { createdAt: { gte: f.from, lte: f.to }, case: { organizationId: org } }, select: { byUserId: true, type: true, outcome: true, byUser: { select: { name: true } } } });
  const types = Object.keys(COLLECTION_ACTION_TYPES);
  const map = new Map<string, { id: string; name: string; counts: Record<string, number>; total: number; promised: number; paid: number }>();
  acts.forEach((a) => {
    const id = a.byUserId ?? "system";
    const cur = map.get(id) ?? { id, name: a.byUser?.name ?? "النظام", counts: {}, total: 0, promised: 0, paid: 0 };
    cur.counts[a.type] = (cur.counts[a.type] ?? 0) + 1;
    cur.total++;
    if (a.outcome === "PROMISED") cur.promised++;
    if (a.outcome === "PAID") cur.paid++;
    map.set(id, cur);
  });
  const list = [...map.values()].sort((a, b) => b.total - a.total);
  const byType = types.map((t) => ({ t, n: acts.filter((a) => a.type === t).length })).filter((x) => x.n);
  return {
    stats: [
      { label: "إجمالي الإجراءات", value: money(acts.length) },
      { label: "اتصالات / رسائل", value: money(acts.filter((a) => ["CALL", "SMS", "WHATSAPP", "EMAIL"].includes(a.type)).length) },
      { label: "وعود بالسداد", value: money(acts.filter((a) => a.outcome === "PROMISED" || a.type === "PROMISE").length), tone: "success" },
      { label: "تصعيدات", value: money(acts.filter((a) => a.type === "ESCALATION").length), tone: acts.filter((a) => a.type === "ESCALATION").length ? "danger" : undefined },
    ],
    chart: { title: "الإجراءات حسب النوع", format: "num", series: [{ key: "n", label: "إجراء", color: "var(--dk-green-500)" }], points: byType.map((b) => ({ label: COLLECTION_ACTION_TYPES[b.t], values: { n: b.n } })) },
    columns: [
      { key: "name", label: "الموظف", kind: "link" },
      { key: "total", label: "الإجمالي", kind: "num" },
      { key: "CALL", label: "اتصال", kind: "num" },
      { key: "SMS", label: "SMS", kind: "num" },
      { key: "WHATSAPP", label: "واتساب", kind: "num" },
      { key: "VISIT", label: "زيارة", kind: "num" },
      { key: "PROMISE", label: "وعود", kind: "num" },
      { key: "ESCALATION", label: "تصعيد", kind: "num" },
      { key: "paid", label: "نتج عنها سداد", kind: "num" },
    ],
    rows: list.map((l) => ({ name: l.id === "system" ? l.name : { href: `/employees/${l.id}`, label: l.name }, total: l.total, CALL: l.counts.CALL ?? 0, SMS: l.counts.SMS ?? 0, WHATSAPP: l.counts.WHATSAPP ?? 0, VISIT: l.counts.VISIT ?? 0, PROMISE: (l.counts.PROMISE ?? 0) + l.promised, ESCALATION: l.counts.ESCALATION ?? 0, paid: l.paid })),
    summary: acts.length ? `سُجل ${acts.length} إجراء تحصيل خلال الفترة${byType[0] ? `، أكثرها ${COLLECTION_ACTION_TYPES[[...byType].sort((a, b) => b.n - a.n)[0].t]}` : ""}.${list.find((l) => l.id !== "system") ? ` الأكثر نشاطًا: ${list.find((l) => l.id !== "system")!.name} (${list.find((l) => l.id !== "system")!.total} إجراء).` : ""}` : "لا توجد إجراءات تحصيل خلال الفترة.",
  };
}

async function overdueTasks(c: Ctx): Promise<ReportResult> {
  const now = new Date();
  const rows = await db.task.findMany({ where: { organizationId: c.org, status: { notIn: ["COMPLETED", "CANCELLED"] }, dueDate: { lt: now } }, orderBy: { dueDate: "asc" }, include: { assignedTo: { select: { id: true, name: true } } } });
  const byUser = new Map<string, number>();
  rows.forEach((t) => byUser.set(t.assignedTo?.name ?? "غير مسندة", (byUser.get(t.assignedTo?.name ?? "غير مسندة") ?? 0) + 1));
  const avg = rows.length ? sum(rows.map((t) => -daysFromToday(t.dueDate!))) / rows.length : 0;
  const urgent = rows.filter((t) => ["URGENT", "HIGH"].includes(t.priority));
  return {
    stats: [
      { label: "مهام متأخرة", value: money(rows.length), tone: rows.length ? "danger" : "success" },
      { label: "متوسط التأخر", value: `${Math.round(avg)} يوم` },
      { label: "عاجلة / مرتفعة", value: money(urgent.length), tone: urgent.length ? "warning" : undefined },
      { label: "غير مسندة", value: money(rows.filter((t) => !t.assignedToId).length) },
    ],
    chart: { title: "المهام المتأخرة لكل موظف", format: "num", series: [{ key: "n", label: "متأخرة", color: "var(--dk-danger)" }], points: [...byUser.entries()].slice(0, 12).map(([k, v]) => ({ label: k, values: { n: v } })) },
    columns: [
      { key: "title", label: "المهمة", kind: "link" },
      { key: "assignee", label: "المسند إليه", kind: "link" },
      { key: "priority", label: "الأولوية", kind: "status", map: TASK_PRIORITY },
      { key: "dueDate", label: "الاستحقاق", kind: "date" },
      { key: "late", label: "أيام التأخر", kind: "num" },
      { key: "status", label: "الحالة", kind: "status", map: TASK_STATUS },
    ],
    rows: rows.map((t) => ({ title: { href: `/tasks/${t.id}`, label: t.title, sub: t.entityLabel ?? undefined }, assignee: t.assignedTo ? { href: `/employees/${t.assignedTo.id}`, label: t.assignedTo.name } : "—", priority: t.priority, dueDate: t.dueDate, late: -daysFromToday(t.dueDate!), status: t.status })),
    summary: rows.length ? `${rows.length} مهمة متأخرة بمتوسط ${Math.round(avg)} يومًا.${[...byUser.entries()].sort((a, b) => b[1] - a[1])[0] ? ` أكثرها لدى ${[...byUser.entries()].sort((a, b) => b[1] - a[1])[0][0]} (${[...byUser.entries()].sort((a, b) => b[1] - a[1])[0][1]} مهمة).` : ""}${urgent.length ? ` ${urgent.length} منها بأولوية عاجلة أو مرتفعة.` : ""}` : "لا توجد مهام متأخرة.",
  };
}

async function workload(c: Ctx): Promise<ReportResult> {
  const { org } = c;
  const now = new Date();
  const [users, tasks, cases] = await Promise.all([
    staff(org),
    db.task.groupBy({ by: ["assignedToId"], where: { organizationId: org, status: { notIn: ["COMPLETED", "CANCELLED"] }, assignedToId: { not: null } }, _count: true }),
    db.collectionCase.groupBy({ by: ["collectorId"], where: { organizationId: org, followUpStatus: { notIn: ["PAID", "CLOSED"] }, collectorId: { not: null } }, _count: true }),
  ]);
  const overdueT = await db.task.groupBy({ by: ["assignedToId"], where: { organizationId: org, status: { notIn: ["COMPLETED", "CANCELLED"] }, dueDate: { lt: now }, assignedToId: { not: null } }, _count: true });
  const rows = users
    .map((u) => {
      const t = tasks.find((x) => x.assignedToId === u.id)?._count ?? 0;
      const k = cases.find((x) => x.collectorId === u.id)?._count ?? 0;
      const o = overdueT.find((x) => x.assignedToId === u.id)?._count ?? 0;
      return { id: u.id, name: u.name, role: u.role, tasks: t, cases: k, overdue: o, total: t + k };
    })
    .sort((a, b) => b.total - a.total);
  const total = sum(rows.map((r) => r.total));
  const avg = rows.length ? total / rows.length : 0;
  const heavy = rows.filter((r) => r.total > avg * 1.5 && r.total >= 5);
  return {
    stats: [
      { label: "إجمالي الأعمال المفتوحة", value: money(total) },
      { label: "مهام", value: money(sum(rows.map((r) => r.tasks))) },
      { label: "مطالبات تحصيل", value: money(sum(rows.map((r) => r.cases))) },
    ],
    chart: {
      title: "عبء العمل لكل موظف",
      format: "num",
      stacked: true,
      series: [
        { key: "tasks", label: "مهام", color: "var(--dk-green-500)" },
        { key: "cases", label: "مطالبات", color: "var(--dk-danger)" },
      ],
      points: rows.filter((r) => r.total).slice(0, 12).map((r) => ({ label: r.name, values: { tasks: r.tasks, cases: r.cases } })),
    },
    columns: [
      { key: "name", label: "الموظف", kind: "link" },
      { key: "role", label: "الدور" },
      { key: "tasks", label: "مهام مفتوحة", kind: "num" },
      { key: "overdue", label: "منها متأخرة", kind: "num" },
      { key: "cases", label: "مطالبات", kind: "num" },
      { key: "total", label: "الإجمالي", kind: "num" },
      { key: "load", label: "مقارنة بالمتوسط", kind: "pct" },
    ],
    rows: rows.map((r) => ({ name: { href: `/employees/${r.id}`, label: r.name }, role: ROLES[r.role as keyof typeof ROLES]?.label ?? r.role, tasks: r.tasks, overdue: r.overdue, cases: r.cases, total: r.total, load: avg ? (r.total / avg) * 100 : 0 })),
    summary: rows.length ? `متوسط عبء العمل ${avg.toFixed(1)} عنصر لكل موظف.${heavy.length ? ` ${heavy.length} موظف يتجاوز المتوسط بشكل ملحوظ: ${heavy.map((h) => `${h.name} (${h.total})`).join("، ")} — يُنصح بإعادة التوزيع.` : " التوزيع متوازن نسبيًا."}` : "لا يوجد موظفون.",
  };
}

/* ───────────────────────── CSV ───────────────────────── */

export function cellText(cell: Cell, col: Column): string {
  if (cell === null || cell === undefined) return "";
  if (cell instanceof Date) return date(cell);
  if (typeof cell === "object") return cell.label;
  if (col.kind === "status" && col.map) return col.map[String(cell)]?.label ?? String(cell);
  if (col.kind === "money") return money(Number(cell), { decimals: true });
  if (col.kind === "pct") return pct(Number(cell));
  return String(cell);
}

export function toCsv(columns: Column[], rows: Row[]) {
  // A leading = + - @ tab or CR would be executed as a formula by Excel/Sheets — neutralize with a quote.
  const esc = (s: string) => `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
  const head = columns.map((c) => esc(c.label)).join(",");
  const body = rows.map((r) => columns.map((c) => esc(cellText(r[c.key], c))).join(",")).join("\n");
  return `${String.fromCharCode(0xfeff)}${head}\n${body}`;
}
