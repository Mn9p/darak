import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, isScoped } from "@/lib/permissions";
import { PARTY_TYPES, OWNER_STATUS } from "@/lib/constants";
import { money, num, pct, pageParam } from "@/lib/format";
import { PageHeader, Card, Table, StatusTag, EmptyState, Pagination, FilterBar, Input, Select, StatGrid, StatCard, Avatar } from "@/components/ui";
import { GuideCard } from "@/components/GuideCard";
import { MoreMenu } from "@/components/MoreMenu";
import { MoreFilters } from "@/components/MoreFilters";
import { displayPhone } from "@/lib/phone";
import { textLike, phoneLike } from "@/lib/search";

export const dynamic = "force-dynamic";
const PAGE = 20;

export default async function OwnersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireStaff();
  const sp = await searchParams;
  const org = user.organizationId;
  const page = pageParam(sp.page);
  const q = sp.q?.trim();

  // Scoped roles only see owners of their assigned properties.
  const scope = isScoped(user) ? { ownerships: { some: { propertyId: { in: user.assignedPropertyIds } } } } : {};
  const where = {
    organizationId: org,
    ...scope,
    ...(sp.status ? { status: sp.status } : { status: { not: "ARCHIVED" } }),
    ...(sp.type ? { type: sp.type } : {}),
    ...(sp.accountManagerId ? { accountManagerId: sp.accountManagerId } : {}),
    ...(q ? { OR: [{ name: textLike(q) }, { code: textLike(q) }, { phone: phoneLike(q) }, { email: textLike(q) }, { nationalId: textLike(q) }, { crNumber: textLike(q) }] } : {}),
  };

  const [total, rows, managers, activeCount, pendingStatements] = await Promise.all([
    db.owner.count({ where }),
    db.owner.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (page - 1) * PAGE,
      take: PAGE,
      include: {
        accountManager: { select: { id: true, name: true } },
        ownerships: { where: { endDate: null }, select: { percentage: true, property: { select: { id: true, status: true, units: { select: { status: true, currentRent: true } } } } } },
      },
    }),
    db.user.findMany({ where: { organizationId: org, status: "ACTIVE", accountOwners: { some: {} } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.owner.count({ where: { organizationId: org, ...scope, status: "ACTIVE" } }),
    can(user, "owners.financial") ? db.ownerStatement.aggregate({ where: { organizationId: org, status: { in: ["UNDER_REVIEW", "APPROVED"] } }, _sum: { netDue: true }, _count: true }) : Promise.resolve(null),
  ]);

  const ownedProps = await db.propertyOwnership.findMany({ where: { endDate: null, owner: { organizationId: org, ...scope, status: { not: "ARCHIVED" } } }, select: { propertyId: true }, distinct: ["propertyId"] });
  const hasFilters = Boolean(sp.q || sp.status || sp.type || sp.accountManagerId);

  return (
    <>
      <PageHeader
        title="الملاك"
        actions={
          <>
            {can(user, "owners.manage") && (
              <Link href="/owners/new" className="btn btn-primary btn-sm">
                إضافة مالك
              </Link>
            )}
            <MoreMenu items={[can(user, "import.manage") && { label: "استيراد من Excel", href: "/import?type=OWNERS" }]} />
          </>
        }
      />

      <GuideCard
        id="owners"
        show={total === 0 && !hasFilters}
        title="الملاك هم من تدير أملاكهم وتُحاسبهم في نهاية كل فترة"
        steps={[
          "أضف المالك ببياناته ورقم جواله وحسابه البنكي.",
          "اربطه بعقاراته مع نسبة الملكية ونسبة إدارة المكتب.",
          "بعدها تُبنى كشوف الحساب وصافي المستحق له تلقائيًا من التحصيل والمصروفات.",
        ]}
        note="يمكن منح المالك دخولًا لبوابة خاصة يرى فيها عقاراته وكشوف حسابه."
        cta={{ href: "/owners/new", label: "إضافة مالك" }}
        secondary={{ href: "/import?type=OWNERS", label: "استيراد من Excel" }}
      />

      <StatGrid cols={4}>
        <StatCard label="الملاك" value={num(total)} />
        <StatCard label="ملاك نشطون" value={num(activeCount)} tone="success" />
        <StatCard label="عقارات مملوكة" value={num(ownedProps.length)} href="/properties" />
        {pendingStatements ? (
          <StatCard label="مستحقات قيد الاعتماد" value={money(pendingStatements._sum.netDue ?? 0)} sub={`${pendingStatements._count} تسوية`} href="/statements?status=UNDER_REVIEW" />
        ) : (
          <StatCard label="كشوف الحساب" value="—" sub="تتطلب صلاحية مالية" />
        )}
      </StatGrid>

      <Card className="mt-4" padded={false}>
        <div className="px-4 pt-4">
          <FilterBar base="/owners" hasFilters={hasFilters}>
            <Input name="q" placeholder="بحث بالاسم أو الجوال أو الهوية" defaultValue={sp.q ?? ""} className="!w-56" />
            <Select name="type" options={PARTY_TYPES} placeholder="كل الأنواع" defaultValue={sp.type ?? ""} className="!w-36" />
            <Select name="status" options={OWNER_STATUS} placeholder="الحالة" defaultValue={sp.status ?? ""} className="!w-40" />
            <MoreFilters open={Boolean(sp.accountManagerId)}>
              <Select name="accountManagerId" options={managers.map((m) => ({ value: m.id, label: m.name }))} placeholder="كل مديري الحسابات" defaultValue={sp.accountManagerId ?? ""} className="!w-48" />
            </MoreFilters>
          </FilterBar>
        </div>
        {rows.length === 0 ? (
          <EmptyState
            title={hasFilters ? "لا توجد نتائج مطابقة" : "لا يوجد ملاك حتى الآن"}
            description={hasFilters ? "جرّب تعديل الفلاتر." : "أضف أول مالك ثم اربطه بعقاراته."}
            action={!hasFilters && can(user, "owners.manage") ? <Link href="/owners/new" className="btn btn-primary">إضافة مالك</Link> : undefined}
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>المالك</th>
                <th>النوع</th>
                <th>الجوال</th>
                <th className="num">العقارات</th>
                <th className="num">الإيجار السنوي (حصته)</th>
                <th className="num">أتعاب الإدارة</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => {
                const props = o.ownerships.filter((x) => x.property.status !== "ARCHIVED");
                const propIds = new Set(props.map((x) => x.property.id));
                const units = props.reduce((s, x) => s + x.property.units.filter((u) => u.status !== "ARCHIVED").length, 0);
                const rented = props.reduce((s, x) => s + x.property.units.filter((u) => u.status === "RENTED").length, 0);
                const rent = props.reduce((s, x) => s + (x.property.units.reduce((a, u) => a + (u.currentRent ?? 0), 0) * x.percentage) / 100, 0);
                return (
                  <tr key={o.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        <Avatar name={o.name} sm sand={o.type === "COMPANY"} />
                        <div className="min-w-0">
                          <Link href={`/owners/${o.id}`} className="cell-primary hover:text-brand">
                            {o.name}
                          </Link>
                          <div className="cell-sub latin">{o.code}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      {PARTY_TYPES[o.type] ?? o.type}
                      {o.accountManager && <div className="cell-sub">{o.accountManager.name}</div>}
                    </td>
                    <td className="num">{o.phone ? displayPhone(o.phone) : "—"}</td>
                    <td className="num">
                      {propIds.size}
                      <div className="cell-sub num">
                        {rented}/{units} وحدة
                      </div>
                    </td>
                    <td className="num font-semibold">{money(rent)}</td>
                    <td className="num">{pct(o.managementFeePct, 1)}</td>
                    <td>
                      <StatusTag value={o.status} map={OWNER_STATUS} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <Pagination page={page} pageSize={PAGE} total={total} base="/owners" params={sp} />
      </Card>
    </>
  );
}
