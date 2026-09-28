import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, contractScope, isScoped } from "@/lib/permissions";
import { PARTY_TYPES, OWNER_STATUS, RISK_LEVELS } from "@/lib/constants";
import { money, num, pageParam } from "@/lib/format";
import { PageHeader, Card, Table, StatusTag, EmptyState, Pagination, FilterBar, Input, Select, StatGrid, StatCard, Avatar } from "@/components/ui";
import { GuideCard } from "@/components/GuideCard";
import { MoreMenu } from "@/components/MoreMenu";
import { MoreFilters } from "@/components/MoreFilters";
import { displayPhone } from "@/lib/phone";
import { textLike, phoneLike } from "@/lib/search";

export const dynamic = "force-dynamic";
const PAGE = 20;
const ACTIVE_CONTRACT = ["ACTIVE", "EXPIRING_SOON", "RENEWAL_PENDING"];
const OVERDUE = ["OVERDUE", "PARTIALLY_PAID"];
const TENANT_STATUS = OWNER_STATUS; // same values: ACTIVE | INACTIVE | ARCHIVED

export default async function TenantsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireStaff();
  const sp = await searchParams;
  const org = user.organizationId;
  const page = pageParam(sp.page);
  const q = sp.q?.trim();

  // Scoped roles see only tenants with contracts in their assigned properties.
  const scope = isScoped(user) ? { contracts: { some: { propertyId: { in: user.assignedPropertyIds } } } } : {};
  const where = {
    organizationId: org,
    ...scope,
    ...(sp.status ? { status: sp.status } : { status: { not: "ARCHIVED" } }),
    ...(sp.type ? { type: sp.type } : {}),
    ...(sp.riskLevel ? { riskLevel: sp.riskLevel } : {}),
    ...(sp.hasOverdue === "1" ? { installments: { some: { status: { in: OVERDUE } } } } : {}),
    ...(q ? { OR: [{ name: textLike(q) }, { code: textLike(q) }, { phone: phoneLike(q) }, { nationalId: textLike(q) }, { crNumber: textLike(q) }, { email: textLike(q) }] } : {}),
  };

  const [total, rows, activeTenants, overdueTenants, overdueAgg] = await Promise.all([
    db.tenant.count({ where }),
    db.tenant.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (page - 1) * PAGE,
      take: PAGE,
      include: {
        contracts: { where: { status: { in: ACTIVE_CONTRACT } }, orderBy: { endDate: "desc" }, select: { id: true, code: true, endDate: true, unit: { select: { id: true, number: true } }, property: { select: { id: true, name: true } } } },
        installments: { where: { status: { in: OVERDUE } }, select: { amount: true, paidAmount: true } },
      },
    }),
    db.tenant.count({ where: { organizationId: org, ...scope, status: { not: "ARCHIVED" }, contracts: { some: { status: { in: ACTIVE_CONTRACT } } } } }),
    db.tenant.count({ where: { organizationId: org, ...scope, status: { not: "ARCHIVED" }, installments: { some: { status: { in: OVERDUE } } } } }),
    db.installment.aggregate({ where: { organizationId: org, status: { in: OVERDUE }, ...contractScope(user) }, _sum: { amount: true, paidAmount: true } }),
  ]);
  const overdueAmt = (overdueAgg._sum.amount ?? 0) - (overdueAgg._sum.paidAmount ?? 0);
  const hasFilters = Boolean(sp.q || sp.status || sp.type || sp.riskLevel || sp.hasOverdue);

  return (
    <>
      <PageHeader
        title="المستأجرون"
        actions={
          <>
            {can(user, "tenants.manage") && (
              <Link href="/tenants/new" className="btn btn-primary btn-sm">
                إضافة مستأجر
              </Link>
            )}
            <MoreMenu items={[can(user, "import.manage") && { label: "استيراد من Excel", href: "/import?type=TENANTS" }]} />
          </>
        }
      />

      <GuideCard
        id="tenants"
        show={total === 0 && !hasFilters}
        title="المستأجرون: من يشغل الوحدات ويسدد الدفعات"
        steps={[
          "أضف المستأجر برقم هويته وجواله؛ الجوال هو مفتاح دخوله لبوابته.",
          "الأسهل: أنشئ المستأجر من داخل نموذج العقد مباشرة.",
          "درجة المخاطر والمتأخرات تُحسب من سجل سداده، لا تُدخل يدويًا.",
        ]}
        cta={{ href: "/tenants/new", label: "إضافة مستأجر" }}
        secondary={{ href: "/contracts/new", label: "إنشاء عقد" }}
      />

      <StatGrid cols={4}>
        <StatCard label="المستأجرون" value={num(total)} />
        <StatCard label="بعقود نشطة" value={num(activeTenants)} tone="success" />
        <StatCard label="لديهم متأخرات" value={num(overdueTenants)} tone={overdueTenants > 0 ? "danger" : undefined} href="/tenants?hasOverdue=1" />
        <StatCard label="إجمالي المتأخرات" value={money(overdueAmt)} tone={overdueAmt > 0 ? "danger" : undefined} href="/collections" />
      </StatGrid>

      <Card className="mt-4" padded={false}>
        <div className="px-4 pt-4">
          <FilterBar base="/tenants" hasFilters={hasFilters}>
            <Input name="q" placeholder="بحث بالاسم أو الجوال أو الهوية" defaultValue={sp.q ?? ""} className="!w-56" />
            <Select name="riskLevel" options={RISK_LEVELS} placeholder="كل مستويات المخاطر" defaultValue={sp.riskLevel ?? ""} className="!w-44" />
            <Select name="status" options={TENANT_STATUS} placeholder="الحالة" defaultValue={sp.status ?? ""} className="!w-40" />
            <MoreFilters open={Boolean(sp.type || sp.hasOverdue)}>
              <Select name="type" options={PARTY_TYPES} placeholder="كل الأنواع" defaultValue={sp.type ?? ""} className="!w-36" />
              <Select name="hasOverdue" options={[{ value: "1", label: "لديهم متأخرات فقط" }]} placeholder="الكل" defaultValue={sp.hasOverdue ?? ""} className="!w-44" />
            </MoreFilters>
          </FilterBar>
        </div>
        {rows.length === 0 ? (
          <EmptyState
            title={hasFilters ? "لا توجد نتائج مطابقة" : "لا يوجد مستأجرون حتى الآن"}
            description={hasFilters ? "جرّب تعديل الفلاتر." : "أضف أول مستأجر ثم أنشئ عقده على وحدة."}
            action={!hasFilters && can(user, "tenants.manage") ? <Link href="/tenants/new" className="btn btn-primary">إضافة مستأجر</Link> : undefined}
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>المستأجر</th>
                <th>النوع</th>
                <th>الجوال</th>
                <th>الوحدة / العقار الحالي</th>
                <th className="num">المتأخرات</th>
                <th>المخاطر</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const overdue = t.installments.reduce((s, i) => s + i.amount - i.paidAmount, 0);
                const c = t.contracts[0];
                return (
                  <tr key={t.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        <Avatar name={t.name} sm />
                        <div className="min-w-0">
                          <Link href={`/tenants/${t.id}`} className="cell-primary hover:text-brand">
                            {t.name}
                          </Link>
                          <div className="cell-sub latin">
                            {t.code}
                            {t.nationalId ? ` · ${t.nationalId}` : t.crNumber ? ` · CR ${t.crNumber}` : ""}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>{PARTY_TYPES[t.type] ?? t.type}</td>
                    <td className="num">{t.phone ? displayPhone(t.phone) : "—"}</td>
                    <td>
                      {c ? (
                        <>
                          <Link href={`/units/${c.unit.id}`} className="latin hover:text-brand">
                            {c.unit.number}
                          </Link>
                          <div className="cell-sub">
                            <Link href={`/properties/${c.property.id}`} className="hover:text-brand">
                              {c.property.name}
                            </Link>
                            {t.contracts.length > 1 && <span className="num"> +{t.contracts.length - 1} عقد</span>}
                          </div>
                        </>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                    <td className={`num font-semibold ${overdue > 0 ? "text-danger" : ""}`}>{money(overdue)}</td>
                    <td>
                      <StatusTag value={t.riskLevel} map={RISK_LEVELS} />
                    </td>
                    <td>
                      <StatusTag value={t.status} map={TENANT_STATUS} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <Pagination page={page} pageSize={PAGE} total={total} base="/tenants" params={sp} />
      </Card>
    </>
  );
}
