// Read-only tools the MCP server offers an AI assistant. Each tool is gated by the same permission as the page it
// mirrors and scoped exactly like that page (organization + the member's property reach), so the assistant sees what the
// member sees in DARAK and nothing more. No tool writes anything. Results are compact JSON with Arabic labels.
import { db } from "../db";
import { can, isScoped, propertyScope, propertyIdScope, contractScope, type Permission } from "../permissions";
import { textLike } from "../search";
import { OPEN_INSTALLMENT } from "../collections";
import { addDays, daysOverdue, daysFromToday, startOfMonth, endOfMonth, startOfDay, endOfDay, r2, ksaParts } from "../format";
import {
  PROPERTY_TYPES, PROPERTY_STATUS, UNIT_TYPES, UNIT_STATUS, CONTRACT_STATUS, RENEWAL_STATUS, PAYMENT_FREQUENCY,
  INSTALLMENT_STATUS, COLLECTION_STATUS, PAYMENT_METHODS, PAYMENT_STATUS, EXPENSE_CATEGORIES, APPROVAL_STATUS,
  STATEMENT_STATUS, TASK_PRIORITY, TASK_STATUS, RISK_LEVELS, type StatusMeta,
} from "../constants";
import type { McpUser } from "./oauth";

type Args = Record<string, unknown>;
type Schema = { type: "object"; properties: Record<string, unknown>; required?: string[] };

export interface Tool {
  name: string;
  title: string;
  description: string;
  permission: Permission;
  inputSchema: Schema;
  run: (user: McpUser, args: Args) => Promise<unknown>;
}

const ACTIVE_CONTRACT = ["ACTIVE", "EXPIRING_SOON", "RENEWAL_PENDING"];
const OPEN_TASK = ["NEW", "ASSIGNED", "IN_PROGRESS", "WAITING"];

