// Office access model: two team roles.
//   ACCOUNT_OWNER (صاحب الحساب) — every permission, always. Manages the team, settings and integrations.
//   EMPLOYEE (موظف)            — only the permissions an owner granted (User.permissions), on all properties or
//                                 only the assigned ones (User.allProperties = false → PropertyAssignment rows).
// Portal users (OWNER = property owner, TENANT) hold no office permissions; SUPER_ADMIN holds all.
import { redirect } from "next/navigation";
import type { Role } from "./constants";
import type { SessionUser } from "./auth";

export type Permission =
  | "dashboard.view"
  | "properties.view" | "properties.manage"
  | "units.view" | "units.manage"
  | "owners.view" | "owners.manage" | "owners.financial"
  | "tenants.view" | "tenants.manage"
  | "leasing.view" | "leasing.manage"
  | "contracts.view" | "contracts.manage" | "contracts.approve"
  | "installments.view" | "installments.waive"
  | "collections.view" | "collections.manage"
  | "payments.view" | "payments.manage" | "payments.approve"
  | "expenses.view" | "expenses.manage" | "expenses.approve"
  | "statements.view" | "statements.manage" | "statements.approve"
  | "tasks.view" | "tasks.manage"
  | "employees.view" | "employees.manage"
  | "reports.view" | "reports.financial" | "reports.export"
  | "documents.view" | "documents.manage"
  | "audit.view"
  | "integrations.manage"
  | "settings.manage"
  | "import.manage";

export const ALL_PERMISSIONS: Permission[] = [
  "dashboard.view",
  "properties.view", "properties.manage",
  "units.view", "units.manage",
  "owners.view", "owners.manage", "owners.financial",
  "tenants.view", "tenants.manage",
  "leasing.view", "leasing.manage",
  "contracts.view", "contracts.manage", "contracts.approve",
  "installments.view", "installments.waive",
  "collections.view", "collections.manage",
  "payments.view", "payments.manage", "payments.approve",
  "expenses.view", "expenses.manage", "expenses.approve",
  "statements.view", "statements.manage", "statements.approve",
  "tasks.view", "tasks.manage",
  "employees.view", "employees.manage",
  "reports.view", "reports.financial", "reports.export",
  "documents.view", "documents.manage",
  "audit.view",
  "integrations.manage",
  "settings.manage",
  "import.manage",
];

/** Kept for the account owner: managing the team and its permissions, office settings and subscription, integrations. */
export const OWNER_ONLY: Permission[] = ["employees.manage", "settings.manage", "integrations.manage"];

/** What an owner may grant to an employee. */
export const GRANTABLE: Permission[] = ALL_PERMISSIONS.filter((p) => !OWNER_ONLY.includes(p));

/** Holding one permission brings the ones it cannot work without (manage → view, approve statements → prepare them). */
const IMPLIES: Partial<Record<Permission, Permission[]>> = {
  "statements.approve": ["statements.manage"],
};

function withImplied(set: Set<Permission>) {
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of [...set]) {
      const extra = [...(IMPLIES[p] ?? [])];
      const view = `${p.split(".")[0]}.view` as Permission;
      if (p !== view && ALL_PERMISSIONS.includes(view)) extra.push(view);
      for (const e of extra) {
        if (!set.has(e) && GRANTABLE.includes(e)) {
          set.add(e);
          grew = true;
        }
      }
    }
  }
  return set;
}

/**
 * The stored form of an employee's permissions: known, grantable keys only, plus everything they imply,
 * plus the dashboard (every team member has a home page), in catalogue order. Accepts a JSON string or a list.
 */
export function normalizePermissions(input: unknown): Permission[] {
  let list: unknown = input;
  if (typeof input === "string") {
    try {
      list = JSON.parse(input);
    } catch {
      list = [];
    }
  }
  const set = new Set<Permission>(["dashboard.view"]);
  if (Array.isArray(list)) for (const p of list) if (GRANTABLE.includes(p as Permission)) set.add(p as Permission);
  withImplied(set);
  return GRANTABLE.filter((p) => set.has(p));
}

