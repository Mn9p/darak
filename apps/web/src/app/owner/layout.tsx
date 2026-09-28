import { requireOwner } from "@/lib/auth";
import { db } from "@/lib/db";
import { OWNER_NAV } from "@/lib/nav";
import { Shell } from "@/components/shell/Shell";

export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  const user = await requireOwner();
  const unread = await db.notification.count({ where: { userId: user.id, organizationId: user.organizationId, readAt: null } });

  return (
    <Shell user={user} sections={OWNER_NAV} orgName={user.organizationName} portalLabel="بوابة المالك" counts={{ notifications: unread }} unread={unread} notificationsHref="/owner/notifications" home={{ href: "/owner", label: "الرئيسية" }}>
      {children}
    </Shell>
  );
}
