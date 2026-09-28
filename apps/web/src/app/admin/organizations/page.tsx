import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { num, date, daysFromToday, pageParam } from "@/lib/format";
import { PLANS, ORG_STATUS } from "@/lib/constants";
import { PageHeader, Card, Table, StatusTag, EmptyState, FilterBar, Select, Input, Pagination, Progress } from "@/components/ui";
import { textLike } from "@/lib/search";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 25;

export default async function OrganizationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireSuperAdmin();
  const sp = await searchParams;
  const page = pageParam(sp.page);
  const q = sp.q?.trim();
  const where = {
    ...(sp.plan ? { plan: sp.plan } : {}),
    ...(sp.status ? { status: sp.status } : {}),
    ...(q ? { OR: [{ name: textLike(q) }, { slug: textLike(q) }, { city: textLike(q) }, { email: textLike(q) }] } : {}),
  };
  const [total, rows] = await Promise.all([
    db.organization.count({ where }),
    db.organization.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: { id: true, name: true, slug: true, city: true, plan: true, status: true, unitsLimit: true, usersLimit: true, renewalDate: true, createdAt: true, _count: { select: { users: { where: { status: "ACTIVE" } }, units: { where: { status: { not: "ARCHIVED" } } } } } },
    }),
  ]);
  const hasFilters = Boolean(sp.plan || sp.status || q);
  const planOptions = Object.fromEntries(Object.entries(PLANS).map(([k, v]) => [k, v.label]));

  return (
    <>
      <PageHeader title="العملاء (المكاتب)" subtitle={`${num(total)} مكتب على المنصة`} actions={<Link href="/admin/organizations/new" className="btn btn-primary btn-sm">مكتب جديد</Link>} />
      <FilterBar base="/admin/organizations" hasFilters={hasFilters}>
        <Input name="q" defaultValue={q ?? ""} placeholder="بحث: الاسم، المدينة، البريد" className="!w-56" />
        <Select name="plan" options={planOptions} placeholder="كل الخطط" defaultValue={sp.plan ?? ""} />
        <Select name="status" options={ORG_STATUS} placeholder="كل الحالات" defaultValue={sp.status ?? ""} />
      </FilterBar>
      <Card padded={false}>
        {rows.length === 0 ? (
          <EmptyState title="لا توجد مكاتب مطابقة" action={hasFilters ? <Link href="/admin/organizations" className="btn btn-outline btn-sm">مسح الفلاتر</Link> : <Link href="/admin/organizations/new" className="btn btn-primary btn-sm">إنشاء مكتب</Link>} />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <th>المكتب</th>
                  <th>المدينة</th>
                  <th>الخطة</th>
                  <th>الوحدات (المستخدم / الحد)</th>
                  <th>المستخدمون (المستخدم / الحد)</th>
                  <th>التجديد</th>
                  <th>الحالة</th>
                  <th>انضم</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => {
                  const uPct = o.unitsLimit ? (o._count.units / o.unitsLimit) * 100 : 0;
                  const usPct = o.usersLimit ? (o._count.users / o.usersLimit) * 100 : 0;
                  const left = o.renewalDate ? daysFromToday(o.renewalDate) : null;
                  return (
                    <tr key={o.id}>
                      <td>
                        <Link href={`/admin/organizations/${o.id}`} className="link">{o.name}</Link>
                        <div className="latin text-[11px] text-muted">{o.slug}</div>
                      </td>
                      <td>{o.city ?? "—"}</td>
                      <td>{PLANS[o.plan]?.label ?? o.plan}</td>
                      <td>
                        <div className="num text-[12.5px]">{num(o._count.units)} / {num(o.unitsLimit)}</div>
                        <div className="w-24"><Progress value={uPct} tone={uPct >= 90 ? "danger" : uPct >= 75 ? "warn" : undefined} /></div>
                      </td>
                      <td>
                        <div className="num text-[12.5px]">{num(o._count.users)} / {num(o.usersLimit)}</div>
                        <div className="w-24"><Progress value={usPct} tone={usPct >= 90 ? "danger" : usPct >= 75 ? "warn" : undefined} /></div>
                      </td>
                      <td className="num">
                        {date(o.renewalDate)}
                        {left !== null && left <= 30 && <span className={`mr-1 text-[11px] ${left < 0 ? "text-danger" : "text-warning"}`}>({left < 0 ? "منتهي" : `${left} يوم`})</span>}
                      </td>
                      <td><StatusTag value={o.status} map={ORG_STATUS} /></td>
                      <td className="num">{date(o.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} base="/admin/organizations" params={sp} />
          </>
        )}
      </Card>
    </>
  );
}
