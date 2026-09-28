import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { db } from "@/lib/db";
import { date, num, daysFromToday, pageParam } from "@/lib/format";
import { DOCUMENT_TYPES, ENTITY_TYPES } from "@/lib/constants";
import { PageHeader, Card, Table, EmptyState, FilterBar, Select, Input, Pagination, Tag } from "@/components/ui";
import { getOwnerScope, ownedContractIds } from "../_scope";
import { textLike } from "@/lib/search";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 30;

export default async function OwnerDocumentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOwner();
  const scope = await getOwnerScope(user);
  const sp = await searchParams;
  const page = pageParam(sp.page);
  const q = sp.q?.trim();
  const contractIds = await ownedContractIds(scope);
  const unitIds = (await db.unit.findMany({ where: { organizationId: scope.org, propertyId: { in: scope.propertyIds } }, select: { id: true } })).map((u) => u.id);

  const where = {
    organizationId: scope.org,
    visibility: "OWNER",
    OR: [
      { entityType: "OWNER", entityId: scope.ownerId },
      { entityType: "PROPERTY", entityId: { in: scope.propertyIds } },
      { entityType: "CONTRACT", entityId: { in: contractIds } },
      { entityType: "UNIT", entityId: { in: unitIds } },
    ],
    ...(sp.type ? { type: sp.type } : {}),
    ...(q ? { name: textLike(q) } : {}),
  };
  const [total, rows] = await Promise.all([
    db.document.count({ where }),
    db.document.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
  ]);
  const hasFilters = Boolean(sp.type || q);

  return (
    <>
      <PageHeader title="المستندات" subtitle={`${num(total)} مستند شاركه المكتب معك`} />
      <FilterBar base="/owner/documents" hasFilters={hasFilters}>
        <Input name="q" defaultValue={q ?? ""} placeholder="بحث باسم المستند" className="!w-56" />
        <Select name="type" options={DOCUMENT_TYPES} placeholder="كل الأنواع" defaultValue={sp.type ?? ""} />
      </FilterBar>
      <Card padded={false}>
        {rows.length === 0 ? (
          <EmptyState title="لا توجد مستندات" description="تظهر هنا المستندات التي يحدد المكتب إتاحتها للمالك (الصكوك، العقود، الفواتير…)." action={hasFilters ? <Link href="/owner/documents" className="btn btn-outline btn-sm">مسح الفلاتر</Link> : undefined} />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <th>المستند</th>
                  <th>النوع</th>
                  <th>مرتبط بـ</th>
                  <th>تاريخ الإصدار</th>
                  <th>تاريخ الانتهاء</th>
                  <th>الإصدار</th>
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
                      <td className="num">{date(d.issueDate)}</td>
                      <td className="num">
                        {date(d.expiryDate)}
                        {left !== null && left <= 30 && <span className={`mr-1 text-[11px] ${left < 0 ? "text-danger" : "text-warning"}`}>({left < 0 ? "منتهي" : `${left} يوم`})</span>}
                      </td>
                      <td className="num">v{d.version}</td>
                      <td className="num">{date(d.createdAt)}</td>
                      <td>{d.url ? <a className="link" href={d.url} target="_blank">فتح</a> : <span className="text-faint">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} base="/owner/documents" params={sp} />
          </>
        )}
      </Card>
    </>
  );
}
