import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { NAV } from "@/lib/nav";
import { can, contractScope, isAccountOwner, propertyIdScope } from "@/lib/permissions";
import { Shell } from "@/components/shell/Shell";
import type { QuickItem } from "@/components/shell/Nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireStaff();
  const org = user.organizationId;
  const owner = isAccountOwner(user);

  // The route guard (module permission per path) runs inside requireStaff() for every page, soft navigation and action.
  // Menu counts follow the same scope as the pages they point to (an employee limited to some properties counts only those).
  const [me, unread, expiring, overdue, pendingExpenses, tasks, branches, ownersCount, propertiesCount, unitsCount, activeContracts] = await Promise.all([
    db.user.findUnique({ where: { id: user.id }, select: { jobTitle: true } }),
    db.notification.count({ where: { userId: user.id, readAt: null } }),
    db.contract.count({ where: { organizationId: org, status: { in: ["EXPIRING_SOON", "RENEWAL_PENDING"] }, ...propertyIdScope(user) } }),
    db.installment.count({ where: { organizationId: org, status: "OVERDUE", ...contractScope(user) } }),
    db.expense.count({ where: { organizationId: org, approvalStatus: "PENDING", ...propertyIdScope(user) } }),
    db.task.count({ where: { organizationId: org, assignedToId: user.id, status: { notIn: ["COMPLETED", "CANCELLED"] } } }),
    db.branch.findMany({ where: { organizationId: org }, select: { id: true, name: true } }),
    owner ? db.owner.count({ where: { organizationId: org, status: { not: "ARCHIVED" } } }) : 0,
    owner ? db.property.count({ where: { organizationId: org, status: { not: "ARCHIVED" } } }) : 0,
    owner ? db.unit.count({ where: { organizationId: org, status: { not: "ARCHIVED" } } }) : 0,
    owner ? db.contract.count({ where: { organizationId: org, status: { in: ["ACTIVE", "EXPIRING_SOON", "RENEWAL_PENDING"] } } }) : 0,
  ]);

  // Office setup (owner only): owner → property → units → active contract. Shown in the sidebar until all four exist.
  const setupSteps = [ownersCount > 0, propertiesCount > 0, unitsCount > 0, activeContracts > 0];
  const setup = owner ? { done: setupSteps.filter(Boolean).length, total: setupSteps.length } : undefined;

  const sections = NAV.map((s) => ({ ...s, items: s.items.filter((i) => !i.permission || can(user, i.permission)) })).filter((s) => s.items.length);

  // Most frequent first: a receipt is what people record most often from a phone.
  const quick = [
    can(user, "payments.manage") && { href: "/payments/new", label: "سند قبض", icon: "wallet" },
    can(user, "contracts.manage") && { href: "/contracts/new", label: "عقد جديد", icon: "file" },
    can(user, "expenses.manage") && { href: "/expenses/new", label: "مصروف", icon: "receipt" },
    can(user, "tasks.manage") && { href: "/tasks/new", label: "مهمة", icon: "tasks" },
    can(user, "tenants.manage") && { href: "/tenants/new", label: "مستأجر", icon: "users" },
    can(user, "properties.manage") && { href: "/properties/new", label: "عقار", icon: "building" },
    can(user, "units.manage") && { href: "/units/new", label: "وحدة", icon: "door" },
    can(user, "owners.manage") && { href: "/owners/new", label: "مالك", icon: "key" },
    can(user, "employees.manage") && { href: "/employees/new", label: "عضو في الفريق", icon: "shield" },
  ].filter(Boolean) as QuickItem[];

  return (
    <Shell
      user={user}
      sections={sections}
      orgName={user.organizationName}
      counts={{ expiring, overdue, pendingExpenses, tasks, notifications: unread }}
      unread={unread}
      branches={owner ? branches : undefined}
      quick={quick}
      searchEnabled
      home={{ href: "/dashboard", label: "الرئيسية" }}
      setup={setup}
      helpHref="/help"
      jobTitle={user.role === "EMPLOYEE" ? me?.jobTitle : null}
    >
      {children}
    </Shell>
  );
}
