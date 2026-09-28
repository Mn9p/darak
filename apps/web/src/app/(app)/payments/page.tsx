import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, contractScope, isScoped } from "@/lib/permissions";
import { PAYMENT_METHODS, PAYMENT_STATUS, RECONCILIATION_STATUS } from "@/lib/constants";
import { money, date, startOfMonth, endOfMonth, pageParam } from "@/lib/format";
import { PageHeader, Card, Table, StatusTag, EmptyState, Pagination, Input, Select, StatGrid, StatCard, DataToolbar } from "@/components/ui";
import { GuideCard } from "@/components/GuideCard";
import { MoreMenu } from "@/components/MoreMenu";
import { MoreFilters } from "@/components/MoreFilters";
import { textLike } from "@/lib/search";

export const dynamic = "force-dynamic";
const PAGE = 25;

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireStaff();
  const sp = await searchParams;
  const org = user.organizationId;
  const page = pageParam(sp.page);
  const q = sp.q?.trim();
  const now = new Date();

  const propertyId = sp.propertyId && (!isScoped(user) || user.assignedPropertyIds.includes(sp.propertyId)) ? sp.propertyId : undefined;
  const scope = contractScope(user);
  const contractWhere = propertyId ? { propertyId } : scope.contract;
  const from = sp.from ? new Date(sp.from) : null;
  const to = sp.to ? new Date(`${sp.to}T23:59:59.999`) : null;

  const where = {
    organizationId: org,
    ...(contractWhere ? { contract: contractWhere } : {}),
    ...(sp.status ? { status: sp.status } : {}),
    ...(sp.method ? { method: sp.method } : {}),
    ...(sp.reconciliationStatus ? { reconciliationStatus: sp.reconciliationStatus } : {}),
    ...(from || to ? { paidAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    ...(q ? { OR: [{ code: textLike(q) }, { reference: textLike(q) }, { tenant: { name: textLike(q) } }] } : {}),
  };

  const [total, rows, properties, monthAgg, allActive, needsReview, activeContracts] = await Promise.all([
    db.payment.count({ where }),
    db.payment.findMany({
      where,
      orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE,
      take: PAGE,
      include: {
        tenant: { select: { id: true, name: true } },
        contract: { select: { id: true, code: true, unit: { select: { number: true } } } },
        allocations: { select: { amount: true } },
      },
    }),
    db.property.findMany({ where: { organizationId: org, status: { not: "ARCHIVED" }, ...(isScoped(user) ? { id: { in: user.assignedPropertyIds } } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.payment.aggregate({ where: { organizationId: org, ...scope, paidAt: { gte: startOfMonth(now), lte: endOfMonth(now) }, status: { in: ["RECORDED", "APPROVED"] } }, _sum: { amount: true }, _count: true }),
    db.payment.findMany({ where: { organizationId: org, ...scope, status: { in: ["RECORDED", "APPROVED"] } }, select: { amount: true, allocations: { select: { amount: true } } } }),
    db.payment.count({ where: { organizationId: org, ...scope, reconciliationStatus: "NEEDS_REVIEW" } }),
    db.contract.count({ where: { organizationId: org, status: { in: ["ACTIVE", "EXPIRING_SOON", "RENEWAL_PENDING"] } } }),
  ]);

  const unallocated = allActive.reduce((s, p) => {
    const left = p.amount - p.allocations.reduce((a, x) => a + x.amount, 0);
    return s + (left > 0.009 ? left : 0);
  }, 0);
  const hasFilters = Boolean(sp.q || sp.status || sp.method || sp.reconciliationStatus || sp.propertyId || sp.from || sp.to);

  const chips = [
    { key: "method", label: `الطريقة: ${PAYMENT_METHODS[sp.method ?? ""] ?? sp.method}` },
    { key: "status", label: `الحالة: ${PAYMENT_STATUS[sp.status ?? ""]?.label ?? sp.status}` },
    { key: "reconciliationStatus", label: `المطابقة: ${RECONCILIATION_STATUS[sp.reconciliationStatus ?? ""]?.label ?? sp.reconciliationStatus}` },
    { key: "propertyId", label: `العقار: ${properties.find((p) => p.id === sp.propertyId)?.name ?? ""}` },
    { key: "from", label: `من ${sp.from}` },
    { key: "to", label: `إلى ${sp.to}` },
  ];

  return (
    <>
      <PageHeader
        title="سندات القبض"
        actions={
          <>
            {can(user, "payments.manage") && (
              <Link href="/payments/new" className="btn btn-primary btn-sm">
                تسجيل سند قبض
              </Link>
            )}
            <MoreMenu
              items={[
                can(user, "payments.approve") && { label: "المطابقة البنكية", href: "/reconciliation" },
                { label: "التحصيل", href: "/collections" },
              ]}
            />
          </>
        }
      />

      <GuideCard
        id="payments"
        show={total === 0 && !hasFilters}
        title="سندات القبض: كل مبلغ يصل من مستأجر يُسجل هنا"
        steps={[
          "اختر المستأجر، فتظهر دفعاته المستحقة.",
          "أدخل المبلغ وطريقة الدفع والمرجع؛ يُخصَّص المبلغ على الدفعات من الأقدم.",
          "بعد الاعتماد يُقفل السند ولا يُعدّل إلا بصلاحية الاعتماد.",
        ]}
        note="السند يحتاج عقدًا نشطًا له دفعات مستحقة."
        cta={activeContracts ? { href: "/payments/new", label: "تسجيل سند قبض" } : { href: "/contracts/new", label: "ابدأ بإنشاء عقد" }}
        secondary={{ href: "/installments", label: "جدول الدفعات" }}
      />

      <StatGrid cols={4}>
        <StatCard label="محصل هذا الشهر" value={money(monthAgg._sum.amount ?? 0)} sub="ر.س" />
        <StatCard label="دفعات هذا الشهر" value={money(monthAgg._count)} />
        <StatCard label="مبالغ غير مخصصة" value={money(unallocated)} sub="ر.س" tone={unallocated > 0 ? "warning" : undefined} />
        <StatCard label="تحتاج مراجعة" value={money(needsReview)} tone={needsReview > 0 ? "danger" : undefined} href="/payments?reconciliationStatus=NEEDS_REVIEW" />
      </StatGrid>

      <Card className="mt-4" padded={false}>
        <div className="px-4 pt-4">
          <DataToolbar base="/payments" q={sp.q ?? ""} placeholder="رقم السند أو المرجع أو المستأجر" params={sp} count={total} chips={chips}>
            <Select name="method" options={PAYMENT_METHODS} placeholder="كل الطرق" defaultValue={sp.method ?? ""} className="!w-36" />
            <Select name="status" options={PAYMENT_STATUS} placeholder="الحالة" defaultValue={sp.status ?? ""} className="!w-36" />
            <MoreFilters open={Boolean(sp.reconciliationStatus || sp.propertyId || sp.from || sp.to)}>
              <Select name="reconciliationStatus" options={RECONCILIATION_STATUS} placeholder="حالة المطابقة" defaultValue={sp.reconciliationStatus ?? ""} className="!w-44" />
              <Select name="propertyId" options={properties.map((p) => ({ value: p.id, label: p.name }))} placeholder="كل العقارات" defaultValue={sp.propertyId ?? ""} className="!w-44" />
              <Input name="from" type="date" defaultValue={sp.from ?? ""} className="!w-36" aria-label="من تاريخ" />
              <Input name="to" type="date" defaultValue={sp.to ?? ""} className="!w-36" aria-label="إلى تاريخ" />
            </MoreFilters>
          </DataToolbar>
        </div>
        {rows.length === 0 ? (
          <EmptyState
            title={hasFilters ? "لا توجد دفعات مطابقة" : "لا توجد دفعات مسجلة"}
            description={hasFilters ? "جرّب تعديل الفلاتر." : "سجّل أول سند قبض وخصصه على دفعات المستأجر."}
            action={!hasFilters && can(user, "payments.manage") ? <Link href="/payments/new" className="btn btn-primary">تسجيل سند قبض</Link> : undefined}
          />
        ) : (
          <Table density="compact">
            <thead>
              <tr>
                <th>السند</th>
                <th>التاريخ</th>
                <th>المستأجر</th>
                <th className="num">المبلغ</th>
                <th>الطريقة</th>
                <th>الحالة</th>
                <th>المطابقة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const allocated = p.allocations.reduce((s, a) => s + a.amount, 0);
                const left = p.amount - allocated;
                const inactive = ["REVERSED", "RETURNED"].includes(p.status);
                return (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/payments/${p.id}`} className="cell-primary latin hover:text-brand">
                        {p.code}
                      </Link>
                    </td>
                    <td>{date(p.paidAt)}</td>
                    <td>
                      <Link href={`/tenants/${p.tenant.id}`} className="hover:text-brand">
                        {p.tenant.name}
                      </Link>
                      {p.contract && (
                        <div className="cell-sub latin">
                          <Link href={`/contracts/${p.contract.id}`} className="hover:text-brand">
                            {p.contract.code}
                          </Link>{" "}
                          · {p.contract.unit.number}
                        </div>
                      )}
                    </td>
                    <td className={`num font-bold ${inactive ? "line-through text-muted" : ""}`}>
                      {money(p.amount)}
                      {left > 0.009 && !inactive && <div className="cell-sub num text-warning">غير مخصص: {money(left)}</div>}
                    </td>
                    <td>
                      {PAYMENT_METHODS[p.method] ?? p.method}
                      {(p.reference || p.bank) && (
                        <div className="cell-sub">
                          {p.reference && <span className="latin">{p.reference}</span>}
                          {p.reference && p.bank && " · "}
                          {p.bank}
                        </div>
                      )}
                    </td>
                    <td>
                      <StatusTag value={p.status} map={PAYMENT_STATUS} />
                    </td>
                    <td>
                      <StatusTag value={p.reconciliationStatus} map={RECONCILIATION_STATUS} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <Pagination page={page} pageSize={PAGE} total={total} base="/payments" params={sp} />
      </Card>
    </>
  );
}
