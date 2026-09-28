import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { STATEMENT_STATUS } from "@/lib/constants";
import { money, date, monthLabel, startOfMonth, endOfMonth, addMonths, pageParam } from "@/lib/format";
import { PageHeader, Card, Table, StatusTag, EmptyState, Pagination, FilterBar, Input, Select, StatGrid, StatCard, Alert } from "@/components/ui";
import { GuideCard } from "@/components/GuideCard";
import { MoreMenu, Optional } from "@/components/MoreMenu";
import { MoreFilters } from "@/components/MoreFilters";
import { GenerateStatementForm } from "./GenerateStatementForm";
import { generateStatement } from "./actions";

export const dynamic = "force-dynamic";
const PAGE = 20;

export default async function StatementsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireStaff();
  const sp = await searchParams;
  const org = user.organizationId;
  const page = pageParam(sp.page);

  const periodMatch = /^(\d{4})-(\d{2})$/.exec(sp.period ?? "");
  const periodStart = periodMatch ? new Date(Number(periodMatch[1]), Number(periodMatch[2]) - 1, 1) : null;

  const where = {
    organizationId: org,
    ...(sp.ownerId ? { ownerId: sp.ownerId } : {}),
    ...(sp.status ? { status: sp.status } : {}),
    ...(sp.propertyId ? { propertyId: sp.propertyId } : {}),
    ...(periodStart ? { periodStart: { gte: periodStart, lte: endOfMonth(periodStart) } } : {}),
  };

  const now = new Date();
  const [total, rows, owners, properties, byStatus, paidMonth, activeContracts] = await Promise.all([
    db.ownerStatement.count({ where }),
    db.ownerStatement.findMany({
      where,
      orderBy: [{ periodStart: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE,
      take: PAGE,
      include: { owner: { select: { id: true, name: true } }, property: { select: { id: true, name: true } } },
    }),
    db.owner.findMany({ where: { organizationId: org, status: { not: "ARCHIVED" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.property.findMany({ where: { organizationId: org, status: { not: "ARCHIVED" } }, select: { id: true, name: true, ownerships: { where: { endDate: null }, select: { ownerId: true } } }, orderBy: { name: "asc" } }),
    db.ownerStatement.groupBy({ by: ["status"], where: { organizationId: org }, _count: true, _sum: { netDue: true } }),
    db.ownerStatement.aggregate({ where: { organizationId: org, status: { in: ["PAID", "CLOSED"] }, paidAt: { gte: startOfMonth(now), lte: endOfMonth(now) } }, _sum: { netDue: true }, _count: true }),
    db.contract.count({ where: { organizationId: org, status: { in: ["ACTIVE", "EXPIRING_SOON", "RENEWAL_PENDING"] } } }),
  ]);

  const stat = (s: string) => byStatus.find((x) => x.status === s);
  const hasFilters = Boolean(sp.ownerId || sp.status || sp.period || sp.propertyId);
  const prevMonth = addMonths(startOfMonth(now), -1);
  const defaultPeriod = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, "0")}`;
  const filteredOwner = sp.ownerId ? owners.find((o) => o.id === sp.ownerId) : null;
  const canManage = can(user, "statements.manage");
  const openGenerate = Boolean(sp.new || sp.ownerId);
  // A statement needs an owner with a property and collected rent — without an active contract there is nothing to settle.
  const notReady = owners.length === 0 || activeContracts === 0;
  const notReadyHref = owners.length === 0 ? "/owners/new" : properties.length === 0 ? "/properties/new" : "/contracts/new";
  const notReadyCta = owners.length === 0 ? "إضافة مالك" : properties.length === 0 ? "إضافة عقار" : "عقد جديد";

  return (
    <>
      <PageHeader
        title="كشوف حساب الملاك"
        subtitle={filteredOwner ? <>تسويات المالك <Link href={`/owners/${filteredOwner.id}`} className="link">{filteredOwner.name}</Link></> : undefined}
        actions={
          <>
            {canManage && !notReady && (
              <Link href="/statements?new=1" className="btn btn-primary btn-sm">
                إنشاء كشف حساب
              </Link>
            )}
            <MoreMenu items={[can(user, "reports.financial") && { label: "تقارير الملاك", href: "/reports?type=owners" }]} />
          </>
        }
      />

      <GuideCard
        id="statements"
        show={total === 0 && !hasFilters}
        title="كشف حساب المالك: ما تم تحصيله ناقص الإدارة والمصروفات"
        steps={[
          "اختر المالك والعقار والفترة؛ تُحسب الأرقام من سندات القبض والمصروفات المعتمدة.",
          "راجع الكشف ثم اعتمده؛ يظهر للمالك في بوابته فورًا.",
          "بعد التحويل سجّل الصرف ليُقفل الكشف.",
        ]}
        note="لا يُصدر كشف قبل وجود عقد نشط ومالك مرتبط بالعقار."
        cta={activeContracts ? { href: "/statements/new", label: "إنشاء كشف حساب" } : { href: "/contracts/new", label: "ابدأ بإنشاء عقد" }}
        secondary={{ href: "/owners", label: "الملاك" }}
      />

      <StatGrid cols={4}>
        <StatCard label="مسودات" value={money(stat("DRAFT")?._count ?? 0)} href="/statements?status=DRAFT" />
        <StatCard label="قيد المراجعة" value={money(stat("UNDER_REVIEW")?._count ?? 0)} tone={(stat("UNDER_REVIEW")?._count ?? 0) > 0 ? "warning" : undefined} href="/statements?status=UNDER_REVIEW" />
        <StatCard label="معتمدة بانتظار التحويل" value={money(stat("APPROVED")?._sum.netDue ?? 0)} sub={`${stat("APPROVED")?._count ?? 0} كشف حساب`} tone={(stat("APPROVED")?._count ?? 0) > 0 ? "success" : undefined} href="/statements?status=APPROVED" />
        <StatCard label={`محوّل في ${monthLabel(now)}`} value={money(paidMonth._sum.netDue ?? 0)} sub={`${paidMonth._count} كشف حساب`} />
      </StatGrid>

      {notReady && (
        <div className="mt-4">
          <Alert tone="warning" title="تحتاج مالكًا وعقارًا وعقدًا نشطًا أولًا">
            كشف الحساب يُحسب من الإيجار المحصل على عقارات المالك، فلا يمكن إنشاؤه قبل ذلك.{" "}
            <Link href={notReadyHref} className="link font-bold">
              {notReadyCta}
            </Link>
          </Alert>
        </div>
      )}

      {canManage && !notReady && (
        <div className="mt-4">
          <Optional title="إنشاء كشف حساب" open={openGenerate}>
            <GenerateStatementForm action={generateStatement} owners={owners} properties={properties.map((p) => ({ id: p.id, name: p.name, ownerIds: p.ownerships.map((o) => o.ownerId) }))} defaultOwnerId={sp.ownerId} defaultPropertyId={sp.propertyId} defaultPeriod={defaultPeriod} />
          </Optional>
        </div>
      )}

      <Card className="mt-4" padded={false}>
        <div className="px-4 pt-4">
          <FilterBar base="/statements" hasFilters={hasFilters}>
            <Select name="ownerId" options={owners.map((o) => ({ value: o.id, label: o.name }))} placeholder="كل الملاك" defaultValue={sp.ownerId ?? ""} className="!w-48" />
            <Select name="status" options={STATEMENT_STATUS} placeholder="كل الحالات" defaultValue={sp.status ?? ""} className="!w-40" />
            <MoreFilters open={Boolean(sp.propertyId || sp.period)}>
              <Select name="propertyId" options={properties.map((p) => ({ value: p.id, label: p.name }))} placeholder="كل العقارات" defaultValue={sp.propertyId ?? ""} className="!w-44" />
              <Input name="period" type="month" defaultValue={sp.period ?? ""} className="!w-40" title="الشهر" />
            </MoreFilters>
          </FilterBar>
        </div>
        {rows.length === 0 ? (
          <EmptyState
            title={hasFilters ? "لا توجد تسويات مطابقة" : "لا توجد تسويات حتى الآن"}
            description={hasFilters ? "جرّب تعديل الفلاتر." : "أنشئ أول كشف حساب لمالك عن شهر محدد."}
            action={!hasFilters && canManage ? (notReady ? <Link href={notReadyHref} className="btn btn-primary">{notReadyCta}</Link> : <Link href="/statements?new=1" className="btn btn-primary">إنشاء كشف حساب</Link>) : undefined}
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>الرقم</th>
                <th>المالك</th>
                <th>الفترة</th>
                <th className="num">المحصل</th>
                <th className="num">الخصومات</th>
                <th className="num">صافي المستحق</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const deductions = s.managementFees + s.expenses + s.otherDeductions;
                return (
                  <tr key={s.id}>
                    <td>
                      <Link href={`/statements/${s.id}`} className="cell-primary latin hover:text-brand">
                        {s.code}
                      </Link>
                      <div className="cell-sub">{date(s.createdAt)}</div>
                    </td>
                    <td>
                      <Link href={`/owners/${s.owner.id}`} className="hover:text-brand">
                        {s.owner.name}
                      </Link>
                      <div className="cell-sub">{s.property ? <Link href={`/properties/${s.property.id}`} className="hover:text-brand">{s.property.name}</Link> : "كل العقارات"}</div>
                    </td>
                    <td>
                      {monthLabel(s.periodStart)}
                      <div className="cell-sub">
                        {date(s.periodStart)} → {date(s.periodEnd)}
                      </div>
                    </td>
                    <td className="num">{money(s.collectedRent)}</td>
                    <td className="num text-muted">
                      −{money(deductions)}
                      <div className="cell-sub num">
                        أتعاب {money(s.managementFees)} · مصروفات {money(s.expenses)}
                        {s.otherDeductions ? ` · أخرى ${money(s.otherDeductions)}` : ""}
                      </div>
                    </td>
                    <td className={`num font-bold ${s.netDue < 0 ? "text-danger" : "text-brand"}`}>{money(s.netDue)}</td>
                    <td>
                      <StatusTag value={s.status} map={STATEMENT_STATUS} />
                      {s.paidAt && <div className="cell-sub">حُوّل {date(s.paidAt)}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <Pagination page={page} pageSize={PAGE} total={total} base="/statements" params={{ ...sp, new: undefined }} />
      </Card>
    </>
  );
}
