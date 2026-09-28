import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, propertyIdScope, propertyScope } from "@/lib/permissions";
import { CONTRACT_STATUS, PAYMENT_FREQUENCY } from "@/lib/constants";
import { money, date, daysFromToday, addDays, pageParam } from "@/lib/format";
import { PageHeader, Card, Table, StatusTag, EmptyState, Pagination, Select, StatGrid, StatCard, DataToolbar } from "@/components/ui";
import { GuideCard } from "@/components/GuideCard";
import { MoreMenu } from "@/components/MoreMenu";
import { MoreFilters } from "@/components/MoreFilters";
import { textLike, phoneLike } from "@/lib/search";

export const dynamic = "force-dynamic";
const PAGE = 20;
const OPEN = ["ACTIVE", "EXPIRING_SOON", "RENEWAL_PENDING"];

export default async function ContractsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireStaff();
  const sp = await searchParams;
  const org = user.organizationId;
  const page = pageParam(sp.page);
  const q = sp.q?.trim();
  const expiring = ["30", "60", "90"].includes(sp.expiring ?? "") ? Number(sp.expiring) : null;
  const now = new Date();
  const scope = propertyIdScope(user);

  const where = {
    organizationId: org,
    ...scope,
    ...(sp.status ? { status: sp.status } : expiring ? { status: { in: OPEN } } : { status: { not: "CANCELLED" } }),
    ...(sp.propertyId ? { propertyId: sp.propertyId } : {}),
    ...(sp.frequency ? { paymentFrequency: sp.frequency } : {}),
    ...(expiring ? { endDate: { gte: now, lte: addDays(now, expiring) } } : {}),
    ...(q ? { OR: [{ code: textLike(q) }, { tenant: { name: textLike(q) } }, { tenant: { phone: phoneLike(q) } }] } : {}),
  };

  const [total, rows, properties, active, exp30, renewalPending, drafts] = await Promise.all([
    db.contract.count({ where }),
    db.contract.findMany({
      where,
      orderBy: expiring ? { endDate: "asc" } : { createdAt: "desc" },
      skip: (page - 1) * PAGE,
      take: PAGE,
      include: {
        unit: { select: { id: true, number: true } },
        property: { select: { id: true, name: true } },
        tenant: { select: { id: true, name: true } },
        owner: { select: { id: true, name: true } },
        installments: { select: { amount: true, paidAmount: true, status: true } },
      },
    }),
    db.property.findMany({ where: { organizationId: org, status: { not: "ARCHIVED" }, ...propertyScope(user) }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.contract.count({ where: { organizationId: org, ...scope, status: { in: OPEN } } }),
    db.contract.count({ where: { organizationId: org, ...scope, status: { in: OPEN }, endDate: { gte: now, lte: addDays(now, 30) } } }),
    db.contract.count({ where: { organizationId: org, ...scope, status: "RENEWAL_PENDING" } }),
    db.contract.count({ where: { organizationId: org, ...scope, status: { in: ["DRAFT", "PENDING_APPROVAL"] } } }),
  ]);

  const hasFilters = Boolean(sp.q || sp.status || sp.propertyId || sp.expiring || sp.frequency);

  const chips = [
    { key: "status", label: `الحالة: ${CONTRACT_STATUS[sp.status ?? ""]?.label ?? sp.status}` },
    { key: "propertyId", label: `العقار: ${properties.find((p) => p.id === sp.propertyId)?.name ?? ""}` },
    { key: "expiring", label: `تنتهي خلال ${sp.expiring} يوم` },
    { key: "frequency", label: `الدورية: ${PAYMENT_FREQUENCY[sp.frequency ?? ""] ?? sp.frequency}` },
  ];

  return (
    <>
      <PageHeader
        title="العقود"
        actions={
          <>
            {can(user, "contracts.manage") && (
              <Link href="/contracts/new" className="btn btn-primary btn-sm">
                عقد جديد
              </Link>
            )}
            <MoreMenu items={[can(user, "import.manage") && { label: "استيراد من Excel", href: "/import?type=CONTRACTS" }]} />
          </>
        }
      />

      <GuideCard
        id="contracts"
        show={total === 0 && !hasFilters}
        title="العقد يربط المستأجر بالوحدة ويولّد جدول السداد"
        steps={[
          "اختر الوحدة الشاغرة والمستأجر، وحدد المدة والإيجار ودورية السداد.",
          "احفظه كمسودة ثم فعّله؛ عند التفعيل تُنشأ الدفعات المستحقة تلقائيًا.",
          "قبل انتهائه بـ 90 يومًا يُنبّهك النظام لقرار التجديد.",
        ]}
        note="لا يُحذف العقد بعد تفعيله؛ يُفسخ أو يُلغى مع توثيق السبب."
        cta={properties.length ? { href: "/contracts/new", label: "إنشاء عقد" } : { href: "/properties/new", label: "ابدأ بإضافة عقار" }}
        secondary={{ href: "/import?type=CONTRACTS", label: "استيراد من Excel" }}
      />

      <StatGrid cols={4}>
        <StatCard label="عقود نشطة" value={money(active)} tone="success" href="/contracts?status=ACTIVE" />
        <StatCard label="تنتهي خلال 30 يوم" value={money(exp30)} tone={exp30 ? "danger" : undefined} href="/contracts?expiring=30" />
        <StatCard label="تجديد معلق" value={money(renewalPending)} href="/contracts?status=RENEWAL_PENDING" />
        <StatCard label="مسودات وبانتظار الاعتماد" value={money(drafts)} href="/contracts?status=PENDING_APPROVAL" />
      </StatGrid>

      <Card className="mt-4" padded={false}>
        <div className="px-4 pt-4">
          <DataToolbar base="/contracts" q={sp.q ?? ""} placeholder="رقم العقد أو المستأجر" params={sp} count={total} chips={chips}>
            <Select name="status" options={CONTRACT_STATUS} placeholder="كل الحالات" defaultValue={sp.status ?? ""} className="!w-44" />
            <Select name="propertyId" options={properties.map((p) => ({ value: p.id, label: p.name }))} placeholder="كل العقارات" defaultValue={sp.propertyId ?? ""} className="!w-48" />
            <MoreFilters open={Boolean(sp.expiring || sp.frequency)}>
              <Select name="expiring" options={[{ value: "30", label: "تنتهي خلال 30 يوم" }, { value: "60", label: "تنتهي خلال 60 يوم" }, { value: "90", label: "تنتهي خلال 90 يوم" }]} placeholder="كل تواريخ الانتهاء" defaultValue={sp.expiring ?? ""} className="!w-44" />
              <Select name="frequency" options={PAYMENT_FREQUENCY} placeholder="كل دوريات السداد" defaultValue={sp.frequency ?? ""} className="!w-40" />
            </MoreFilters>
          </DataToolbar>
        </div>
        {rows.length === 0 ? (
          <EmptyState
            title={hasFilters ? "لا توجد نتائج مطابقة" : "لا توجد عقود حتى الآن"}
            description={hasFilters ? "جرّب تعديل الفلاتر." : "أنشئ أول عقد لبدء المتابعة."}
            action={!hasFilters && can(user, "contracts.manage") ? <Link href="/contracts/new" className="btn btn-primary">عقد جديد</Link> : undefined}
          />
        ) : (
          <Table density="compact">
            <thead>
              <tr>
                <th>العقد</th>
                <th>الوحدة / العقار</th>
                <th>المستأجر</th>
                <th>المدة</th>
                <th className="num">القيمة</th>
                <th>الدورية</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const left = daysFromToday(c.endDate);
                const open = OPEN.includes(c.status);
                const paid = c.installments.reduce((s, i) => s + i.paidAmount, 0);
                const overdue = c.installments.filter((i) => ["OVERDUE", "PARTIALLY_PAID"].includes(i.status)).length;
                return (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/contracts/${c.id}`} className="cell-primary latin hover:text-brand">
                        {c.code}
                      </Link>
                    </td>
                    <td>
                      <Link href={`/units/${c.unit.id}`} className="latin font-semibold hover:text-brand">
                        {c.unit.number}
                      </Link>
                      <div className="cell-sub">
                        <Link href={`/properties/${c.property.id}`} className="hover:text-brand">
                          {c.property.name}
                        </Link>
                      </div>
                    </td>
                    <td>
                      <Link href={`/tenants/${c.tenant.id}`} className="hover:text-brand">
                        {c.tenant.name}
                      </Link>
                      <div className="cell-sub">
                        المالك:{" "}
                        <Link href={`/owners/${c.owner.id}`} className="hover:text-brand">
                          {c.owner.name}
                        </Link>
                      </div>
                    </td>
                    <td>
                      {date(c.startDate)} ← {date(c.endDate)}
                      {open && <div className={`cell-sub ${left <= 30 ? "text-danger" : left <= 90 ? "text-warning" : ""}`}>{left < 0 ? `منتهي منذ ${-left} يوم` : `بعد ${left} يوم`}</div>}
                    </td>
                    <td className="num font-semibold">
                      {money(c.totalAmount)}
                      {open && c.installments.length > 0 && <div className="cell-sub num">محصل {money(paid)}</div>}
                    </td>
                    <td>{PAYMENT_FREQUENCY[c.paymentFrequency] ?? c.paymentFrequency}</td>
                    <td>
                      <StatusTag value={c.status} map={CONTRACT_STATUS} />
                      {overdue > 0 && <div className="cell-sub text-danger">أقساط متأخرة: {overdue}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <Pagination page={page} pageSize={PAGE} total={total} base="/contracts" params={sp} />
      </Card>
    </>
  );
}
