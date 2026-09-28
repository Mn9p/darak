import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { NAV } from "@/lib/nav";
import { can } from "@/lib/permissions";
import { Shell } from "@/components/shell/Shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireStaff();
  const org = user.organizationId;

  // The route guard (module permission per path) runs inside requireStaff() for every page, soft navigation and action.

  const [unread, expiring, overdue, pendingExpenses, tasks, branches, ownersCount, propertiesCount, unitsCount, activeContracts] = await Promise.all([
    db.notification.count({ where: { userId: user.id, readAt: null } }),
    db.contract.count({ where: { organizationId: org, status: { in: ["EXPIRING_SOON", "RENEWAL_PENDING"] } } }),
    db.installment.count({ where: { organizationId: org, status: "OVERDUE" } }),
    db.expense.count({ where: { organizationId: org, approvalStatus: "PENDING" } }),
    db.task.count({ where: { organizationId: org, assignedToId: user.id, status: { notIn: ["COMPLETED", "CANCELLED"] } } }),
    db.branch.findMany({ where: { organizationId: org }, select: { id: true, name: true } }),
    db.owner.count({ where: { organizationId: org, status: { not: "ARCHIVED" } } }),
    db.property.count({ where: { organizationId: org, status: { not: "ARCHIVED" } } }),
    db.unit.count({ where: { organizationId: org, status: { not: "ARCHIVED" } } }),
    db.contract.count({ where: { organizationId: org, status: { in: ["ACTIVE", "EXPIRING_SOON", "RENEWAL_PENDING"] } } }),
  ]);

  // Office setup: owner → property → units → active contract. Shown in the sidebar until all four exist.
  const setupSteps = [ownersCount > 0, propertiesCount > 0, unitsCount > 0, activeContracts > 0];
  const setup = { done: setupSteps.filter(Boolean).length, total: setupSteps.length };

  const sections = NAV.map((s) => ({ ...s, items: s.items.filter((i) => !i.permission || can(user, i.permission)) })).filter((s) => s.items.length);

  const quick = [
    can(user, "properties.manage") && { href: "/properties/new", label: "عقار" },
    can(user, "units.manage") && { href: "/units/new", label: "وحدة" },
    can(user, "owners.manage") && { href: "/owners/new", label: "مالك" },
    can(user, "tenants.manage") && { href: "/tenants/new", label: "مستأجر" },
    can(user, "contracts.manage") && { href: "/contracts/new", label: "عقد" },
    can(user, "payments.manage") && { href: "/payments/new", label: "سند قبض" },
    can(user, "tasks.manage") && { href: "/tasks/new", label: "مهمة" },
    can(user, "expenses.manage") && { href: "/expenses/new", label: "مصروف" },
  ].filter(Boolean) as { href: string; label: string }[];

  return (
    <Shell
      user={user}
      sections={sections}
      orgName={user.organizationName}
      counts={{ expiring, overdue, pendingExpenses, tasks, notifications: unread }}
      unread={unread}
      branches={branches}
      quick={quick}
      searchEnabled
      home={{ href: "/dashboard", label: "الرئيسية" }}
      setup={setup}
      helpHref="/help"
    >
      {children}
    </Shell>
  );
}