/* ───────────── small helpers ───────────── */

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 120) : undefined);
const int = (v: unknown, def: number, min: number, max: number) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : def;
};
/** Riyadh calendar day as yyyy-mm-dd (a UTC slice would show 21:00 UTC month starts as the previous day). */
const day = (d: Date | null | undefined) => {
  if (!d) return null;
  const p = ksaParts(d);
  return `${p.y}-${String(p.m + 1).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
};
/** yyyy-mm-dd → Riyadh day bounds; anything else is ignored. */
const dateArg = (v: unknown, end = false) => {
  const s = str(v);
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? undefined : end ? endOfDay(d) : startOfDay(d);
};
const label = (map: Record<string, StatusMeta | string>, key: string | null | undefined) => {
  if (!key) return null;
  const m = map[key];
  return typeof m === "string" ? m : m?.label ?? key;
};
const LIMIT = { type: "integer", minimum: 1, maximum: 100, description: "Maximum rows to return (default 25)." };
const sum = <T,>(rows: T[], f: (r: T) => number) => r2(rows.reduce((s, r) => s + f(r), 0));

/** Property ids the member may see, or undefined for the whole office. */
const reach = (u: McpUser) => (isScoped(u) ? u.assignedPropertyIds : undefined);

/** Finds one visible property by id, code or (part of) its name. */
async function findProperty(u: McpUser, ref: string) {
  return db.property.findFirst({
    where: { organizationId: u.organizationId, ...propertyScope(u), OR: [{ id: ref }, { code: textLike(ref) }, { name: textLike(ref) }] },
    orderBy: { name: "asc" },
  });
}

/* ───────────── tools ───────────── */

export const TOOLS: Tool[] = [
  {
    name: "office_overview",
    title: "نظرة عامة على المكتب",
    description:
      "Headline numbers for the real-estate office right now: properties, units and occupancy, active contracts, contracts ending in the next 90 days, this month's rent due vs collected, total overdue rent, pending expenses and open tasks. Start here for general questions. Amounts are in SAR.",
    permission: "dashboard.view",
    inputSchema: { type: "object", properties: {} },
    run: async (u) => {
      const org = u.organizationId;
      const now = new Date();
      const ids = reach(u);
      const byProp = ids ? { propertyId: { in: ids } } : {};
      const byContract = ids ? { contract: { propertyId: { in: ids } } } : {};
      const [properties, units, active, expiring, month, overdue, pendingExpenses, openTasks] = await Promise.all([
        db.property.count({ where: { organizationId: org, status: { not: "ARCHIVED" }, ...propertyScope(u) } }),
        db.unit.groupBy({ by: ["status"], where: { organizationId: org, status: { not: "ARCHIVED" }, ...byProp }, _count: true }),
        db.contract.count({ where: { organizationId: org, status: { in: ACTIVE_CONTRACT }, ...byProp } }),
        db.contract.count({ where: { organizationId: org, status: { in: ACTIVE_CONTRACT }, endDate: { gte: startOfDay(now), lte: endOfDay(addDays(now, 90)) }, ...byProp } }),
        db.installment.findMany({ where: { organizationId: org, dueDate: { gte: startOfMonth(now), lte: endOfMonth(now) }, status: { not: "WAIVED" }, ...byContract }, select: { amount: true, paidAmount: true } }),
        db.installment.findMany({ where: { organizationId: org, status: { in: OPEN_INSTALLMENT }, ...byContract }, select: { amount: true, paidAmount: true, dueDate: true } }),
        can(u, "expenses.view") ? db.expense.count({ where: { organizationId: org, approvalStatus: "PENDING", ...byProp } }) : Promise.resolve(null),
        can(u, "tasks.view") ? db.task.count({ where: { organizationId: org, status: { in: OPEN_TASK }, ...(ids ? { OR: [{ assignedToId: u.id }, { createdById: u.id }] } : {}) } }) : Promise.resolve(null),
      ]);
      const unitTotal = units.reduce((s, g) => s + g._count, 0);
      const rented = units.find((g) => g.status === "RENTED")?._count ?? 0;
      const late = overdue.filter((i) => daysOverdue(i.dueDate) > 0);
      const dueMonth = sum(month, (i) => i.amount);
      const paidMonth = sum(month, (i) => i.paidAmount);
      const money = can(u, "collections.view") || can(u, "installments.view");
      return {
        office: u.organizationName,
        asOf: day(now),
        currency: "SAR",
        properties,
        units: { total: unitTotal, rented, vacantOrOther: unitTotal - rented, occupancyPct: unitTotal ? r2((rented / unitTotal) * 100) : 0, byStatus: Object.fromEntries(units.map((g) => [label(UNIT_STATUS, g.status), g._count])) },
        contracts: { active, endingWithin90Days: expiring },
        ...(money
          ? { thisMonth: { due: dueMonth, collected: paidMonth, collectionRatePct: dueMonth ? r2((paidMonth / dueMonth) * 100) : 0 }, overdue: { amount: sum(late, (i) => i.amount - i.paidAmount), installments: late.length } }
          : {}),
        ...(pendingExpenses !== null ? { expensesAwaitingApproval: pendingExpenses } : {}),
        ...(openTasks !== null ? { openTasks } : {}),
      };
    },
  },
  {
    name: "search_properties",
    title: "البحث في العقارات",
    description: "List or search the office's properties (by name, code, city or district) with unit counts, occupancy and rent. Leave query empty to list all.",
    permission: "properties.view",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "Name, code, city or district (Arabic or Latin)." }, limit: LIMIT } },
    run: async (u, a) => {
      const q = str(a.query);
      const rows = await db.property.findMany({
        where: { organizationId: u.organizationId, status: { not: "ARCHIVED" }, ...propertyScope(u), ...(q ? { OR: [{ name: textLike(q) }, { code: textLike(q) }, { city: textLike(q) }, { district: textLike(q) }] } : {}) },
        select: { id: true, code: true, name: true, type: true, city: true, district: true, status: true, units: { where: { status: { not: "ARCHIVED" } }, select: { status: true, currentRent: true } } },
        orderBy: { name: "asc" },
        take: int(a.limit, 25, 1, 100),
      });
      return rows.map((p) => {
        const rented = p.units.filter((x) => x.status === "RENTED");
        return {
          id: p.id, code: p.code, name: p.name, type: label(PROPERTY_TYPES, p.type), city: p.city, district: p.district, status: label(PROPERTY_STATUS, p.status),
          units: p.units.length, rented: rented.length, occupancyPct: p.units.length ? r2((rented.length / p.units.length) * 100) : 0, annualRentOfRentedUnits: sum(rented, (x) => x.currentRent ?? 0),
        };
      });
    },
  },
  {
    name: "get_property",
    title: "تفاصيل عقار",
    description: "Everything about one property: owners, every unit with its status, rent and current tenant, active contracts and the property's overdue rent. Pass the property id, code or name.",
    permission: "properties.view",
    inputSchema: { type: "object", properties: { property: { type: "string", description: "Property id, code or name." } }, required: ["property"] },
    run: async (u, a) => {
      const ref = str(a.property);
      const p = ref ? await findProperty(u, ref) : null;
      if (!p) return { error: "لم يُعثر على عقار بهذا الاسم أو الرمز ضمن ما يحق لك رؤيته." };
      const [units, owners, overdue] = await Promise.all([
        db.unit.findMany({
          where: { propertyId: p.id, status: { not: "ARCHIVED" } },
          select: { code: true, number: true, floor: true, type: true, status: true, area: true, rooms: true, currentRent: true, targetRent: true, contracts: { where: { status: { in: ACTIVE_CONTRACT } }, select: { code: true, endDate: true, tenant: { select: { name: true } } }, take: 1 } },
          orderBy: { number: "asc" },
        }),
        can(u, "owners.view") ? db.propertyOwnership.findMany({ where: { propertyId: p.id, endDate: null }, select: { percentage: true, owner: { select: { name: true, code: true } } } }) : Promise.resolve([]),
        can(u, "collections.view") || can(u, "installments.view")
          ? db.installment.findMany({ where: { organizationId: u.organizationId, status: { in: OPEN_INSTALLMENT }, contract: { propertyId: p.id } }, select: { amount: true, paidAmount: true, dueDate: true } })
          : Promise.resolve(null),
      ]);
      const late = overdue?.filter((i) => daysOverdue(i.dueDate) > 0) ?? null;
      return {
        id: p.id, code: p.code, name: p.name, type: label(PROPERTY_TYPES, p.type), city: p.city, district: p.district, street: p.street, status: label(PROPERTY_STATUS, p.status), floors: p.floors, buildYear: p.buildYear,
        owners: owners.map((o) => ({ name: o.owner.name, code: o.owner.code, sharePct: o.percentage })),
        units: units.map((x) => ({ number: x.number, code: x.code, floor: x.floor, type: label(UNIT_TYPES, x.type), status: label(UNIT_STATUS, x.status), area: x.area, rooms: x.rooms, currentRent: x.currentRent, targetRent: x.targetRent, tenant: x.contracts[0]?.tenant.name ?? null, contract: x.contracts[0]?.code ?? null, contractEnds: day(x.contracts[0]?.endDate) })),
        ...(late ? { overdue: { amount: sum(late, (i) => i.amount - i.paidAmount), installments: late.length } } : {}),
      };
    },
  },
  {
    name: "list_overdue_rent",
    title: "الإيجارات المتأخرة",
    description: "Overdue rent installments (due date passed, not fully paid), largest first, with tenant, property, unit, days late and the collection follow-up status. Optionally filter by property or tenant name.",
    permission: "collections.view",
    inputSchema: { type: "object", properties: { property: { type: "string", description: "Property id, code or name (optional)." }, tenant: { type: "string", description: "Tenant name (optional)." }, limit: LIMIT } },
    run: async (u, a) => {
      const pref = str(a.property);
      const p = pref ? await findProperty(u, pref) : null;
      if (pref && !p) return { error: "لم يُعثر على العقار." };
      const t = str(a.tenant);
      const rows = await db.installment.findMany({
        where: { organizationId: u.organizationId, status: { in: OPEN_INSTALLMENT }, dueDate: { lt: startOfDay() }, ...contractScope(u), ...(p ? { contract: { propertyId: p.id } } : {}), ...(t ? { tenant: { name: textLike(t) } } : {}) },
        select: {
          seq: true, dueDate: true, amount: true, paidAmount: true, status: true,
          tenant: { select: { name: true, phone: true, riskLevel: true } },
          contract: { select: { code: true, property: { select: { name: true } }, unit: { select: { number: true } } } },
          collectionCase: { select: { followUpStatus: true, promiseDate: true, promiseAmount: true, collector: { select: { name: true } } } },
        },
      });
      const list = rows
        .map((i) => ({
          tenant: i.tenant.name, tenantPhone: i.tenant.phone, tenantRisk: label(RISK_LEVELS, i.tenant.riskLevel), property: i.contract.property.name, unit: i.contract.unit.number, contract: i.contract.code,
          installment: i.seq, dueDate: day(i.dueDate), daysLate: daysOverdue(i.dueDate), amount: i.amount, paid: i.paidAmount, remaining: r2(i.amount - i.paidAmount), status: label(INSTALLMENT_STATUS, i.status),
          followUp: label(COLLECTION_STATUS, i.collectionCase?.followUpStatus), promiseDate: day(i.collectionCase?.promiseDate), promiseAmount: i.collectionCase?.promiseAmount ?? null, collector: i.collectionCase?.collector?.name ?? null,
        }))
        .filter((i) => i.daysLate > 0)
        .sort((x, y) => y.remaining - x.remaining);
      return { totalOverdue: sum(list, (i) => i.remaining), installments: list.length, rows: list.slice(0, int(a.limit, 25, 1, 100)) };
    },
  },
  {
    name: "list_expiring_contracts",
    title: "العقود القريبة من الانتهاء",
    description: "Active lease contracts that end within the next N days (default 90), soonest first, with tenant, unit, rent and renewal status.",
    permission: "contracts.view",
    inputSchema: { type: "object", properties: { days: { type: "integer", minimum: 1, maximum: 365, description: "Look-ahead window in days (default 90)." }, limit: LIMIT } },
    run: async (u, a) => {
      const days = int(a.days, 90, 1, 365);
      const rows = await db.contract.findMany({
        where: { organizationId: u.organizationId, status: { in: ACTIVE_CONTRACT }, endDate: { gte: startOfDay(), lte: endOfDay(addDays(new Date(), days)) }, ...propertyIdScope(u) },
        select: { code: true, endDate: true, totalAmount: true, status: true, renewalStatus: true, tenant: { select: { name: true, phone: true } }, property: { select: { name: true } }, unit: { select: { number: true } } },
        orderBy: { endDate: "asc" },
        take: int(a.limit, 25, 1, 100),
      });
      return rows.map((c) => ({ contract: c.code, tenant: c.tenant.name, tenantPhone: c.tenant.phone, property: c.property.name, unit: c.unit.number, endDate: day(c.endDate), daysLeft: daysFromToday(c.endDate), totalAmount: c.totalAmount, status: label(CONTRACT_STATUS, c.status), renewal: label(RENEWAL_STATUS, c.renewalStatus) }));
    },
  },
  {
    name: "search_contracts",
    title: "البحث في العقود",
    description: "Find lease contracts by contract code, tenant name, property or unit, optionally by status (ACTIVE, EXPIRING_SOON, EXPIRED, TERMINATED…). Returns dates, amounts, payment frequency and installment progress.",
    permission: "contracts.view",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Contract code, tenant name, property name or unit number." }, status: { type: "string", enum: Object.keys(CONTRACT_STATUS) }, limit: LIMIT },
    },
    run: async (u, a) => {
      const q = str(a.query);
      const status = str(a.status);
      const rows = await db.contract.findMany({
        where: {
          organizationId: u.organizationId, ...propertyIdScope(u), ...(status && CONTRACT_STATUS[status] ? { status } : {}),
          ...(q ? { OR: [{ code: textLike(q) }, { tenant: { name: textLike(q) } }, { property: { name: textLike(q) } }, { unit: { number: textLike(q) } }] } : {}),
        },
        select: {
          code: true, startDate: true, endDate: true, totalAmount: true, vatAmount: true, paymentFrequency: true, status: true, renewalStatus: true,
          tenant: { select: { name: true } }, owner: { select: { name: true } }, property: { select: { name: true } }, unit: { select: { number: true } },
          installments: { select: { amount: true, paidAmount: true, status: true } },
        },
        orderBy: { endDate: "desc" },
        take: int(a.limit, 25, 1, 100),
      });
      return rows.map((c) => ({
        contract: c.code, tenant: c.tenant.name, owner: c.owner.name, property: c.property.name, unit: c.unit.number, start: day(c.startDate), end: day(c.endDate),
        totalAmount: c.totalAmount, vat: c.vatAmount, frequency: label(PAYMENT_FREQUENCY, c.paymentFrequency), status: label(CONTRACT_STATUS, c.status), renewal: label(RENEWAL_STATUS, c.renewalStatus),
        installments: { count: c.installments.length, paid: c.installments.filter((i) => i.status === "PAID").length, billed: sum(c.installments, (i) => i.amount), collected: sum(c.installments, (i) => i.paidAmount) },
      }));
    },
  },
  {
    name: "search_tenants",
    title: "البحث في المستأجرين",
    description: "Find tenants by name, phone or code, with their current contracts and overdue balance.",
    permission: "tenants.view",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "Tenant name, phone or code." }, limit: LIMIT } },
    run: async (u, a) => {
      const q = str(a.query);
      const ids = reach(u);
      const rows = await db.tenant.findMany({
        where: { organizationId: u.organizationId, status: { not: "ARCHIVED" }, ...(ids ? { contracts: { some: { propertyId: { in: ids } } } } : {}), ...(q ? { OR: [{ name: textLike(q) }, { phone: { contains: q.replace(/\D/g, "") || q } }, { code: textLike(q) }] } : {}) },
        select: {
          code: true, name: true, type: true, phone: true, email: true, riskLevel: true,
          contracts: { where: { status: { in: ACTIVE_CONTRACT }, ...(ids ? { propertyId: { in: ids } } : {}) }, select: { code: true, endDate: true, property: { select: { name: true } }, unit: { select: { number: true } } } },
          installments: { where: { status: { in: OPEN_INSTALLMENT }, dueDate: { lt: startOfDay() }, ...contractScope(u) }, select: { amount: true, paidAmount: true } },
        },
        orderBy: { name: "asc" },
        take: int(a.limit, 25, 1, 100),
      });
      return rows.map((t) => ({
        code: t.code, name: t.name, phone: t.phone, email: t.email, risk: label(RISK_LEVELS, t.riskLevel),
        activeContracts: t.contracts.map((c) => ({ contract: c.code, property: c.property.name, unit: c.unit.number, ends: day(c.endDate) })),
        overdue: sum(t.installments, (i) => i.amount - i.paidAmount),
      }));
    },
  },
  {
    name: "search_owners",
    title: "البحث في الملاك",
    description: "Find property owners by name, phone or code, with the properties they own and their share.",
    permission: "owners.view",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "Owner name, phone or code." }, limit: LIMIT } },
    run: async (u, a) => {
      const q = str(a.query);
      const ids = reach(u);
      const rows = await db.owner.findMany({
        where: { organizationId: u.organizationId, status: { not: "ARCHIVED" }, ...(ids ? { ownerships: { some: { propertyId: { in: ids } } } } : {}), ...(q ? { OR: [{ name: textLike(q) }, { phone: { contains: q.replace(/\D/g, "") || q } }, { code: textLike(q) }] } : {}) },
        select: { code: true, name: true, type: true, phone: true, email: true, managementFeePct: true, ownerships: { where: { endDate: null, ...(ids ? { propertyId: { in: ids } } : {}) }, select: { percentage: true, property: { select: { name: true, code: true } } } } },
        orderBy: { name: "asc" },
        take: int(a.limit, 25, 1, 100),
      });
      return rows.map((o) => ({ code: o.code, name: o.name, phone: o.phone, email: o.email, managementFeePct: o.managementFeePct, properties: o.ownerships.map((s) => ({ name: s.property.name, code: s.property.code, sharePct: s.percentage })) }));
    },
  },
  {
    name: "list_payments",
    title: "سندات القبض",
    description: "Rent payments received (receipt vouchers) in a date range (default: this month), newest first, with totals. Optionally filter by property or tenant.",
    permission: "payments.view",
    inputSchema: {
      type: "object",
      properties: { from: { type: "string", description: "Start date yyyy-mm-dd (default: first day of this month)." }, to: { type: "string", description: "End date yyyy-mm-dd (default: today)." }, property: { type: "string" }, tenant: { type: "string" }, limit: LIMIT },
    },
    run: async (u, a) => {
      const from = dateArg(a.from) ?? startOfMonth();
      const to = dateArg(a.to, true) ?? endOfDay();
      const pref = str(a.property);
      const p = pref ? await findProperty(u, pref) : null;
      if (pref && !p) return { error: "لم يُعثر على العقار." };
      const t = str(a.tenant);
      const where = { organizationId: u.organizationId, paidAt: { gte: from, lte: to }, status: { notIn: ["REVERSED", "RETURNED"] }, ...contractScope(u), ...(p ? { contract: { propertyId: p.id } } : {}), ...(t ? { tenant: { name: textLike(t) } } : {}) };
      const [agg, rows] = await Promise.all([
        db.payment.aggregate({ where, _sum: { amount: true }, _count: true }),
        db.payment.findMany({
          where,
          select: { code: true, paidAt: true, amount: true, method: true, status: true, reference: true, tenant: { select: { name: true } }, contract: { select: { code: true, property: { select: { name: true } }, unit: { select: { number: true } } } } },
          orderBy: { paidAt: "desc" },
          take: int(a.limit, 25, 1, 100),
        }),
      ]);
      return {
        from: day(from), to: day(to), total: r2(agg._sum.amount ?? 0), count: agg._count,
        rows: rows.map((x) => ({ voucher: x.code, date: day(x.paidAt), amount: x.amount, method: label(PAYMENT_METHODS, x.method), status: label(PAYMENT_STATUS, x.status), reference: x.reference, tenant: x.tenant.name, contract: x.contract?.code ?? null, property: x.contract?.property.name ?? null, unit: x.contract?.unit.number ?? null })),
      };
    },
  },
  {
    name: "list_expenses",
    title: "المصروفات",
    description: "Property expenses in a date range (default: this month) with totals by category. Optionally filter by property, category or approval status (PENDING, APPROVED, REJECTED).",
    permission: "expenses.view",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Start date yyyy-mm-dd (default: first day of this month)." }, to: { type: "string", description: "End date yyyy-mm-dd (default: today)." },
        property: { type: "string" }, category: { type: "string", enum: Object.keys(EXPENSE_CATEGORIES) }, approval: { type: "string", enum: Object.keys(APPROVAL_STATUS) }, limit: LIMIT,
      },
    },
    run: async (u, a) => {
      const from = dateArg(a.from) ?? startOfMonth();
      const to = dateArg(a.to, true) ?? endOfDay();
      const pref = str(a.property);
      const p = pref ? await findProperty(u, pref) : null;
      if (pref && !p) return { error: "لم يُعثر على العقار." };
      const category = str(a.category);
      const approval = str(a.approval);
      const rows = await db.expense.findMany({
        where: {
          organizationId: u.organizationId, date: { gte: from, lte: to }, ...propertyIdScope(u), ...(p ? { propertyId: p.id } : {}),
          ...(category && EXPENSE_CATEGORIES[category] ? { category } : {}), ...(approval && APPROVAL_STATUS[approval] ? { approvalStatus: approval } : {}),
        },
        select: { code: true, date: true, category: true, description: true, payee: true, amount: true, vatAmount: true, approvalStatus: true, property: { select: { name: true } }, unit: { select: { number: true } } },
        orderBy: { date: "desc" },
      });
      const byCategory: Record<string, number> = {};
      for (const e of rows) {
        const k = label(EXPENSE_CATEGORIES, e.category) ?? e.category;
        byCategory[k] = r2((byCategory[k] ?? 0) + e.amount + e.vatAmount);
      }
      return {
        from: day(from), to: day(to), total: sum(rows, (e) => e.amount + e.vatAmount), count: rows.length, byCategory,
        rows: rows.slice(0, int(a.limit, 25, 1, 100)).map((e) => ({ code: e.code, date: day(e.date), property: e.property.name, unit: e.unit?.number ?? null, category: label(EXPENSE_CATEGORIES, e.category), description: e.description, payee: e.payee, amount: e.amount, vat: e.vatAmount, approval: label(APPROVAL_STATUS, e.approvalStatus) })),
      };
    },
  },
  {
    name: "list_owner_statements",
    title: "كشوف حساب الملاك",
    description: "Owner account statements (collected rent, management fees, expenses, net due to the owner) — newest first. Optionally filter by owner name or status (DRAFT, UNDER_REVIEW, APPROVED, PAID, CLOSED).",
    permission: "statements.view",
    inputSchema: { type: "object", properties: { owner: { type: "string", description: "Owner name (optional)." }, status: { type: "string", enum: Object.keys(STATEMENT_STATUS) }, limit: LIMIT } },
    run: async (u, a) => {
      const owner = str(a.owner);
      const status = str(a.status);
      const rows = await db.ownerStatement.findMany({
        where: { organizationId: u.organizationId, ...(owner ? { owner: { name: textLike(owner) } } : {}), ...(status && STATEMENT_STATUS[status] ? { status } : {}) },
        select: { code: true, periodStart: true, periodEnd: true, collectedRent: true, managementFees: true, expenses: true, otherDeductions: true, netDue: true, status: true, paidAt: true, owner: { select: { name: true } }, property: { select: { name: true } } },
        orderBy: { periodEnd: "desc" },
        take: int(a.limit, 25, 1, 100),
      });
      return rows.map((s) => ({ statement: s.code, owner: s.owner.name, property: s.property?.name ?? "كل العقارات", periodStart: day(s.periodStart), periodEnd: day(s.periodEnd), collectedRent: s.collectedRent, managementFees: s.managementFees, expenses: s.expenses, otherDeductions: s.otherDeductions, netDue: s.netDue, status: label(STATEMENT_STATUS, s.status), paidAt: day(s.paidAt) }));
    },
  },
  {
    name: "list_tasks",
    title: "المهام",
    description: "Open tasks (or all, with includeDone), most urgent first. By default only the caller's own tasks; mine=false lists the whole office.",
    permission: "tasks.view",
    inputSchema: { type: "object", properties: { mine: { type: "boolean", description: "Only tasks assigned to or created by me (default true)." }, overdueOnly: { type: "boolean" }, includeDone: { type: "boolean" }, limit: LIMIT } },
    run: async (u, a) => {
      // Employees limited to some properties keep to their own tasks, as on /tasks.
      const mine = a.mine !== false || isScoped(u);
      const rows = await db.task.findMany({
        where: {
          organizationId: u.organizationId,
          AND: [
            mine ? { OR: [{ assignedToId: u.id }, { assignedToId: null, createdById: u.id }] } : {},
            a.includeDone === true ? {} : { status: { in: OPEN_TASK } },
            a.overdueOnly === true ? { dueDate: { lt: startOfDay() } } : {},
          ],
        },
        select: { title: true, description: true, priority: true, status: true, dueDate: true, entityLabel: true, assignedTo: { select: { name: true } } },
        orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
        take: int(a.limit, 25, 1, 100),
      });
      return rows.map((t) => ({ title: t.title, details: t.description, priority: label(TASK_PRIORITY, t.priority), status: label(TASK_STATUS, t.status), due: day(t.dueDate), about: t.entityLabel, assignedTo: t.assignedTo?.name ?? null }));
    },
  },
];

/** The tools this member may use: the assistant is never even told about a module the member cannot open. */
export function toolsFor(user: McpUser) {
  return TOOLS.filter((t) => can(user, t.permission));
}
