import { requireTenant } from "@/lib/auth";
import { db } from "@/lib/db";
import { TENANT_NAV } from "@/lib/nav";
import { Shell } from "@/components/shell/Shell";

export default async function TenantLayout({ children }: { children: React.ReactNode }) {
  const user = await requireTenant();
  const unread = await db.notification.count({ where: { userId: user.id, organizationId: user.organizationId, readAt: null } });

  return (
    <Shell user={user} sections={TENANT_NAV} orgName={user.organizationName} portalLabel="بوابة المستأجر" counts={{ notifications: unread }} unread={unread} notificationsHref="/tenant/notifications" home={{ href: "/tenant", label: "الرئيسية" }}>
      {children}
    </Shell>
  );
}
