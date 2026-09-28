import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, propertyIdScope, propertyScope } from "@/lib/permissions";
import { UNIT_TYPES, UNIT_STATUS, UNIT_USAGE } from "@/lib/constants";
import { money, num, pct, pageParam } from "@/lib/format";
import { PageHeader, Card, Table, StatusTag, EmptyState, Pagination, FilterBar, Input, Select, StatGrid, StatCard, Progress } from "@/components/ui";
import { GuideCard } from "@/components/GuideCard";
import { MoreMenu } from "@/components/MoreMenu";
import { MoreFilters } from "@/components/MoreFilters";
import { textLike } from "@/lib/search";

export const dynamic = "force-dynamic";
const PAGE = 25;
const ACTIVE_CONTRACT = ["ACTIVE", "EXPIRING_SOON", "RENEWAL_PENDING"];

export default async function UnitsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireStaff();
  const sp = await searchParams;
  const org = user.organizationId;
  const page = pageParam(sp.page);
  const q = sp.q?.trim();

  const where = {
    organizationId: org,
    AND: [propertyIdScope(user), sp.propertyId ? { propertyId: sp.propertyId } : {}],
    ...(sp.status ? { status: sp.status } : { status: { not: "ARCHIVED" } }),
    ...(sp.type ? { type: sp.type } : {}),
    ...(sp.usage ? { usage: sp.usage } : {}),
    ...(q
      ? {
          OR: [
            { number: textLike(q) },
            { code: textLike(q) },
            { property: { name: textLike(q) } },
            { contracts: { some: { status: { in: ACTIVE_CONTRACT }, tenant: { name: textLike(q) } } } },
          ],
        }
      : {}),
  };

  const [total, rows, properties, byStatus] = await Promise.all([
    db.unit.count({ where }),
    db.unit.findMany({
      where,
      orderBy: [{ property: { name: "asc" } }, { number: "asc" }],
      skip: (page - 1) * PAGE,
      take: PAGE,
      include: {
        property: { select: { id: true, name: true } },
        contracts: { where: { status: { in: ACTIVE_CONTRACT } }, take: 1, orderBy: { endDate: "desc" }, include: { tenant: { select: { id: true, name: true } } } },
      },
    }),
    db.property.findMany({ where: { organizationId: org, ...propertyScope(user), status: { not: "ARCHIVED" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.unit.groupBy({ by: ["status"], where: { organizationId: org, ...propertyIdScope(user), status: { not: "ARCHIVED" } }, _count: true }),
  ]);

  const count = (s: string[]) => byStatus.filter((x) => s.includes(x.status)).reduce((a, b) => a + b._count, 0);
  const totalUnits = byStatus.reduce((a, b) => a + b._count, 0);
  const rented = count(["RENTED"]);
  const vacant = count(["VACANT", "AVAILABLE"]);
  const occupancy = totalUnits ? (rented / totalUnits) * 100 : 0;
  const hasFilters = Boolean(sp.q || sp.propertyId || sp.status || sp.type || sp.usage);

  return (
    <>
      <PageHeader
        title="الوحدات"
        actions={
          <>
            {can(user, "units.manage") && (
              <Link href={sp.propertyId ? `/units/new?propertyId=${sp.propertyId}` : "/units/new"} className="btn btn-primary btn-sm">
                إضافة وحدة
              </Link>
            )}
            <MoreMenu items={[can(user, "import.manage") && { label: "استيراد من Excel", href: "/import?type=UNITS" }]} />
          </>
        }
      />

      <GuideCard
        id="units"
        show={total === 0 && !hasFilters}
        title="الوحدات هي ما يُؤجَّر فعليًا: شقة، محل، مكتب"
        steps={[
          "اختر العقار الذي تتبع له الوحدة.",
          "أدخل رقم الوحدة ونوعها والإيجار المستهدف.",
          "حالة الوحدة (شاغرة أو مؤجرة) تتغير تلقائيًا مع العقود، لا تُعدّل يدويًا.",
        ]}
        note="يمكنك إضافة عدة وحدات دفعة واحدة من داخل صفحة العقار."
        cta={properties.length ? { href: "/units/new", label: "إضافة وحدة" } : { href: "/properties/new", label: "ابدأ بإضافة عقار" }}
        secondary={{ href: "/import?type=UNITS", label: "استيراد من Excel" }}
      />

      <StatGrid cols={4}>
        <StatCard label="الوحدات" value={num(totalUnits)} href="/units" />
        <StatCard label="مؤجرة" value={num(rented)} tone="success" href="/units?status=RENTED" />
        <StatCard label="شاغرة" value={num(vacant)} tone={vacant > 0 ? "warning" : undefined} href="/units?status=VACANT" />
        <StatCard label="نسبة الإشغال" value={totalUnits ? pct(occupancy) : "—"} sub={totalUnits ? <Progress value={occupancy} /> : "لا توجد وحدات مسجلة"} />
      </StatGrid>

      <Card className="mt-4" padded={false}>
        <div className="px-4 pt-4">
          <FilterBar base="/units" hasFilters={hasFilters}>
            <Input name="q" placeholder="بحث برقم الوحدة أو العقار أو المستأجر" defaultValue={sp.q ?? ""} className="!w-56" />
            <Select name="propertyId" options={properties.map((p) => ({ value: p.id, label: p.name }))} placeholder="كل العقارات" defaultValue={sp.propertyId ?? ""} className="!w-48" />
            <Select name="status" options={UNIT_STATUS} placeholder="الحالة" defaultValue={sp.status ?? ""} className="!w-40" />
            <MoreFilters open={Boolean(sp.type || sp.usage)}>
              <Select name="type" options={UNIT_TYPES} placeholder="كل الأنواع" defaultValue={sp.type ?? ""} className="!w-36" />
              <Select name="usage" options={UNIT_USAGE} placeholder="كل الاستخدامات" defaultValue={sp.usage ?? ""} className="!w-36" />
            </MoreFilters>
          </FilterBar>
        </div>
        {rows.length === 0 ? (
          <EmptyState
            title={hasFilters ? "لا توجد نتائج مطابقة" : "لا توجد وحدات حتى الآن"}
            description={hasFilters ? "جرّب تعديل الفلاتر." : "أضف وحدات عقاراتك لبدء التأجير."}
            action={!hasFilters && can(user, "units.manage") ? <Link href="/units/new" className="btn btn-primary">إضافة وحدة</Link> : undefined}
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>الوحدة</th>
                <th>العقار</th>
                <th>النوع</th>
                <th className="num">المساحة</th>
                <th className="num">الإيجار الحالي</th>
                <th>المستأجر الحالي</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => {
                const c = u.contracts[0];
                return (
                  <tr key={u.id}>
                    <td>
                      <Link href={`/units/${u.id}`} className="cell-primary latin hover:text-brand">
                        {u.number}
                      </Link>
                      <div className="cell-sub latin">{u.code}</div>
                    </td>
                    <td>
                      <Link href={`/properties/${u.property.id}`} className="hover:text-brand">
                        {u.property.name}
                      </Link>
                      {u.floor != null && (
                        <div className="cell-sub">
                          الدور <span className="num">{u.floor}</span>
                        </div>
                      )}
                    </td>
                    <td>
                      {UNIT_TYPES[u.type] ?? u.type}
                      <div className="cell-sub">{UNIT_USAGE[u.usage] ?? u.usage}</div>
                    </td>
                    <td className="num">{u.area ? `${num(u.area)} م²` : "—"}</td>
                    <td className="num font-semibold">
                      {money(u.currentRent)}
                      {u.targetRent != null && u.targetRent !== u.currentRent && <div className="cell-sub num">المستهدف {money(u.targetRent)}</div>}
                    </td>
                    <td>
                      {c ? (
                        <>
                          <Link href={`/tenants/${c.tenant.id}`} className="hover:text-brand">
                            {c.tenant.name}
                          </Link>
                          <div className="cell-sub latin">
                            <Link href={`/contracts/${c.id}`} className="hover:text-brand">
                              {c.code}
                            </Link>
                          </div>
                        </>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                    <td>
                      <StatusTag value={u.status} map={UNIT_STATUS} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <Pagination page={page} pageSize={PAGE} total={total} base="/units" params={sp} />
      </Card>
    </>
  );
}
