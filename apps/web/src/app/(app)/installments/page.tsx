import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, contractScope, propertyScope } from "@/lib/permissions";
import { INSTALLMENT_STATUS, AGING_BUCKETS } from "@/lib/constants";
import { money, date, daysOverdue, daysFromToday, pageParam } from "@/lib/format";
import { PageHeader, Card, Table, StatusTag, EmptyState, Pagination, Input, Select, StatGrid, StatCard, Progress, DataToolbar } from "@/components/ui";
import { GuideCard } from "@/components/GuideCard";
import { displayPhone } from "@/lib/phone";
import { textLike, phoneLike } from "@/lib/search";

export const dynamic = "force-dynamic";
const PAGE = 25;

export default async function InstallmentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireStaff();
  const sp = await searchParams;
  const org = user.organizationId;
  const page = pageParam(sp.page);
  const q = sp.q?.trim();
  const scope = contractScope(user);
  const from = sp.from ? new Date(sp.from) : null;
  const to = sp.to ? new Date(`${sp.to}T23:59:59.999`) : null;

  const contractFilter = {
    ...(scope.contract ?? {}),
    ...(sp.propertyId ? { propertyId: sp.propertyId } : {}),
    status: { notIn: ["DRAFT", "PENDING_APPROVAL", "CANCELLED"] },
  };
  const where = {
    organizationId: org,
    contract: contractFilter,
    ...(sp.contractId ? { contractId: sp.contractId } : {}),
    ...(sp.status ? { status: sp.status } : {}),
    ...(from || to ? { dueDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    ...(q ? { tenant: { OR: [{ name: textLike(q) }, { phone: phoneLike(q) }, { code: textLike(q) }] } } : {}),
  };
  const baseWhere = { organizationId: org, contract: { ...(scope.contract ?? {}), status: { notIn: ["DRAFT", "PENDING_APPROVAL", "CANCELLED"] } } };

  const [total, rows, properties, byStatus, overdueRows, partial] = await Promise.all([
    db.installment.count({ where }),
    db.installment.findMany({
      where,
      orderBy: sp.status === "PAID" ? { dueDate: "desc" } : { dueDate: "asc" },
      skip: (page - 1) * PAGE,
      take: PAGE,
      include: {
        tenant: { select: { id: true, name: true, phone: true } },
        contract: { select: { id: true, code: true, unit: { select: { id: true, number: true } }, property: { select: { id: true, name: true } } } },
        collectionCase: { select: { id: true, followUpStatus: true } },
      },
    }),
    db.property.findMany({ where: { organizationId: org, status: { not: "ARCHIVED" }, ...propertyScope(user) }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.installment.groupBy({ by: ["status"], where: baseWhere, _count: true, _sum: { amount: true, paidAmount: true } }),
    db.installment.findMany({ where: { ...baseWhere, status: { in: ["OVERDUE", "PARTIALLY_PAID", "DUE"] } }, select: { amount: true, paidAmount: true, dueDate: true } }),
    db.installment.aggregate({ where: { ...baseWhere, status: "PARTIALLY_PAID" }, _count: true, _sum: { amount: true, paidAmount: true } }),
  ]);

  const stat = (s: string) => byStatus.find((b) => b.status === s);
  const cnt = (s: string) => stat(s)?._count ?? 0;
  const rem = (s: string) => (stat(s)?._sum.amount ?? 0) - (stat(s)?._sum.paidAmount ?? 0);
  const lateRows = overdueRows.filter((i) => daysOverdue(i.dueDate) > 0);
  const overdueAmt = lateRows.reduce((s, i) => s + i.amount - i.paidAmount, 0);
  const aging = AGING_BUCKETS.map((b) => {
    const list = lateRows.filter((i) => {
      const d = daysOverdue(i.dueDate);
      return d >= b.min && d <= b.max;
    });
    return { ...b, count: list.length, amount: list.reduce((s, i) => s + i.amount - i.paidAmount, 0) };
  });
  const agingTotal = Math.max(1, aging.reduce((s, a) => s + a.amount, 0));
  const hasFilters = Boolean(sp.q || sp.status || sp.propertyId || sp.from || sp.to || sp.contractId);

  const chips = [
    { key: "status", label: `الحالة: ${INSTALLMENT_STATUS[sp.status ?? ""]?.label ?? sp.status}` },
    { key: "propertyId", label: `العقار: ${properties.find((p) => p.id === sp.propertyId)?.name ?? ""}` },
    { key: "contractId", label: "عقد محدد" },
    { key: "from", label: `من ${sp.from}` },
    { key: "to", label: `إلى ${sp.to}` },
  ];

  return (
    <>
      <PageHeader title="جدول الدفعات" subtitle="حالات الأقساط تُحدّث تلقائيًا من تواريخ الاستحقاق والمدفوعات المخصصة." actions={can(user, "collections.view") ? <Link href="/collections" className="btn btn-outline btn-sm">قائمة التحصيل</Link> : undefined} />

      <GuideCard
        id="installments"
        show={total === 0 && !hasFilters}
        title="جدول الدفعات: كل دفعة مستحقة على كل عقد"
        steps={[
          "تُنشأ الدفعات تلقائيًا عند تفعيل العقد، لا تُدخل يدويًا.",
          "حالتها (قادمة، مستحقة، متأخرة، مسددة) تتحدث من تاريخ الاستحقاق وسندات القبض.",
          "ما يتجاوز مهلة السداد يظهر في التحصيل كمطالبة.",
        ]}
        note="مهلة السداد النظامية: 15 يومًا للشهري والربع سنوي، 30 يومًا للنصف سنوي والسنوي."
        cta={{ href: "/contracts/new", label: "إنشاء عقد" }}
        secondary={{ href: "/contracts", label: "العقود" }}
      />

      <StatGrid cols={4}>
        <StatCard label="قادمة" value={money(cnt("UPCOMING"))} sub={`${money(rem("UPCOMING"))} ر.س`} href="/installments?status=UPCOMING" />
        <StatCard label="مستحقة" value={money(cnt("DUE"))} sub={`${money(rem("DUE"))} ر.س`} href="/installments?status=DUE" tone={cnt("DUE") ? "warning" : undefined} />
        <StatCard label="متأخرة" value={money(cnt("OVERDUE"))} sub={`${money(rem("OVERDUE"))} ر.س`} href="/installments?status=OVERDUE" tone={cnt("OVERDUE") ? "danger" : undefined} />
        <StatCard label="مدفوعة جزئيًا" value={money(partial._count)} sub={`متبقٍ ${money((partial._sum.amount ?? 0) - (partial._sum.paidAmount ?? 0))} ر.س`} href="/installments?status=PARTIALLY_PAID" dark />
      </StatGrid>

      <Card className="mt-4" title="أعمار المتأخرات (Aging)" subtitle={`إجمالي المتأخر ${money(overdueAmt)} ر.س في ${lateRows.length} قسط`}>
        <div className="grid gap-3 md:grid-cols-4">
          {aging.map((a) => (
            <div key={a.key} className="rounded-xl bg-mist px-3 py-2.5">
              <div className="flex items-center justify-between text-[12.5px]">
                <span className="text-muted">{a.label}</span>
                <span className="num text-muted">{a.count} قسط</span>
              </div>
              <div className="num mt-1 text-lg font-bold">{money(a.amount)}</div>
              <Progress value={(a.amount / agingTotal) * 100} tone={a.key === "b1" ? undefined : a.key === "b2" ? "sand" : a.key === "b3" ? "warn" : "danger"} />
            </div>
          ))}
        </div>
      </Card>

      <Card className="mt-4" padded={false}>
        <div className="px-4 pt-4">
          <DataToolbar base="/installments" q={sp.q ?? ""} placeholder="بحث بالمستأجر أو الجوال…" params={sp} count={total} chips={chips}>
            {sp.contractId && <input type="hidden" name="contractId" value={sp.contractId} />}
            <Select name="status" options={INSTALLMENT_STATUS} placeholder="كل الحالات" defaultValue={sp.status ?? ""} className="!w-40" />
            <Select name="propertyId" options={properties.map((p) => ({ value: p.id, label: p.name }))} placeholder="كل العقارات" defaultValue={sp.propertyId ?? ""} className="!w-48" />
            <Input name="from" type="date" defaultValue={sp.from ?? ""} className="!w-40" title="الاستحقاق من" />
            <Input name="to" type="date" defaultValue={sp.to ?? ""} className="!w-40" title="الاستحقاق إلى" />
          </DataToolbar>
          {sp.contractId && (
            <p className="mb-3 text-[12.5px] text-muted">
              عرض أقساط عقد محدد ·{" "}
              <Link href={`/contracts/${sp.contractId}`} className="link">
                فتح العقد
              </Link>
            </p>
          )}
        </div>
        {rows.length === 0 ? (
          <EmptyState
            title={hasFilters ? "لا توجد نتائج مطابقة" : "لا توجد أقساط بعد"}
            description={hasFilters ? "جرّب تعديل الفلاتر." : "تُنشأ الأقساط تلقائيًا عند تفعيل العقود."}
            action={!hasFilters && can(user, "contracts.manage") ? <Link href="/contracts/new" className="btn btn-primary">إنشاء عقد</Link> : undefined}
          />
        ) : (
          <Table density="compact">
            <thead>
              <tr>
                <th>القسط</th>
                <th>العقد</th>
                <th>المستأجر</th>
                <th>الوحدة</th>
                <th>الاستحقاق</th>
                <th className="num">المبلغ</th>
                <th className="num">المدفوع</th>
                <th className="num">المتبقي</th>
                <th>الحالة</th>
                <th>المطالبة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => {
                const remaining = i.status === "WAIVED" ? 0 : i.amount - i.paidAmount;
                const late = ["PAID", "WAIVED"].includes(i.status) ? 0 : daysOverdue(i.dueDate);
                const ahead = daysFromToday(i.dueDate);
                return (
                  <tr key={i.id}>
                    <td>
                      <Link href={`/installments/${i.id}`} className="cell-primary latin hover:text-brand">
                        {i.contract.code} / {i.seq}
                      </Link>
                    </td>
                    <td>
                      <Link href={`/contracts/${i.contract.id}`} className="latin hover:text-brand">
                        {i.contract.code}
                      </Link>
                    </td>
                    <td>
                      <Link href={`/tenants/${i.tenant.id}`} className="hover:text-brand">
                        {i.tenant.name}
                      </Link>
                      {i.tenant.phone && <div className="cell-sub num">{displayPhone(i.tenant.phone)}</div>}
                    </td>
                    <td>
                      <Link href={`/units/${i.contract.unit.id}`} className="latin hover:text-brand">
                        {i.contract.unit.number}
                      </Link>
                      <div className="cell-sub">{i.contract.property.name}</div>
                    </td>
                    <td>
                      {date(i.dueDate)}
                      {late > 0 ? <div className="cell-sub text-danger">متأخر {late} يوم</div> : !["PAID", "WAIVED"].includes(i.status) && ahead >= 0 ? <div className="cell-sub">{ahead === 0 ? "اليوم" : `بعد ${ahead} يوم`}</div> : null}
                    </td>
                    <td className="num">{money(i.amount)}</td>
                    <td className="num text-success">{money(i.paidAmount)}</td>
                    <td className={`num font-semibold ${remaining > 0 && late > 0 ? "text-danger" : ""}`}>{money(remaining)}</td>
                    <td>
                      <StatusTag value={i.status} map={INSTALLMENT_STATUS} />
                    </td>
                    <td>
                      {i.collectionCase ? (
                        <Link href={`/collections/${i.collectionCase.id}`} className="link text-xs">
                          المطالبة
                        </Link>
                      ) : can(user, "payments.manage") && remaining > 0 ? (
                        <Link href={`/payments/new?installmentId=${i.id}&tenantId=${i.tenant.id}`} className="btn btn-ghost btn-xs">
                          تسجيل دفعة
                        </Link>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <Pagination page={page} pageSize={PAGE} total={total} base="/installments" params={sp} />
      </Card>
    </>
  );
}
