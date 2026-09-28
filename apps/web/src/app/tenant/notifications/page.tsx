import Link from "next/link";
import { requireTenant } from "@/lib/auth";
import { db } from "@/lib/db";
import { datetime, num, pageParam } from "@/lib/format";
import { PageHeader, Card, EmptyState, ActionButton, Pagination, Tag } from "@/components/ui";
import type { Tone } from "@/lib/constants";
import { markNotificationRead, markAllNotificationsRead } from "../actions";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 30;
const SEVERITY: Record<string, { label: string; tone: Tone }> = {
  INFO: { label: "معلومة", tone: "info" },
  WARNING: { label: "تنبيه", tone: "warning" },
  DANGER: { label: "هام", tone: "danger" },
  SUCCESS: { label: "نجاح", tone: "success" },
};

export default async function TenantNotificationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireTenant();
  const sp = await searchParams;
  const page = pageParam(sp.page);
  const where = { userId: user.id, organizationId: user.organizationId };
  const [total, rows, unread] = await Promise.all([
    db.notification.count({ where }),
    db.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    db.notification.count({ where: { ...where, readAt: null } }),
  ]);

  return (
    <>
      <PageHeader
        title="الإشعارات"
        subtitle={unread > 0 ? `${num(unread)} إشعار غير مقروء` : "كل الإشعارات مقروءة"}
        actions={unread > 0 ? <ActionButton action={markAllNotificationsRead} className="btn btn-outline btn-sm">تعليم الكل كمقروء</ActionButton> : undefined}
      />
      <Card padded={false}>
        {rows.length === 0 ? (
          <EmptyState title="لا توجد إشعارات" description="ستصلك هنا تذكيرات الدفعات وتحديثات العقد." />
        ) : (
          <>
            <ul className="divide-y divide-line">
              {rows.map((n) => {
                const href = n.href && n.href.startsWith("/tenant") ? n.href : null;
                return (
                  <li key={n.id} className={`flex items-start justify-between gap-3 px-5 py-3.5 ${n.readAt ? "" : "bg-sand-75/40"}`}>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {!n.readAt && <span className="h-2 w-2 rounded-full bg-brand" aria-hidden />}
                        {href ? <Link href={href} className="link text-[13.5px]">{n.title}</Link> : <span className="text-[13.5px] font-bold text-text">{n.title}</span>}
                        <Tag tone={SEVERITY[n.severity]?.tone ?? "neutral"} plain>{SEVERITY[n.severity]?.label ?? n.severity}</Tag>
                      </div>
                      {n.body && <p className="mt-0.5 text-[12.5px] text-muted">{n.body}</p>}
                      <div className="num mt-1 text-[11px] text-faint">{datetime(n.createdAt)}</div>
                    </div>
                    {!n.readAt && (
                      <ActionButton action={markNotificationRead} hidden={{ id: n.id }} className="btn btn-ghost btn-sm min-h-[40px]">
                        تعليم كمقروء
                      </ActionButton>
                    )}
                  </li>
                );
              })}
            </ul>
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} base="/tenant/notifications" params={sp} />
          </>
        )}
      </Card>
    </>
  );
}
