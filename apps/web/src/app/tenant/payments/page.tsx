import Link from "next/link";
import { requireTenant } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, date, daysOverdue, num } from "@/lib/format";
import { INSTALLMENT_STATUS, PAYMENT_STATUS, PAYMENT_METHODS } from "@/lib/constants";
import { PageHeader, Card, Table, StatusTag, EmptyState, StatGrid, StatCard, Tabs, Alert, ActionButton } from "@/components/ui";
import { bankDetails } from "../_scope";

export const dynamic = "force-dynamic";
const TABS = [
  { key: "installments", label: "الدفعات" },
  { key: "payments", label: "الإيصالات" },
];

export default async function TenantPaymentsPage({ searchParams }: { searchParams: Promise<{ tab?: string; paid?: string }> }) {
  const user = await requireTenant();
  const org = user.organizationId;
  const { tab = "installments", paid: paidFlag } = await searchParams;

  const [installments, payments, orgRow] = await Promise.all([
    db.installment.findMany({ where: { organizationId: org, tenantId: user.tenantId, contract: { status: { notIn: ["DRAFT", "CANCELLED"] } } }, orderBy: { dueDate: "asc" }, include: { contract: { select: { code: true, unit: { select: { number: true } }, property: { select: { name: true } } } } } }),
    db.payment.findMany({ where: { organizationId: org, tenantId: user.tenantId }, orderBy: { paidAt: "desc" }, include: { contract: { select: { code: true } }, allocations: { select: { amount: true, installment: { select: { seq: true } } } } } }),
    db.organization.findUnique({ where: { id: org }, select: { name: true, phone: true, settings: true } }),
  ]);
  const live = installments.filter((i) => i.status !== "WAIVED");
  const total = live.reduce((s, i) => s + i.amount, 0);
  const paid = live.reduce((s, i) => s + i.paidAmount, 0);
  const overdue = live.filter((i) => ["OVERDUE", "PARTIALLY_PAID"].includes(i.status) && daysOverdue(i.dueDate) > 0).reduce((s, i) => s + (i.amount - i.paidAmount), 0);
  const bank = bankDetails(orgRow?.settings ?? "{}");

  return (
    <>
      <PageHeader title="الدفعات" subtitle="جدول أقساطك والدفعات التي سجلها المكتب" />
      <StatGrid cols={3}>
        <StatCard label="المسدد" value={money(paid)} sub={`من ${money(total)} ر.س`} tone="success" />
        <StatCard label="المتبقي" value={money(total - paid)} />
        <StatCard label="المتأخر" value={money(overdue)} tone={overdue > 0 ? "danger" : undefined} />
      </StatGrid>

      {paidFlag === "1" && (
        <div className="mt-4">
          <Alert tone="success" title="تم استلام عملية الدفع">
            شكرًا لك. تُسجَّل الدفعة الإلكترونية تلقائيًا خلال دقائق وتظهر في تبويب «الإيصالات». إن لم تظهر خلال ساعة، تواصل مع المكتب{orgRow?.phone ? ` (${orgRow.phone})` : ""}.
          </Alert>
        </div>
      )}

      <div className="mt-4 mb-4">
        <Alert tone="brand" title="كيف أسدد؟">
          {bank.iban ? (
            <>حوّل إلى حساب <b>{bank.accountName ?? orgRow?.name}</b> — {bank.bankName} — IBAN: <span className="latin font-bold">{bank.iban}</span>، واذكر رقم العقد في بيان التحويل.</>
          ) : (
            <>يتم السداد بالتحويل البنكي إلى حساب <b>{orgRow?.name}</b> مع ذكر رقم العقد في بيان التحويل، ثم إرسال صورة الإيصال للمكتب{orgRow?.phone ? ` (${orgRow.phone})` : ""}. تُسجَّل الدفعة هنا خلال يوم عمل.</>
          )}
        </Alert>
      </div>

      <Tabs tabs={TABS} active={tab} base="/tenant/payments" />

      {tab === "installments" && (
        <Card padded={false}>
          {installments.length === 0 ? (
            <EmptyState title="لا توجد أقساط" description="لا يوجد جدول دفعات مرتبط بحسابك." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>العقد</th>
                  <th>الوحدة</th>
                  <th>#</th>
                  <th>الاستحقاق</th>
                  <th>المبلغ</th>
                  <th>المسدد</th>
                  <th>المتبقي</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {installments.map((i) => (
                  <tr key={i.id}>
                    <td className="latin">{i.contract.code}</td>
                    <td>{i.contract.property.name} — {i.contract.unit.number}</td>
                    <td className="num">{i.seq}</td>
                    <td className="num">
                      {date(i.dueDate)}
                      {["OVERDUE", "PARTIALLY_PAID"].includes(i.status) && daysOverdue(i.dueDate) > 0 && <span className="mr-1 text-[11px] text-danger">(متأخر {daysOverdue(i.dueDate)} يوم)</span>}
                    </td>
                    <td className="num">{money(i.amount)}</td>
                    <td className="num">{money(i.paidAmount)}</td>
                    <td className="num font-bold">{money(Math.max(0, i.amount - i.paidAmount))}</td>
                    <td><StatusTag value={i.status} map={INSTALLMENT_STATUS} /></td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {tab === "payments" && (
        <Card padded={false} subtitle={`${num(payments.length)} دفعة`}>
          {payments.length === 0 ? (
            <EmptyState title="لا توجد دفعات مسجلة بعد" description="بعد التحويل وإرسال صورة الإيصال، يسجل المكتب الدفعة وتظهر هنا مع إيصال للطباعة." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>رقم الدفعة</th>
                  <th>التاريخ</th>
                  <th>العقد</th>
                  <th>المبلغ</th>
                  <th>الطريقة</th>
                  <th>المرجع</th>
                  <th>مخصصة للأقساط</th>
                  <th>الحالة</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="latin">{p.code}</td>
                    <td className="num">{date(p.paidAt)}</td>
                    <td className="latin">{p.contract?.code ?? "—"}</td>
                    <td className="num font-bold">{money(p.amount)}</td>
                    <td>{PAYMENT_METHODS[p.method] ?? p.method}</td>
                    <td className="latin text-[12px]">{p.reference ?? "—"}</td>
                    <td className="num text-[12px]">{p.allocations.length ? p.allocations.map((a) => `#${a.installment.seq}`).join("، ") : "—"}</td>
                    <td><StatusTag value={p.status} map={PAYMENT_STATUS} /></td>
                    <td>
                      {["RECORDED", "APPROVED"].includes(p.status) && (
                        <Link href={`/tenant/payments/${p.id}`} className="btn btn-ghost btn-sm min-h-[40px]">الإيصال</Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}
    </>
  );
}
