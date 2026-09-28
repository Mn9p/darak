import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, date, relative, num, pageParam } from "@/lib/format";
import { CONTRACT_STATUS, PAYMENT_FREQUENCY } from "@/lib/constants";
import { PageHeader, Card, Table, StatusTag, EmptyState, FilterBar, Select, Input, Pagination, StatGrid, StatCard } from "@/components/ui";
import { getOwnerScope } from "../_scope";
import { textLike } from "@/lib/search";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 25;

export default async function OwnerContractsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOwner();
  const scope = await getOwnerScope(user);
  const sp = await searchParams;
  const page = pageParam(sp.page);
  const q = sp.q?.trim();

  const where = {
    organizationId: scope.org,
    // A propertyId filter never widens the scope: unknown ids fall back to all owned properties.
    propertyId: { in: sp.propertyId && scope.propertyIds.includes(sp.propertyId) ? [sp.propertyId] : scope.propertyIds },
    ...(sp.status ? { status: sp.status } : {}),
    ...(q ? { OR: [{ code: textLike(q) }, { tenant: { name: textLike(q) } }, { unit: { number: textLike(q) } }] } : {}),
  };

  const [total, rows, active, expiring] = await Promise.all([
    db.contract.count({ where }),
    db.contract.findMany({ where, orderBy: { endDate: "asc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { tenant: { select: { name: true } }, unit: { select: { number: true } }, property: { select: { name: true } } } }),
    db.contract.count({ where: { organizationId: scope.org, propertyId: { in: scope.propertyIds }, status: { in: ["ACTIVE", "EXPIRING_SOON", "RENEWAL_PENDING"] } } }),
    db.contract.count({ where: { organizationId: scope.org, propertyId: { in: scope.propertyIds }, status: { in: ["EXPIRING_SOON", "RENEWAL_PENDING"] } } }),
  ]);
  const annual = await db.contract.aggregate({ where: { organizationId: scope.org, propertyId: { in: scope.propertyIds }, status: { in: ["ACTIVE", "EXPIRING_SOON", "RENEWAL_PENDING"] } }, _sum: { totalAmount: true } });
  const hasFilters = Boolean(sp.status || sp.propertyId || q);

  return (
    <>
      <PageHeader title="العقود" subtitle="جميع العقود على عقاراتك" />
      <StatGrid cols={3}>
        <StatCard label="عقود نشطة" value={num(active)} tone="success" />
        <StatCard label="قريبة الانتهاء / تجديد معلق" value={num(expiring)} tone={expiring > 0 ? "warning" : undefined} />
        <StatCard label="القيمة السنوية للعقود النشطة" value={money(annual._sum.totalAmount ?? 0)} />
      </StatGrid>
      <div className="mt-4">
        <FilterBar base="/owner/contracts" hasFilters={hasFilters}>
          <Input name="q" defaultValue={q ?? ""} placeholder="بحث: رقم العقد، المستأجر، الوحدة" className="!w-56" />
          <Select name="status" options={CONTRACT_STATUS} placeholder="كل الحالات" defaultValue={sp.status ?? ""} />
          <Select name="propertyId" options={scope.properties.map((p) => ({ value: p.id, label: p.name }))} placeholder="كل العقارات" defaultValue={sp.propertyId ?? ""} />
        </FilterBar>
      </div>
      <Card padded={false}>
        {rows.length === 0 ? (
          <EmptyState title="لا توجد عقود مطابقة" description={hasFilters ? "جرّب تعديل الفلاتر." : "لا توجد عقود على عقاراتك بعد."} action={hasFilters ? <Link href="/owner/contracts" className="btn btn-outline btn-sm">مسح الفلاتر</Link> : undefined} />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <th>العقد</th>
                  <th>العقار / الوحدة</th>
                  <th>المستأجر</th>
                  <th>من</th>
                  <th>إلى</th>
                  <th>القيمة السنوية</th>
                  <th>الدفع</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td className="latin">{c.code}</td>
                    <td>
                      <Link href={`/owner/properties/${c.propertyId}?tab=contracts`} className="link">{c.property.name}</Link>
                      <span className="text-muted"> — {c.unit.number}</span>
                    </td>
                    <td>{c.tenant.name}</td>
                    <td className="num">{date(c.startDate)}</td>
                    <td className="num">
                      {date(c.endDate)} <span className="text-[11px] text-muted">({relative(c.endDate)})</span>
                    </td>
                    <td className="num">{money(c.totalAmount)}</td>
                    <td>{PAYMENT_FREQUENCY[c.paymentFrequency] ?? c.paymentFrequency}</td>
                    <td><StatusTag value={c.status} map={CONTRACT_STATUS} /></td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} base="/owner/contracts" params={sp} />
          </>
        )}
      </Card>
    </>
  );
}
