import type { Permission } from "./permissions";
import type { IconName } from "@/components/icons";

export interface NavItem {
  href: string;
  label: string;
  permission?: Permission;
  countKey?: string;
  icon?: IconName;
  /** Short label for the narrow rail and the bottom bar (falls back to label). */
  short?: string;
  /** Candidate for the phone bottom bar (first four permitted ones, in order). */
  bottom?: boolean;
}

export interface NavSection {
  title: string;
  items: NavItem[];
  /** Daily sections: shown in the desktop dock (the full menu panel always lists every group). */
  dock?: boolean;
}

// Grouped the way an office works. Every item carries its permission: the sidebar, the phone menu and the route guard
// all read this list, so an employee sees exactly the sections the account owner granted — nothing else.
export const NAV: NavSection[] = [
  {
    title: "",
    dock: true,
    items: [{ href: "/dashboard", label: "الرئيسية", permission: "dashboard.view", icon: "home", bottom: true }],
  },
  {
    title: "العمل اليومي",
    dock: true,
    items: [
      { href: "/properties", label: "العقارات", permission: "properties.view", icon: "building", bottom: true },
      { href: "/contracts", label: "العقود", permission: "contracts.view", countKey: "expiring", icon: "file" },
      { href: "/collections", label: "التحصيل", permission: "collections.view", countKey: "overdue", icon: "coins", bottom: true },
      { href: "/payments", label: "سندات القبض", short: "السندات", permission: "payments.view", icon: "wallet", bottom: true },
      { href: "/expenses", label: "المصروفات", permission: "expenses.view", countKey: "pendingExpenses", icon: "receipt" },
      { href: "/tasks", label: "المهام", permission: "tasks.view", countKey: "tasks", icon: "tasks", bottom: true },
    ],
  },
  {
    title: "المالية",
    items: [
      { href: "/statements", label: "كشوف حساب الملاك", short: "كشوف الملاك", permission: "statements.view", icon: "bank" },
      { href: "/installments", label: "جدول الدفعات", short: "الدفعات", permission: "installments.view", icon: "clock" },
      { href: "/reconciliation", label: "المطابقة البنكية", short: "المطابقة", permission: "payments.approve", icon: "check" },
      { href: "/reports", label: "التقارير", permission: "reports.view", icon: "chart" },
    ],
  },
  {
    title: "السجلات",
    items: [
      { href: "/units", label: "الوحدات", permission: "units.view", icon: "door" },
      { href: "/owners", label: "الملاك", permission: "owners.view", icon: "key" },
      { href: "/tenants", label: "المستأجرون", permission: "tenants.view", icon: "users" },
      { href: "/leasing", label: "طلبات التأجير", short: "التأجير", permission: "leasing.view", icon: "handshake" },
      { href: "/documents", label: "المستندات", permission: "documents.view", icon: "folder" },
    ],
  },
  {
    title: "الإدارة",
    items: [
      { href: "/employees", label: "فريق العمل", permission: "employees.view", icon: "shield" },
      { href: "/notifications", label: "الإشعارات", countKey: "notifications", icon: "bell" },
      { href: "/audit", label: "سجل العمليات", permission: "audit.view", icon: "clock" },
      { href: "/import", label: "الاستيراد من Excel", short: "الاستيراد", permission: "import.manage", icon: "upload" },
      { href: "/integrations", label: "التكاملات", permission: "integrations.manage", icon: "plug" },
      { href: "/settings", label: "الإعدادات", permission: "settings.manage", icon: "settings" },
      { href: "/assistant", label: "المساعد الذكي", short: "المساعد", icon: "sparkle" },
      { href: "/help", label: "المساعدة", icon: "help" },
    ],
  },
];

export const OWNER_NAV: NavItem[] = [
  { href: "/owner", label: "الرئيسية", icon: "home", bottom: true },
  { href: "/owner/properties", label: "عقاراتي", icon: "building", bottom: true },
  { href: "/owner/contracts", label: "العقود", icon: "file" },
  { href: "/owner/collections", label: "التحصيل والمتأخرات", short: "التحصيل", icon: "coins", bottom: true },
  { href: "/owner/expenses", label: "المصروفات", icon: "receipt" },
  { href: "/owner/statements", label: "كشوف الحساب", short: "الكشوف", icon: "bank", bottom: true },
  { href: "/owner/documents", label: "المستندات", icon: "folder" },
];

export const TENANT_NAV: NavItem[] = [
  { href: "/tenant", label: "الرئيسية", icon: "home" },
  { href: "/tenant/contract", label: "عقدي", icon: "file" },
  { href: "/tenant/payments", label: "دفعاتي", icon: "wallet" },
  { href: "/tenant/documents", label: "المستندات", icon: "folder" },
  { href: "/tenant/notifications", label: "الإشعارات", icon: "bell" },
];

export const ADMIN_NAV: NavItem[] = [
  { href: "/admin", label: "نظرة عامة", short: "الرئيسية", icon: "home", bottom: true },
  { href: "/admin/organizations", label: "العملاء", icon: "building", bottom: true },
  { href: "/admin/requests", label: "طلبات الحسابات", short: "الطلبات", icon: "handshake", countKey: "requests", bottom: true },
  { href: "/admin/subscriptions", label: "الاشتراكات والخطط", short: "الاشتراكات", icon: "coins" },
  { href: "/admin/health", label: "حالة الخدمات", short: "الخدمات", icon: "plug" },
  { href: "/admin/support", label: "الدعم الفني", short: "الدعم", icon: "help", bottom: true },
  { href: "/admin/audit", label: "سجل المنصة", short: "السجل", icon: "clock" },
];

/** Paths every staff member may open even though their module (first segment) needs a permission: own profile and sessions. */
const OPEN_STAFF_PATHS = ["/settings", "/settings/profile", "/settings/security"];

/**
 * The view permission a staff path needs: the NAV permission of its first segment ("/statements/abc" → statements.view).
 * Enforced inside requireStaff() so it runs on every page render, soft navigation (RSC fetch) and server action —
 * a guard in the shared layout alone does not re-run on client-side navigation.
 */
export function routePermission(pathname: string): Permission | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (OPEN_STAFF_PATHS.includes(path)) return null;
  const seg = "/" + (path.split("/")[1] ?? "");
  return NAV.flatMap((s) => s.items).find((i) => i.href === seg)?.permission ?? null;
}

/** Permission a link needs: the module's view permission, or its manage permission for /new and /edit forms. */
export function hrefPermission(href: string): Permission | null {
  const path = href.split(/[?#]/)[0];
  const base = routePermission(path);
  if (!base) return null;
  if (/\/(new|edit)$/.test(path) && base.endsWith(".view")) return base.replace(/\.view$/, ".manage") as Permission;
  return base;
}
