import type { Permission } from "./permissions";
import type { IconName } from "@/components/icons";

export interface NavItem {
  href: string;
  label: string;
  permission?: Permission;
  countKey?: string;
  icon?: IconName;
}

export interface NavSection {
  title: string;
  items: NavItem[];
  /** Collapsed by default under "المزيد" to keep the daily menu short. */
  secondary?: boolean;
}

// Daily work first (short), everything else under "المزيد". Property-first: units, owners and tenants are reached from the property.
export const NAV: NavSection[] = [
  {
    title: "",
    items: [{ href: "/dashboard", label: "الرئيسية", permission: "dashboard.view", icon: "home" }],
  },
  {
    title: "العمل اليومي",
    items: [
      { href: "/properties", label: "العقارات", permission: "properties.view", icon: "building" },
      { href: "/contracts", label: "العقود", permission: "contracts.view", countKey: "expiring", icon: "file" },
      { href: "/collections", label: "التحصيل", permission: "collections.view", countKey: "overdue", icon: "coins" },
      { href: "/payments", label: "سندات القبض", permission: "payments.view", icon: "wallet" },
      { href: "/expenses", label: "المصروفات", permission: "expenses.view", countKey: "pendingExpenses", icon: "receipt" },
      { href: "/statements", label: "كشوف حساب الملاك", permission: "statements.view", icon: "bank" },
      { href: "/tasks", label: "المهام", permission: "tasks.view", countKey: "tasks", icon: "tasks" },
    ],
  },
  {
    title: "المزيد",
    secondary: true,
    items: [
      { href: "/units", label: "الوحدات", permission: "units.view", icon: "door" },
      { href: "/owners", label: "الملاك", permission: "owners.view", icon: "key" },
      { href: "/tenants", label: "المستأجرون", permission: "tenants.view", icon: "users" },
      { href: "/leasing", label: "طلبات التأجير", permission: "leasing.view", icon: "handshake" },
      { href: "/installments", label: "جدول الدفعات", permission: "installments.view", icon: "clock" },
      { href: "/reports", label: "التقارير", permission: "reports.view", icon: "chart" },
      { href: "/documents", label: "المستندات", permission: "documents.view", icon: "folder" },
      { href: "/reconciliation", label: "المطابقة البنكية", permission: "payments.approve", icon: "bank" },
      { href: "/employees", label: "الموظفون", permission: "employees.view", icon: "user" },
      { href: "/notifications", label: "الإشعارات", countKey: "notifications", icon: "bell" },
      { href: "/audit", label: "سجل العمليات", permission: "audit.view", icon: "clock" },
      { href: "/import", label: "الاستيراد من Excel", permission: "import.manage", icon: "upload" },
      { href: "/integrations", label: "التكاملات", permission: "integrations.manage", icon: "plug" },
      { href: "/settings", label: "الإعدادات", permission: "settings.manage", icon: "settings" },
      { href: "/help", label: "المساعدة", icon: "help" },
    ],
  },
];

export const OWNER_NAV: NavItem[] = [
  { href: "/owner", label: "الرئيسية", icon: "home" },
  { href: "/owner/properties", label: "عقاراتي", icon: "building" },
  { href: "/owner/contracts", label: "العقود", icon: "file" },
  { href: "/owner/collections", label: "التحصيل والمتأخرات", icon: "coins" },
  { href: "/owner/expenses", label: "المصروفات", icon: "receipt" },
  { href: "/owner/statements", label: "كشوف الحساب", icon: "bank" },
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
  { href: "/admin", label: "نظرة عامة", icon: "home" },
  { href: "/admin/organizations", label: "العملاء", icon: "building" },
  { href: "/admin/requests", label: "طلبات الحسابات", icon: "handshake", countKey: "requests" },
  { href: "/admin/subscriptions", label: "الاشتراكات والخطط", icon: "coins" },
  { href: "/admin/health", label: "حالة الخدمات", icon: "plug" },
  { href: "/admin/support", label: "الدعم الفني", icon: "help" },
  { href: "/admin/audit", label: "سجل المنصة", icon: "clock" },
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
