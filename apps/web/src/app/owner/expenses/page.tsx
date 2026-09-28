import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, date, pct, num, pageParam } from "@/lib/format";
import { EXPENSE_CATEGORIES } from "@/lib/constants";
import { PageHeader, Card, Table, EmptyState, FilterBar, Select, Input, Pagination, StatGrid, StatCard, Tag } from "@/components/ui";
import { getOwnerScope } from "../_scope";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 30;

export default async function OwnerExpensesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOwner();
  const scope = await getOwnerScope(user);
  const sp = await searchParams;
  const page = pageParam(sp.page);
  const from = sp.from ? new Date(sp.from) : null;
  const to = sp.to ? new Date(`${sp.to}T23:59:59`) : null;

  const where = {
    organizationId: scope.org,
    approvalStatus: "APPROVED",
    propertyId: { in: sp.propertyId && scope.allPropertyIds.includes(sp.propertyId) ? [sp.propertyId] : scope.allPropertyIds },
    ...(sp.category ? { category: sp.category } : {}),
    ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
  };

  const [total, rows, allRows] = await Promise.all([
    db.expense.count({ where }),
    db.expense.findMany({ where, orderBy: { date: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { property: { select: { name: true } }, unit: { select: { number: true } } } }),
    db.expense.findMany({ where, select: { amount: true, vatAmount: true, propertyId: true, date: true, category: true } }),
  ]);

  const share = (propertyId: string, d: Date, amt: number) => (amt * scope.pctOf(propertyId, d)) / 100;
  const totalGross = allRows.reduce((s, e) => s + e.amount + e.vatAmount, 0);
  const totalShare = allRows.reduce((s, e) => s + share(e.propertyId, e.date, e.amount + e.vatAmount), 0);
  const byCat = Object.entries(
    allRows.reduce<Record<string, number>>((acc, e) => {
      acc[e.category] = (acc[e.category] ?? 0) + share(e.propertyId, e.date, e.amount + e.vatAmount);
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);
  const hasFilters = Boolean(sp.propertyId || sp.category || sp.from || sp.to);

  return (
    <>
      <PageHeader title="المصروفات" subtitle="المصروفات المعتمدة على عقاراتك، وحصتك منها حسب نسبة الملكية" />
      <StatGrid cols={3}>
        <StatCard label="إجمالي المصروفات المعتمدة" value={money(totalGross)} sub={`${num(allRows.length)} مصروف`} />
        <StatCard label="حصتك" value={money(totalShare)} dark />
        <StatCard label="أعلى فئة" value={byCat[0] ? EXPENSE_CATEGORIES[byCat[0][0]] ?? byCat[0][0] : "—"} sub={byCat[0] ? `${money(byCat[0][1])} ر.س` : undefined} />
      </StatGrid>
      <div className="mt-4">
        <FilterBar base="/owner/expenses" hasFilters={hasFilters}>
          <Select name="propertyId" options={scope.properties.map((p) => ({ value: p.id, label: p.name }))} placeholder="كل العقارات" defaultValue={sp.propertyId ?? ""} />
          <Select name="category" options={EXPENSE_CATEGORIES} placeholder="كل الفئات" defaultValue={sp.category ?? ""} />
          <Input name="from" type="date" defaultValue={sp.from ?? ""} />
          <Input name="to" type="date" defaultValue={sp.to ?? ""} />
        </FilterBar>
      </div>
      <Card padded={false}>
        {rows.length === 0 ? (
          <EmptyState title="لا توجد مصروفات معتمدة" description="تظهر هنا المصروفات بعد اعتمادها من المكتب." action={hasFilters ? <Link href="/owner/expenses" className="btn btn-outline btn-sm">مسح الفلاتر</Link> : undefined} />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <th>الرقم</th>
                  <th>التاريخ</th>
                  <th>العقار / الوحدة</th>
                  <th>الوصف</th>
                  <th>الفئة</th>
                  <th>الجهة</th>
                  <th>المبلغ</th>
                  <th>الضريبة</th>
                  <th>نسبتك</th>
                  <th>حصتك</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => {
                  const p = scope.pctOf(e.propertyId, e.date);
                  return (
                    <tr key={e.id}>
                      <td className="latin">{e.code}</td>
                      <td className="num">{date(e.date)}</td>
                      <td>{e.property.name}{e.unit ? ` — ${e.unit.number}` : ""}</td>
                      <td>{e.description}</td>
                      <td><Tag plain>{EXPENSE_CATEGORIES[e.category] ?? e.category}</Tag></td>
                      <td>{e.payee ?? "—"}</td>
                      <td className="num">{money(e.amount)}</td>
                      <td className="num">{money(e.vatAmount)}</td>
                      <td className="num">{pct(p, 0)}</td>
                      <td className="num font-bold">{money(((e.amount + e.vatAmount) * p) / 100)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} base="/owner/expenses" params={sp} />
          </>
        )}
      </Card>
    </>
  );
}
