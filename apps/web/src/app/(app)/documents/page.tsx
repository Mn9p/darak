import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, isScoped } from "@/lib/permissions";
import { DOCUMENT_TYPES, DOCUMENT_VISIBILITY, ENTITY_TYPES, ENTITY_ROUTES } from "@/lib/constants";
import { date, daysFromToday, money, addDays, tagsToArray, pageParam } from "@/lib/format";
import { PageHeader, Card, Table, EmptyState, Pagination, FilterBar, Input, Select, StatGrid, StatCard, Tag } from "@/components/ui";
import { GuideCard } from "@/components/GuideCard";
import { MoreFilters } from "@/components/MoreFilters";
import { textLike } from "@/lib/search";

export const dynamic = "force-dynamic";
const PAGE = 25;

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireStaff();
  if (!can(user, "documents.view")) redirect("/forbidden");
  const sp = await searchParams;
  const org = user.organizationId;
  const page = pageParam(sp.page);
  const q = sp.q?.trim();
  const now = new Date();
  const expiring = [30, 60, 90].includes(Number(sp.expiring)) ? Number(sp.expiring) : null;

  // Property-scoped roles: only documents on their properties / units, plus unlinked docs they uploaded.
  let scopeWhere = {};
  if (isScoped(user)) {
    const unitIds = (await db.unit.findMany({ where: { propertyId: { in: user.assignedPropertyIds } }, select: { id: true } })).map((u) => u.id);
    scopeWhere = { OR: [{ entityType: "PROPERTY", entityId: { in: user.assignedPropertyIds } }, { entityType: "UNIT", entityId: { in: unitIds } }, { uploadedById: user.id }] };
  }

  const where = {
    organizationId: org,
    ...scopeWhere,
    ...(sp.type ? { type: sp.type } : {}),
    ...(sp.entityType ? { entityType: sp.entityType } : {}),
    ...(sp.visibility ? { visibility: sp.visibility } : {}),
    ...(sp.expired === "1" ? { expiryDate: { lt: now } } : expiring ? { expiryDate: { gte: now, lte: addDays(now, expiring) } } : {}),
    ...(sp.archived === "1" ? { name: { startsWith: "[مؤرشف]" } } : { NOT: { name: { startsWith: "[مؤرشف]" } } }),
    ...(q ? { AND: [{ OR: [{ name: textLike(q) }, { entityLabel: textLike(q) }, { tags: textLike(q) }] }] } : {}),
  };
  const live = { organizationId: org, ...scopeWhere, NOT: { name: { startsWith: "[مؤرشف]" } } };

  const [total, rows, allCount, exp30, exp90, expiredCount] = await Promise.all([
    db.document.count({ where }),
    db.document.findMany({ where, orderBy: [{ expiryDate: "asc" }, { createdAt: "desc" }], skip: (page - 1) * PAGE, take: PAGE, include: { uploadedBy: { select: { name: true } } } }),
    db.document.count({ where: live }),
    db.document.count({ where: { ...live, expiryDate: { gte: now, lte: addDays(now, 30) } } }),
    db.document.count({ where: { ...live, expiryDate: { gte: now, lte: addDays(now, 90) } } }),
    db.document.count({ where: { ...live, expiryDate: { lt: now } } }),
  ]);
  const hasFilters = Boolean(sp.q || sp.type || sp.entityType || sp.visibility || sp.expiring || sp.expired || sp.archived);
  const manage = can(user, "documents.manage");

  return (
    <>
      <PageHeader
        title="المستندات"
        actions={
          manage ? (
            <Link href="/documents/new" className="btn btn-primary btn-sm">
              رفع مستند
            </Link>
          ) : undefined
        }
      />

      <GuideCard
        id="documents"
        show={allCount === 0}
        title="المستندات: الصكوك والعقود والهويات في مكان واحد"
        steps={[
          "ارفع المستند واربطه بعقار أو وحدة أو مالك أو مستأجر أو عقد.",
          "حدد تاريخ الانتهاء إن وُجد؛ يُنبّهك النظام قبل انتهائه.",
          "اختر من يراه: المكتب فقط، أو المالك، أو المستأجر.",
        ]}
        cta={{ href: "/documents/new", label: "رفع مستند" }}
      />

      <StatGrid cols={4}>
        <StatCard label="المستندات" value={money(allCount)} href="/documents" />
        <StatCard label="تنتهي خلال 30 يوم" value={money(exp30)} tone={exp30 ? "warning" : undefined} href="/documents?expiring=30" />
        <StatCard label="تنتهي خلال 90 يوم" value={money(exp90)} href="/documents?expiring=90" />
        <StatCard label="منتهية" value={money(expiredCount)} tone={expiredCount ? "danger" : undefined} href="/documents?expired=1" />
      </StatGrid>

      <Card className="mt-4" padded={false}>
        <div className="px-4 pt-4">
          <FilterBar base="/documents" hasFilters={hasFilters}>
            <Input name="q" placeholder="بحث بالاسم أو الكيان أو الوسم" defaultValue={sp.q ?? ""} className="!w-56" />
            <Select name="type" options={DOCUMENT_TYPES} placeholder="كل الأنواع" defaultValue={sp.type ?? ""} className="!w-36" />
            <Select name="expiring" options={[{ value: "30", label: "تنتهي خلال 30 يوم" }, { value: "60", label: "تنتهي خلال 60 يوم" }, { value: "90", label: "تنتهي خلال 90 يوم" }]} placeholder="الانتهاء" defaultValue={sp.expiring ?? ""} className="!w-40" />
            <MoreFilters open={Boolean(sp.entityType || sp.visibility || sp.expired || sp.archived)}>
              <Select name="entityType" options={Object.fromEntries(Object.keys(ENTITY_ROUTES).map((k) => [k, ENTITY_TYPES[k] ?? k]))} placeholder="كل الكيانات" defaultValue={sp.entityType ?? ""} className="!w-36" />
              <Select name="visibility" options={DOCUMENT_VISIBILITY} placeholder="كل مستويات الظهور" defaultValue={sp.visibility ?? ""} className="!w-40" />
              <Select name="expired" options={{ "1": "المنتهية فقط" }} placeholder="المنتهية وغير المنتهية" defaultValue={sp.expired ?? ""} className="!w-40" />
              <Select name="archived" options={{ "1": "المؤرشفة" }} placeholder="غير المؤرشفة" defaultValue={sp.archived ?? ""} className="!w-32" />
            </MoreFilters>
          </FilterBar>
        </div>
        {rows.length === 0 ? (
          <EmptyState
            title={hasFilters ? "لا توجد مستندات مطابقة" : "لا توجد مستندات حتى الآن"}
            description={hasFilters ? "جرّب تعديل الفلاتر." : "ارفع الصكوك والعقود والهويات لمتابعة تواريخ انتهائها."}
            action={!hasFilters && manage ? <Link href="/documents/new" className="btn btn-primary">رفع مستند</Link> : undefined}
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>المستند</th>
                <th>النوع</th>
                <th>الكيان المرتبط</th>
                <th>الإصدار</th>
                <th>الانتهاء</th>
                <th className="num">النسخة</th>
                <th>رفعه</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => {
                const left = d.expiryDate ? daysFromToday(d.expiryDate) : null;
                const route = d.entityType ? ENTITY_ROUTES[d.entityType] : null;
                const tags = tagsToArray(d.tags).filter((t) => !t.startsWith("ملف:") && t !== "archived");
                return (
                  <tr key={d.id}>
                    <td>
                      <Link href={`/documents/${d.id}`} className="cell-primary hover:text-brand">
                        {d.name}
                      </Link>
                      {tags.length > 0 && (
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {tags.slice(0, 3).map((t) => (
                            <Tag key={t} tone="neutral" plain className="!text-[10px]">
                              {t}
                            </Tag>
                          ))}
                        </div>
                      )}
                    </td>
                    <td>
                      {DOCUMENT_TYPES[d.type] ?? d.type}
                      <div className="cell-sub">{DOCUMENT_VISIBILITY[d.visibility] ?? d.visibility}</div>
                    </td>
                    <td>
                      {d.entityType ? (
                        <>
                          {route && d.entityId ? (
                            <Link href={`${route}/${d.entityId}`} className="link text-[13px]">
                              {d.entityLabel ?? d.entityId}
                            </Link>
                          ) : (
                            <span className="text-[13px]">{d.entityLabel ?? "—"}</span>
                          )}
                          <div className="cell-sub">{ENTITY_TYPES[d.entityType] ?? d.entityType}</div>
                        </>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                    <td>{date(d.issueDate)}</td>
                    <td>
                      {d.expiryDate ? (
                        <span className={left !== null && left < 0 ? "font-semibold text-danger" : left !== null && left <= 30 ? "font-semibold text-warning" : left !== null && left <= 90 ? "text-info" : ""}>
                          {date(d.expiryDate)}
                          <div className="cell-sub">{left !== null && (left < 0 ? `منتهي منذ ${-left} يوم` : left === 0 ? "ينتهي اليوم" : `بعد ${left} يوم`)}</div>
                        </span>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                    <td className="num">v{d.version}</td>
                    <td className="text-muted">
                      {d.uploadedBy?.name ?? "—"}
                      <div className="cell-sub">{date(d.createdAt)}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <Pagination page={page} pageSize={PAGE} total={total} base="/documents" params={sp} />
      </Card>
    </>
  );
}
