import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { num, money, date, daysFromToday, addDays, pageParam } from "@/lib/format";
import { PLANS, ORG_STATUS } from "@/lib/constants";
import { PageHeader, Card, Table, StatusTag, EmptyState, FilterBar, Select, Input, Pagination, StatGrid, StatCard, ActionButton, Tag, Progress } from "@/components/ui";
import { renewSubscription, changePlan } from "../actions";
import { MoreMenu } from "@/components/MoreMenu";
import { textLike } from "@/lib/search";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 25;

export default async function SubscriptionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireSuperAdmin();
  const sp = await searchParams;
  const page = pageParam(sp.page);
  const q = sp.q?.trim();
  const now = new Date();
  const in30 = addDays(now, 30);

  const where = {
    ...(sp.plan ? { plan: sp.plan } : {}),
    ...(sp.status ? { status: sp.status } : {}),
    ...(sp.renewal === "expired" ? { renewalDate: { lt: now } } : sp.renewal === "soon" ? { renewalDate: { gte: now, lte: in30 } } : sp.renewal === "none" ? { renewalDate: null } : {}),
    ...(q ? { OR: [{ name: textLike(q) }, { slug: textLike(q) }, { email: textLike(q) }] } : {}),
  };

  const [total, rows, all] = await Promise.all([
    db.organization.count({ where }),
    db.organization.findMany({
      where,
      orderBy: [{ renewalDate: "asc" }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: { id: true, name: true, slug: true, plan: true, status: true, unitsLimit: true, usersLimit: true, renewalDate: true, createdAt: true, _count: { select: { units: { where: { status: { not: "ARCHIVED" } } }, users: { where: { status: "ACTIVE" } } } } },
    }),
    db.organization.findMany({ select: { plan: true, status: true, renewalDate: true } }),
  ]);

  const active = all.filter((o) => o.status === "ACTIVE");
  const mrr = active.reduce((s, o) => s + (PLANS[o.plan]?.price ?? 0), 0);
  const expiringSoon = all.filter((o) => o.renewalDate && o.renewalDate >= now && o.renewalDate <= in30).length;
  const expired = all.filter((o) => o.renewalDate && o.renewalDate < now).length;
  const trials = all.filter((o) => o.status === "TRIAL").length;
  const hasFilters = Boolean(sp.plan || sp.status || sp.renewal || q);
  const planOptions = Object.fromEntries(Object.entries(PLANS).map(([k, v]) => [k, v.label]));

  return (
    <>
      <PageHeader title="الاشتراكات والخطط" subtitle="الإيراد المتكرر، مواعيد التجديد، وتغيير الخطط لكل مكتب" />

      <StatGrid cols={4}>
        <StatCard label="الإيراد الشهري" value={money(mrr)} sub={`سنوي ≈ ${money(mrr * 12)} ر.س`} dark />
        <StatCard label="اشتراكات نشطة" value={num(active.length)} sub={`من ${num(all.length)} مكتب · ${num(trials)} تجريبي`} href="/admin/subscriptions?status=ACTIVE" />
        <StatCard label="تنتهي خلال 30 يوم" value={num(expiringSoon)} tone={expiringSoon ? "warning" : undefined} href="/admin/subscriptions?renewal=soon" />
        <StatCard label="منتهية" value={num(expired)} tone={expired ? "danger" : undefined} href="/admin/subscriptions?renewal=expired" />
      </StatGrid>

      <div className="mt-4 grid gap-4 xl:grid-cols-4">
        <Card title="الخطط" padded={false} className="xl:col-span-1">
          <Table>
            <thead>
              <tr>
                <th>الخطة</th>
                <th>المكاتب</th>
                <th>السعر</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(PLANS).map(([k, p]) => (
                <tr key={k}>
                  <td className="font-semibold">{p.label}<div className="text-[11px] text-muted"><span className="num">{num(p.units)}</span> وحدة · <span className="num">{num(p.users)}</span> مستخدم</div></td>
                  <td className="num">{num(all.filter((o) => o.plan === k).length)}</td>
                  <td className="num">{p.price ? `${money(p.price)} ر.س` : "اتفاق"}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <Card padded={false} className="xl:col-span-3">
          <div className="px-4 pt-4">
            <FilterBar base="/admin/subscriptions" hasFilters={hasFilters}>
              <Input name="q" defaultValue={q ?? ""} placeholder="بحث: الاسم أو البريد" className="!w-52" />
              <Select name="plan" options={planOptions} placeholder="كل الخطط" defaultValue={sp.plan ?? ""} className="!w-36" />
              <Select name="status" options={ORG_STATUS} placeholder="كل الحالات" defaultValue={sp.status ?? ""} className="!w-36" />
              <Select name="renewal" options={[{ value: "soon", label: "تنتهي خلال 30 يوم" }, { value: "expired", label: "منتهية" }, { value: "none", label: "بدون تاريخ تجديد" }]} placeholder="كل مواعيد التجديد" defaultValue={sp.renewal ?? ""} className="!w-44" />
            </FilterBar>
          </div>
          {rows.length === 0 ? (
            <EmptyState title="لا توجد اشتراكات مطابقة" action={hasFilters ? <Link href="/admin/subscriptions" className="btn btn-outline btn-sm">مسح الفلاتر</Link> : <Link href="/admin/organizations/new" className="btn btn-primary btn-sm">إنشاء مكتب</Link>} />
          ) : (
            <>
              <Table>
                <thead>
                  <tr>
                    <th>المكتب</th>
                    <th>الخطة</th>
                    <th>الاستخدام</th>
                    <th>الشهري</th>
                    <th>التجديد</th>
                    <th>الحالة</th>
                    <th>إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((o) => {
                    const p = PLANS[o.plan];
                    const left = o.renewalDate ? daysFromToday(o.renewalDate) : null;
                    const uPct = o.unitsLimit ? (o._count.units / o.unitsLimit) * 100 : 0;
                    return (
                      <tr key={o.id} className="align-top">
                        <td>
                          <Link href={`/admin/organizations/${o.id}?tab=subscription`} className="link">{o.name}</Link>
                          <div className="latin text-[11px] text-muted">{o.slug}</div>
                        </td>
                        <td>
                          <form action={changePlan} className="flex items-center gap-1">
                            <input type="hidden" name="id" value={o.id} />
                            <Select name="plan" options={planOptions} defaultValue={o.plan} className="!h-8 !w-32 !text-xs" />
                            <button type="submit" className="btn btn-outline btn-xs">تغيير</button>
                          </form>
                        </td>
                        <td>
                          <div className="num text-[12px]">{num(o._count.units)} / {num(o.unitsLimit)} وحدة</div>
                          <div className="w-24"><Progress value={uPct} tone={uPct >= 90 ? "danger" : uPct >= 75 ? "warn" : undefined} /></div>
                          <div className="num text-[11px] text-muted">{num(o._count.users)} / {num(o.usersLimit)} مستخدم</div>
                        </td>
                        <td className="num">{p?.price ? `${money(p.price)} ر.س` : "اتفاق"}</td>
                        <td>
                          <div className="num">{date(o.renewalDate)}</div>
                          {left !== null && (
                            <Tag tone={left < 0 ? "danger" : left <= 30 ? "warning" : "neutral"} plain>{left < 0 ? `منتهي منذ ${num(-left)} يوم` : `${num(left)} يوم`}</Tag>
                          )}
                        </td>
                        <td><StatusTag value={o.status} map={ORG_STATUS} /></td>
                        <td>
                          <MoreMenu
                            label="إجراءات"
                            items={[
                              { label: "تجديد سنة", node: <ActionButton action={renewSubscription} hidden={{ id: o.id, months: "12" }} className="btn btn-ghost btn-sm">تجديد سنة</ActionButton> },
                              { label: "تمديد شهر", node: <ActionButton action={renewSubscription} hidden={{ id: o.id, months: "1" }} className="btn btn-ghost btn-sm">تمديد شهر</ActionButton> },
                              { label: "الاشتراك والحدود", href: `/admin/organizations/${o.id}?tab=subscription` },
                            ]}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
              <Pagination page={page} pageSize={PAGE_SIZE} total={total} base="/admin/subscriptions" params={sp} />
            </>
          )}
        </Card>
      </div>
    </>
  );
}
