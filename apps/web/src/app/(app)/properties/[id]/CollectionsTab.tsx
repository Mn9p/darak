import Link from "next/link";
import type { SessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { propertyClaims, type ClaimFilter } from "@/lib/collections";
import { money, pct, num, date, daysFromToday } from "@/lib/format";
import { Card, StatGrid, StatCard, Progress, Table, EmptyState, Select } from "@/components/ui";
import { ClaimsTable } from "@/app/(app)/collections/ClaimsTable";

const FILTERS: { key: ClaimFilter; label: string }[] = [
  { key: "all", label: "الكل" },
  { key: "overdue", label: "متأخر" },
  { key: "promise", label: "وعد سداد" },
  { key: "broken", label: "وعد مكسور" },
  { key: "escalated", label: "مصعّد" },
  { key: "unassigned", label: "بلا محصل" },
];

/** The property's collections workspace: stats, filter chips, claims with the follow-up drawer, and what is coming next. */
export async function CollectionsTab({ user, propertyId, filter, unitId }: { user: SessionUser & { organizationId: string }; propertyId: string; filter?: string; unitId?: string }) {
  const org = user.organizationId;
  const f: ClaimFilter = (FILTERS.find((x) => x.key === filter)?.key ?? "all") as ClaimFilter;
  const [{ claims, upcoming, stats }, units, collectors, templates] = await Promise.all([
    propertyClaims(user, propertyId, f, unitId),
    db.unit.findMany({ where: { organizationId: org, propertyId, status: { not: "ARCHIVED" } }, select: { id: true, number: true }, orderBy: { number: "asc" } }),
    db.user.findMany({ where: { organizationId: org, role: { in: ["COLLECTOR", "OFFICE_MANAGER"] }, status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.notificationTemplate.findMany({ where: { organizationId: org, isActive: true, event: { in: ["INSTALLMENT_DUE", "INSTALLMENT_OVERDUE"] } }, orderBy: { name: "asc" }, select: { id: true, name: true, channel: true, body: true } }),
  ]);
  const base = `/properties/${propertyId}?tab=collections`;
  const link = (k: ClaimFilter, u?: string) => `${base}${k !== "all" ? `&f=${k}` : ""}${u ? `&unitId=${u}` : ""}`;
  const enforceable = claims.filter((c) => c.enforceable).length;

  return (
    <div className="space-y-4">
      <StatGrid cols={4}>
        <StatCard label="المستحق هذا الشهر" value={money(stats.dueMonth)} />
        <StatCard label="المحصل هذا الشهر" value={money(stats.paidMonth)} sub={<Progress value={stats.rate} tone={stats.dueMonth && stats.rate < 60 ? "danger" : stats.dueMonth && stats.rate < 85 ? "warn" : undefined} />} tone="success" />
        <StatCard label="المتأخر" value={money(stats.overdueAmt)} tone={stats.overdueAmt > 0 ? "danger" : undefined} sub={enforceable > 0 ? `${num(enforceable)} تجاوزت مهلة السداد` : undefined} />
        <StatCard label="نسبة التحصيل" value={pct(stats.rate)} dark />
      </StatGrid>

      <Card padded={false} title={`المطالبات (${claims.length})`} actions={can(user, "payments.manage") ? <Link href={`/payments/new?propertyId=${propertyId}`} className="btn btn-primary btn-sm">تسجيل سند قبض</Link> : undefined}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          {FILTERS.map((x) => (
            <Link key={x.key} href={link(x.key, unitId)} className={`btn btn-xs ${f === x.key ? "btn-primary" : "btn-ghost"}`}>
              {x.label}
            </Link>
          ))}
          <form method="get" action={`/properties/${propertyId}`} className="mr-auto flex items-center gap-2">
            <input type="hidden" name="tab" value="collections" />
            {f !== "all" && <input type="hidden" name="f" value={f} />}
            <Select name="unitId" options={units.map((u) => ({ value: u.id, label: `وحدة ${u.number}` }))} placeholder="كل الوحدات" defaultValue={unitId ?? ""} className="!h-8 !w-40 !text-xs" />
            <button type="submit" className="btn btn-ghost btn-xs">
              تطبيق
            </button>
          </form>
        </div>
        <ClaimsTable rows={claims} collectors={collectors} templates={templates} canManage={can(user, "collections.manage")} canPay={can(user, "payments.manage")} emptyHint={f !== "all" ? "لا توجد مطالبات بهذا الفلتر." : undefined} />
      </Card>

      <Card padded={false} title="الدفعات القادمة" subtitle="خلال 60 يومًا" actions={<Link href={`/installments?propertyId=${propertyId}`} className="link text-xs">جدول الدفعات</Link>}>
        {upcoming.length === 0 ? (
          <EmptyState title="لا توجد دفعات خلال 60 يومًا" />
        ) : (
          <Table density="compact">
            <thead>
              <tr>
                <th>المستأجر</th>
                <th>الوحدة</th>
                <th>الاستحقاق</th>
                <th className="num">المبلغ</th>
              </tr>
            </thead>
            <tbody>
              {upcoming.map((u) => (
                <tr key={u.id}>
                  <td>
                    <Link href={`/tenants/${u.tenantId}`} className="cell-primary hover:text-brand">
                      {u.tenantName}
                    </Link>
                    <div className="cell-sub latin">{u.contractCode} · {u.seq}</div>
                  </td>
                  <td className="latin">{u.unitNumber}</td>
                  <td>
                    {date(u.dueDate)}
                    <div className="cell-sub">بعد {daysFromToday(u.dueDate)} يوم</div>
                  </td>
                  <td className="num font-semibold">{money(u.amount)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
