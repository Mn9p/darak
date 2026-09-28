import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, propertyScope } from "@/lib/permissions";
import { PROPERTY_TYPES, PROPERTY_STATUS, CITIES } from "@/lib/constants";
import { money, pct, pageParam } from "@/lib/format";
import { PageHeader, Card, Table, StatusTag, EmptyState, Pagination, Select, StatGrid, StatCard, Progress, DataToolbar } from "@/components/ui";
import { GuideCard } from "@/components/GuideCard";
import { MoreMenu } from "@/components/MoreMenu";
import { MoreFilters } from "@/components/MoreFilters";
import { textLike } from "@/lib/search";

export const dynamic = "force-dynamic";
const PAGE = 20;

export default async function PropertiesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireStaff();
  const sp = await searchParams;
  const org = user.organizationId;
  const page = pageParam(sp.page);
  const q = sp.q?.trim();
  const where = {
    organizationId: org,
    ...propertyScope(user),
    ...(sp.status ? { status: sp.status } : { status: { not: "ARCHIVED" } }),
    ...(sp.type ? { type: sp.type } : {}),
    ...(sp.city ? { city: sp.city } : {}),
    ...(sp.ownerId ? { ownerships: { some: { ownerId: sp.ownerId, endDate: null } } } : {}),
    ...(q ? { OR: [{ name: textLike(q) }, { code: textLike(q) }, { district: textLike(q) }, { deedNumber: textLike(q) }] } : {}),
  };

  const [total, rows, owners, allUnits] = await Promise.all([
    db.property.count({ where }),
    db.property.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE,
      take: PAGE,
      include: {
        manager: { select: { name: true } },
        ownerships: { where: { endDate: null }, include: { owner: { select: { id: true, name: true } } } },
        units: { select: { status: true, currentRent: true } },
      },
    }),
    db.owner.findMany({ where: { organizationId: org, status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.unit.groupBy({ by: ["status"], where: { organizationId: org, property: { ...propertyScope(user) }, status: { not: "ARCHIVED" } }, _count: true }),
  ]);

  const totalUnits = allUnits.reduce((s, u) => s + u._count, 0);
  const rentedUnits = allUnits.filter((u) => u.status === "RENTED").reduce((s, u) => s + u._count, 0);
  const occupancy = totalUnits ? (rentedUnits / totalUnits) * 100 : 0;
  const hasFilters = Boolean(sp.q || sp.status || sp.type || sp.city || sp.ownerId);

  const chips = [
    { key: "type", label: `النوع: ${PROPERTY_TYPES[sp.type ?? ""] ?? sp.type}` },
    { key: "status", label: `الحالة: ${PROPERTY_STATUS[sp.status ?? ""]?.label ?? sp.status}` },
    { key: "city", label: `المدينة: ${sp.city}` },
    { key: "ownerId", label: `المالك: ${owners.find((o) => o.id === sp.ownerId)?.name ?? ""}` },
  ];

  return (
    <>
      <PageHeader
        title="العقارات"
        actions={
          <>
            {can(user, "properties.manage") && (
              <Link href="/properties/new" className="btn btn-primary btn-sm">
                إضافة عقار
              </Link>
            )}
            <MoreMenu items={[can(user, "import.manage") && { label: "استيراد من Excel", href: "/import?type=PROPERTIES" }]} />
          </>
        }
      />

      <GuideCard
        id="properties"
        show={total === 0 && !hasFilters}
        title="هنا تبدأ إدارة المكتب: كل عقار وما فيه من وحدات وعقود"
        steps={[
          "سجّل المالك أولًا من صفحة الملاك حتى تربطه بالعقار.",
          "أضف العقار ببياناته الأساسية: الاسم، المدينة، الحي، ورقم الصك.",
          "افتح العقار وأضف وحداته؛ منها تُنشأ العقود ويبدأ التحصيل.",
        ]}
        note="صفحة العقار هي مساحة العمل: وحداته وعقوده ومطالباته في مكان واحد."
        cta={owners.length ? { href: "/properties/new", label: "إضافة عقار" } : { href: "/owners/new", label: "ابدأ بإضافة مالك" }}
        secondary={{ href: "/import?type=PROPERTIES", label: "استيراد من Excel" }}
      />

      <StatGrid cols={4}>
        <StatCard label="العقارات" value={money(total)} />
        <StatCard label="الوحدات" value={money(totalUnits)} />
        <StatCard label="الوحدات المؤجرة" value={money(rentedUnits)} tone="success" />
        <StatCard label="نسبة الإشغال" value={totalUnits ? pct(occupancy) : "—"} sub={totalUnits ? <Progress value={occupancy} /> : "لا توجد وحدات مسجلة"} />
      </StatGrid>

      <Card className="mt-4" padded={false}>
        <div className="px-4 pt-4">
          <DataToolbar base="/properties" q={sp.q ?? ""} placeholder="بحث بالاسم أو الرقم أو الحي" params={sp} count={total} chips={chips}>
            <Select name="type" options={PROPERTY_TYPES} placeholder="كل الأنواع" defaultValue={sp.type ?? ""} className="!w-44" />
            <Select name="status" options={PROPERTY_STATUS} placeholder="الحالة" defaultValue={sp.status ?? ""} className="!w-40" />
            <MoreFilters open={Boolean(sp.city || sp.ownerId)}>
              <Select name="city" options={CITIES.map((c) => ({ value: c, label: c }))} placeholder="كل المدن" defaultValue={sp.city ?? ""} className="!w-36" />
              <Select name="ownerId" options={owners.map((o) => ({ value: o.id, label: o.name }))} placeholder="كل الملاك" defaultValue={sp.ownerId ?? ""} className="!w-48" />
            </MoreFilters>
          </DataToolbar>
        </div>
        {rows.length === 0 ? (
          <EmptyState
            title={hasFilters ? "لا توجد نتائج مطابقة" : "لا توجد عقارات حتى الآن"}
            description={hasFilters ? "جرّب تعديل الفلاتر." : "أضف أول عقار لبدء العمل."}
            action={!hasFilters && can(user, "properties.manage") ? <Link href="/properties/new" className="btn btn-primary">إضافة عقار</Link> : undefined}
          />
        ) : (
          <Table density="compact">
            <thead>
              <tr>
                <th>العقار</th>
                <th>النوع</th>
                <th>المالك</th>
                <th>الموقع</th>
                <th className="num">الوحدات</th>
                <th className="num">الإيجار السنوي</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const u = p.units.filter((x) => x.status !== "ARCHIVED");
                const rented = u.filter((x) => x.status === "RENTED").length;
                const occ = u.length ? (rented / u.length) * 100 : 0;
                const rent = u.reduce((s, x) => s + (x.currentRent ?? 0), 0);
                return (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/properties/${p.id}`} className="cell-primary hover:text-brand">
                        {p.name}
                      </Link>
                      <div className="cell-sub latin">{p.code}</div>
                    </td>
                    <td>
                      {PROPERTY_TYPES[p.type] ?? p.type}
                      {p.manager && <div className="cell-sub">{p.manager.name}</div>}
                    </td>
                    <td>
                      {p.ownerships.map((o) => (
                        <div key={o.id} className="text-[13px]">
                          <Link href={`/owners/${o.owner.id}`} className="hover:text-brand">
                            {o.owner.name}
                          </Link>
                          {p.ownerships.length > 1 && <span className="num text-muted"> {o.percentage}%</span>}
                        </div>
                      ))}
                    </td>
                    <td>
                      {p.city ?? "—"}
                      {p.district && <div className="cell-sub">{p.district}</div>}
                    </td>
                    <td className="num">
                      {rented}/{u.length}
                      <div className="mt-1 flex items-center gap-2">
                        <div className="w-14">
                          <Progress value={occ} tone={occ < 60 ? "danger" : occ < 85 ? "warn" : undefined} />
                        </div>
                        <span className="cell-sub num">{Math.round(occ)}%</span>
                      </div>
                    </td>
                    <td className="num font-semibold">{money(rent)}</td>
                    <td>
                      <StatusTag value={p.status} map={PROPERTY_STATUS} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <Pagination page={page} pageSize={PAGE} total={total} base="/properties" params={sp} />
      </Card>
    </>
  );
}
