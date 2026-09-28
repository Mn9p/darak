import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, date, daysOverdue, num, pageParam } from "@/lib/format";
import { INSTALLMENT_STATUS } from "@/lib/constants";
import { PageHeader, Card, Table, StatusTag, EmptyState, FilterBar, Select, Pagination, StatGrid, StatCard } from "@/components/ui";
import { getOwnerScope } from "../_scope";
import { getOrgSettings } from "@/lib/engine";
import { isArrears } from "@/lib/collections";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 30;

export default async function OwnerCollectionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOwner();
  const scope = await getOwnerScope(user);
  const sp = await searchParams;
  const page = pageParam(sp.page);

  const base = { organizationId: scope.org, contract: { propertyId: { in: sp.propertyId && scope.propertyIds.includes(sp.propertyId) ? [sp.propertyId] : scope.propertyIds } } };
  const where = { ...base, ...(sp.status ? { status: sp.status } : { status: { notIn: ["PAID", "WAIVED", "UPCOMING"] } }) };

  const [settings, total, rows, overdueAll, dueRows] = await Promise.all([
    getOrgSettings(scope.org),
    db.installment.count({ where }),
    db.installment.findMany({ where, orderBy: { dueDate: "asc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { contract: { select: { code: true, propertyId: true, unit: { select: { number: true } }, property: { select: { name: true } } } }, tenant: { select: { name: true } } } }),
    db.installment.findMany({ where: { ...base, status: { in: ["OVERDUE", "PARTIALLY_PAID"] } }, select: { amount: true, paidAmount: true, dueDate: true, status: true, contract: { select: { paymentFrequency: true } } } }),
    db.installment.aggregate({ where: { ...base, status: "DUE" }, _sum: { amount: true, paidAmount: true }, _count: true }),
  ]);

  // Arrears = past the statutory grace only; a partial payment still inside grace sits under "مستحق حاليًا".
  const overdueRows = overdueAll.filter((i) => isArrears(i, settings));
  const inGrace = overdueAll.filter((i) => !isArrears(i, settings));
  const overdueAmt = overdueRows.reduce((s, i) => s + (i.amount - i.paidAmount), 0);
  const dueAmt = (dueRows._sum.amount ?? 0) - (dueRows._sum.paidAmount ?? 0) + inGrace.reduce((s, i) => s + (i.amount - i.paidAmount), 0);
  const dueCount = dueRows._count + inGrace.length;
  const hasFilters = Boolean(sp.status || sp.propertyId);

  return (
    <>
      <PageHeader title="التحصيل والمتأخرات" subtitle="الأقساط غير المسددة على عقاراتك. يتابعها فريق التحصيل في المكتب." />
      <StatGrid cols={3}>
        <StatCard label="المتأخرات" value={money(overdueAmt)} sub={`${num(overdueRows.length)} قسط متأخر`} tone={overdueAmt > 0 ? "danger" : undefined} />
        <StatCard label="مستحق حاليًا" value={money(dueAmt)} sub={`${num(dueCount)} قسط`} tone={dueAmt > 0 ? "warning" : undefined} />
        <StatCard label="إجمالي غير المسدد" value={money(overdueAmt + dueAmt)} dark />
      </StatGrid>

      <div className="mt-4">
          <FilterBar base="/owner/collections" hasFilters={hasFilters}>
            <Select name="status" options={INSTALLMENT_STATUS} placeholder="غير المسدد (افتراضي)" defaultValue={sp.status ?? ""} />
            <Select name="propertyId" options={scope.properties.map((p) => ({ value: p.id, label: p.name }))} placeholder="كل العقارات" defaultValue={sp.propertyId ?? ""} />
          </FilterBar>
          <Card padded={false}>
            {rows.length === 0 ? (
              <EmptyState title="لا توجد أقساط مطابقة" description="لا توجد أقساط غير مسددة على عقاراتك حاليًا." action={hasFilters ? <Link href="/owner/collections" className="btn btn-outline btn-sm">مسح الفلاتر</Link> : undefined} />
            ) : (
              <>
                <Table>
                  <thead>
                    <tr>
                      <th>العقد</th>
                      <th>العقار / الوحدة</th>
                      <th>المستأجر</th>
                      <th>القسط</th>
                      <th>الاستحقاق</th>
                      <th>المبلغ</th>
                      <th>المتبقي</th>
                      <th>التأخر</th>
                      <th>الحالة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((i) => (
                      <tr key={i.id}>
                        <td className="latin">{i.contract.code}</td>
                        <td>{i.contract.property.name} — {i.contract.unit.number}</td>
                        <td>{i.tenant.name}</td>
                        <td className="num">{i.seq}</td>
                        <td className="num">{date(i.dueDate)}</td>
                        <td className="num">{money(i.amount)}</td>
                        <td className="num font-bold">{money(i.amount - i.paidAmount)}</td>
                        <td className="num">{daysOverdue(i.dueDate) ? `${daysOverdue(i.dueDate)} يوم` : "—"}</td>
                        <td><StatusTag value={i.status} map={INSTALLMENT_STATUS} /></td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
                <Pagination page={page} pageSize={PAGE_SIZE} total={total} base="/owner/collections" params={sp} />
              </>
            )}
          </Card>
      </div>
    </>
  );
}
