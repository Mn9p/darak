import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, date, num, pageParam, startOfYear } from "@/lib/format";
import { STATEMENT_STATUS } from "@/lib/constants";
import { PageHeader, Card, Table, StatusTag, EmptyState, FilterBar, Select, Pagination, StatGrid, StatCard } from "@/components/ui";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 25;

export default async function OwnerStatementsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOwner();
  const sp = await searchParams;
  const page = pageParam(sp.page);
  // Owners see a statement once the office approved it (drafts and statements under review stay internal).
  const VISIBLE = ["APPROVED", "PAID", "CLOSED"];
  const where = { organizationId: user.organizationId, ownerId: user.ownerId, status: sp.status && VISIBLE.includes(sp.status) ? sp.status : { in: VISIBLE } };

  const [total, rows, due, paid] = await Promise.all([
    db.ownerStatement.count({ where }),
    db.ownerStatement.findMany({ where, orderBy: { periodEnd: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { property: { select: { name: true } } } }),
    db.ownerStatement.aggregate({ where: { organizationId: user.organizationId, ownerId: user.ownerId, status: "APPROVED" }, _sum: { netDue: true }, _count: true }),
    db.ownerStatement.aggregate({ where: { organizationId: user.organizationId, ownerId: user.ownerId, status: { in: ["PAID", "CLOSED"] }, periodEnd: { gte: startOfYear() } }, _sum: { netDue: true } }),
  ]);
  const statuses = Object.fromEntries(Object.entries(STATEMENT_STATUS).filter(([k]) => VISIBLE.includes(k)));

  return (
    <>
      <PageHeader title="كشوف الحساب" subtitle="ما حصّله المكتب لك، وما خُصم منه، وصافي المستحق لكل فترة" />
      <StatGrid cols={3}>
        <StatCard label="صافي المستحق لك" value={money(due._sum.netDue ?? 0)} sub={`${num(due._count)} كشف معتمد أو قيد المراجعة`} tone="success" />
        <StatCard label="تم تحويله هذه السنة" value={money(paid._sum.netDue ?? 0)} />
        <StatCard label="عدد الكشوف" value={num(total)} />
      </StatGrid>
      <div className="mt-4">
        <FilterBar base="/owner/statements" hasFilters={Boolean(sp.status)}>
          <Select name="status" options={statuses} placeholder="كل الحالات" defaultValue={sp.status ?? ""} />
        </FilterBar>
      </div>
      <Card padded={false}>
        {rows.length === 0 ? (
          <EmptyState title="لا توجد كشوف حساب بعد" description="يصدر المكتب كشف الحساب دوريًا ويظهر هنا فور مراجعته." />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <th>الرقم</th>
                  <th>الفترة</th>
                  <th>العقار</th>
                  <th>المحصّل</th>
                  <th>أتعاب الإدارة</th>
                  <th>المصروفات</th>
                  <th>صافي المستحق</th>
                  <th>الحالة</th>
                  <th>تاريخ التحويل</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td><Link href={`/owner/statements/${s.id}`} className="link latin">{s.code}</Link></td>
                    <td className="num">{date(s.periodStart)} — {date(s.periodEnd)}</td>
                    <td>{s.property?.name ?? "كل العقارات"}</td>
                    <td className="num">{money(s.collectedRent)}</td>
                    <td className="num">{money(s.managementFees)}</td>
                    <td className="num">{money(s.expenses + s.otherDeductions)}</td>
                    <td className="num font-bold">{money(s.netDue)}</td>
                    <td><StatusTag value={s.status} map={STATEMENT_STATUS} /></td>
                    <td className="num">{date(s.paidAt)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} base="/owner/statements" params={sp} />
          </>
        )}
      </Card>
    </>
  );
}