/** Permission checklist shown to the owner, grouped the way the office works. */
export const PERMISSION_GROUPS: { key: string; label: string; items: { key: Permission; label: string }[] }[] = [
  {
    key: "properties",
    label: "العقارات والوحدات",
    items: [
      { key: "properties.view", label: "عرض العقارات" },
      { key: "properties.manage", label: "إضافة العقارات وتعديلها" },
      { key: "units.view", label: "عرض الوحدات" },
      { key: "units.manage", label: "إضافة الوحدات وتعديلها" },
    ],
  },
  {
    key: "owners",
    label: "الملاك",
    items: [
      { key: "owners.view", label: "عرض الملاك" },
      { key: "owners.manage", label: "إضافة الملاك وتعديلهم" },
      { key: "owners.financial", label: "الاطلاع على الأرقام المالية للملاك" },
    ],
  },
  {
    key: "leasing",
    label: "المستأجرون والتأجير",
    items: [
      { key: "tenants.view", label: "عرض المستأجرين" },
      { key: "tenants.manage", label: "إضافة المستأجرين وتعديلهم" },
      { key: "leasing.view", label: "عرض طلبات التأجير" },
      { key: "leasing.manage", label: "متابعة طلبات التأجير" },
    ],
  },
  {
    key: "contracts",
    label: "العقود والدفعات",
    items: [
      { key: "contracts.view", label: "عرض العقود" },
      { key: "contracts.manage", label: "إنشاء العقود وتجديدها وإنهاؤها" },
      { key: "contracts.approve", label: "اعتماد العقود" },
      { key: "installments.view", label: "عرض جدول الدفعات" },
      { key: "installments.waive", label: "الإعفاء من الدفعات" },
    ],
  },
  {
    key: "collections",
    label: "التحصيل وسندات القبض",
    items: [
      { key: "collections.view", label: "عرض المطالبات" },
      { key: "collections.manage", label: "متابعة المطالبات وتسجيل الوعود" },
      { key: "payments.view", label: "عرض سندات القبض" },
      { key: "payments.manage", label: "تسجيل سندات القبض" },
      { key: "payments.approve", label: "اعتماد سندات القبض وعكسها" },
    ],
  },
  {
    key: "expenses",
    label: "المصروفات",
    items: [
      { key: "expenses.view", label: "عرض المصروفات" },
      { key: "expenses.manage", label: "تسجيل المصروفات" },
      { key: "expenses.approve", label: "اعتماد المصروفات (ضمن حد الاعتماد)" },
    ],
  },
  {
    key: "statements",
    label: "كشوف حساب الملاك",
    items: [
      { key: "statements.view", label: "عرض الكشوف" },
      { key: "statements.manage", label: "إعداد الكشوف وإرسالها للمراجعة" },
      { key: "statements.approve", label: "اعتماد الكشوف وتسجيل التحويل" },
    ],
  },
  {
    key: "work",
    label: "المهام والمستندات",
    items: [
      { key: "tasks.view", label: "عرض المهام" },
      { key: "tasks.manage", label: "إنشاء المهام وإسنادها" },
      { key: "documents.view", label: "عرض المستندات" },
      { key: "documents.manage", label: "رفع المستندات وتعديلها" },
    ],
  },
  {
    key: "reports",
    label: "التقارير والرقابة",
    items: [
      { key: "reports.view", label: "عرض التقارير التشغيلية" },
      { key: "reports.financial", label: "التقارير المالية" },
      { key: "reports.export", label: "تصدير التقارير" },
      { key: "audit.view", label: "سجل العمليات" },
      { key: "employees.view", label: "عرض فريق العمل" },
      { key: "import.manage", label: "الاستيراد من Excel" },
    ],
  },
];

const VIEW_ONLY = GRANTABLE.filter((p) => p.endsWith(".view") || p === "reports.financial" || p === "owners.financial" || p === "audit.view");

