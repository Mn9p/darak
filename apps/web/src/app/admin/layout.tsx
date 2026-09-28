import { requireSuperAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { ADMIN_NAV } from "@/lib/nav";
import { Shell } from "@/components/shell/Shell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSuperAdmin();
  const [unread, openTickets, newRequests] = await Promise.all([
    db.notification.count({ where: { userId: user.id, readAt: null } }),
    db.supportTicket.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] } } }),
    db.accessRequest.count({ where: { status: "NEW" } }),
  ]);
  const nav = ADMIN_NAV.map((i) => (i.href === "/admin/support" ? { ...i, countKey: "tickets" } : i));

  return (
    <Shell user={user} sections={nav} portalLabel="إدارة المنصة" orgName="منصة دارك" counts={{ tickets: openTickets, requests: newRequests }} unread={unread} notificationsHref="/admin/support" home={{ href: "/admin", label: "نظرة عامة" }}>
      {children}
    </Shell>
  );
}
