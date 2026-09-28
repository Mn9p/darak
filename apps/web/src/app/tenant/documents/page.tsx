import Link from "next/link";
import { requireTenant } from "@/lib/auth";
import { db } from "@/lib/db";
import { date, num, daysFromToday, pageParam } from "@/lib/format";
import { DOCUMENT_TYPES, ENTITY_TYPES } from "@/lib/constants";
import { PageHeader, Card, Table, EmptyState, FilterBar, Select, Input, Pagination, Tag } from "@/components/ui";
import { textLike } from "@/lib/search";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 30;

export default async function TenantDocumentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireTenant();
  const sp = await searchParams;
  const page = pageParam(sp.page);
  const q = sp.q?.trim();
  const contractIds = (await db.contract.findMany({ where: { organizationId: user.organizationId, tenantId: user.tenantId }, select: { id: true } })).map((c) => c.id);

  const where = {
    organizationId: user.organizationId,
    visibility: "TENANT",
    OR: [
      { entityType: "TENANT", entityId: user.tenantId },
      { entityType: "CONTRACT", entityId: { in: contractIds } },
    ],
    ...(sp.type ? { type: sp.type } : {}),
    ...(q ? { name: textLike(q) } : {}),
  };
  const [total, rows] = await Promise.all([db.document.count({ where }), db.document.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE })]);
  const hasFilters = Boolean(sp.type || q);

  return (
    <>
      <PageHeader title="المستندات" subtitle={`${num(total)} مستند شاركه المكتب معك`} />
      <FilterBar base="/tenant/documents" hasFilters={hasFilters}>
        <Input name="q" defaultValue={q ?? ""} placeholder="بحث باسم المستند" className="!w-56" />
        <Select name="type" options={DOCUMENT_TYPES} placeholder="كل الأنواع" defaultValue={sp.type ?? ""} />
      </FilterBar>
      <Card padded={false}>
        {rows.length === 0 ? (
          <EmptyState title="لا توجد مستندات" description="تظهر هنا نسخ العقد والإيصالات والمستندات التي يشاركها المكتب معك." action={hasFilters ? <Link href="/tenant/documents" className="btn btn-outline btn-sm">مسح الفلاتر</Link> : <Link href="/tenant/payments?tab=payments" className="btn btn-outline btn-sm">إيصالات الدفع</Link>} />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <th>المستند</th>
                  <th>النوع</th>
                  <th>مرتبط بـ</th>
                  <th>تاريخ الانتهاء</th>
                  <th>أضيف</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => {
                  const left = d.expiryDate ? daysFromToday(d.expiryDate) : null;
                  return (
                    <tr key={d.id}>
                      <td className="font-bold">{d.name}</td>
                      <td><Tag plain>{DOCUMENT_TYPES[d.type] ?? d.type}</Tag></td>
                      <td>{d.entityType ? `${ENTITY_TYPES[d.entityType] ?? d.entityType}${d.entityLabel ? `: ${d.entityLabel}` : ""}` : "—"}</td>
                      <td className="num">
                        {date(d.expiryDate)}
                        {left !== null && left <= 30 && <span className={`mr-1 text-[11px] ${left < 0 ? "text-danger" : "text-warning"}`}>({left < 0 ? "منتهي" : `${left} يوم`})</span>}
                      </td>
                      <td className="num">{date(d.createdAt)}</td>
                      <td>{d.url ? <a className="link" href={d.url} target="_blank">فتح</a> : <span className="text-faint">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} base="/tenant/documents" params={sp} />
          </>
        )}
      </Card>
    </>
  );
}