/** Starting points for an employee's permissions; the owner can adjust any box afterwards. */
export const PRESETS: { key: string; label: string; description: string; allProperties: boolean; permissions: Permission[] }[] = [
  {
    key: "PROPERTY",
    label: "إدارة العقارات",
    description: "عقاراته المسندة: الوحدات والمستأجرون والعقود والمصروفات والمهام",
    allProperties: false,
    permissions: normalizePermissions([
      "properties.manage", "units.manage", "owners.view", "tenants.manage", "leasing.manage", "contracts.manage",
      "installments.view", "collections.view", "payments.view", "expenses.manage", "tasks.manage", "reports.view", "documents.manage",
    ]),
  },
  {
    key: "LEASING",
    label: "التأجير",
    description: "الوحدات الشاغرة وطلبات التأجير والمستأجرون وإنشاء العقود",
    allProperties: true,
    permissions: normalizePermissions(["properties.view", "units.manage", "tenants.manage", "leasing.manage", "contracts.manage", "installments.view", "tasks.manage", "documents.manage"]),
  },
  {
    key: "COLLECTION",
    label: "التحصيل",
    description: "المطالبات والوعود وتسجيل سندات القبض",
    allProperties: true,
    permissions: normalizePermissions(["properties.view", "units.view", "tenants.view", "contracts.view", "installments.view", "collections.manage", "payments.manage", "tasks.manage", "documents.view"]),
  },
  {
    key: "ACCOUNTING",
    label: "المحاسبة",
    description: "السندات والمصروفات وكشوف الملاك والتقارير المالية",
    allProperties: true,
    permissions: normalizePermissions([
      "properties.view", "units.view", "owners.financial", "tenants.view", "contracts.view", "installments.waive", "collections.view",
      "payments.approve", "payments.manage", "expenses.approve", "expenses.manage", "statements.approve", "tasks.manage",
      "reports.financial", "reports.export", "documents.manage", "audit.view",
    ]),
  },
  {
    key: "READONLY",
    label: "اطلاع فقط",
    description: "يرى كل الأقسام دون أي تعديل (مراجعة أو تدقيق)",
    allProperties: true,
    permissions: normalizePermissions(VIEW_ONLY),
  },
  {
    key: "FULL",
    label: "كل الصلاحيات",
    description: "كل ما في المكتب عدا فريق العمل والإعدادات والتكاملات",
    allProperties: true,
    permissions: normalizePermissions(GRANTABLE),
  },
];

/** The preset an employee's permissions match exactly, if any (shown as a label in the team list). */
export function matchPreset(permissions: Permission[], allProperties: boolean) {
  const key = [...permissions].sort().join(",");
  return PRESETS.find((p) => p.allProperties === allProperties && [...p.permissions].sort().join(",") === key) ?? null;
}

type PermUser = { role: Role | string; permissions?: readonly string[] };

export function isAccountOwner(user: { role: Role | string }) {
  return user.role === "ACCOUNT_OWNER" || user.role === "SUPER_ADMIN";
}

export function can(user: PermUser, permission: Permission): boolean {
  if (isAccountOwner(user)) return true;
  if (user.role !== "EMPLOYEE" || OWNER_ONLY.includes(permission)) return false;
  return user.permissions?.includes(permission) ?? false;
}

export function canAny(user: PermUser, permissions: Permission[]): boolean {
  return permissions.some((p) => can(user, p));
}

/** Everything the user can do, in catalogue order (all of it for an owner). */
export function effectivePermissions(user: PermUser): Permission[] {
  return ALL_PERMISSIONS.filter((p) => can(user, p));
}

/** Employees limited to assigned properties see only those — with no assignment they see none (never the whole office). */
export function isScoped(user: { role: Role | string; allProperties?: boolean }) {
  return user.role === "EMPLOYEE" && user.allProperties === false;
}

/**
 * Prisma `where` fragment for property-scoped entities.
 * Usage: db.property.findMany({ where: { organizationId, ...propertyScope(user) } })
 */
export function propertyScope(user: SessionUser): { id?: { in: string[] } } {
  if (isScoped(user)) return { id: { in: user.assignedPropertyIds } };
  return {};
}

/** For entities with propertyId (units, contracts, expenses). */
export function propertyIdScope(user: SessionUser): { propertyId?: { in: string[] } } {
  if (isScoped(user)) return { propertyId: { in: user.assignedPropertyIds } };
  return {};
}

/** For entities reached through a contract (installments, payments). */
export function contractScope(user: SessionUser): { contract?: { propertyId: { in: string[] } } } {
  if (isScoped(user)) return { contract: { propertyId: { in: user.assignedPropertyIds } } };
  return {};
}

/** Server actions: stops with the Arabic "no permission" page (a thrown message would be replaced by English text in production). */
export function assertCan(user: SessionUser, permission: Permission) {
  if (!can(user, permission)) redirect("/forbidden");
}

/** Server actions reserved for the account owner (team, settings, manager-level approvals). */
export function assertOwner(user: SessionUser) {
  if (!isAccountOwner(user)) redirect("/forbidden");
}
