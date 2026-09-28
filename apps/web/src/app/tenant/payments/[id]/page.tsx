import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, date, datetime } from "@/lib/format";
import { PAYMENT_METHODS, PAYMENT_STATUS } from "@/lib/constants";
import { PageHeader, Card, Table, StatusTag, DL, Alert } from "@/components/ui";
import { PrintHeader, PrintStyles } from "@/components/PrintHeader";
import { PrintButton } from "../../PrintButton";

export const dynamic = "force-dynamic";

export default async function TenantReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireTenant();
  const { id } = await params;
  const p = await db.payment.findFirst({
    where: { id, organizationId: user.organizationId, tenantId: user.tenantId },
    include: {
      tenant: { select: { name: true } },
      contract: { select: { code: true, unit: { select: { number: true } }, property: { select: { name: true } } } },
      allocations: { include: { installment: { select: { seq: true, dueDate: true, amount: true } } } },
      organization: { select: { name: true, phone: true, email: true, vatNumber: true, crNumber: true, city: true } },
    },
  });
  if (!p) notFound();
  const voided = ["REVERSED", "RETURNED"].includes(p.status);
  const orgMeta = [
    p.organization.city,
    p.organization.phone,
    p.organization.crNumber ? `س.ت ${p.organization.crNumber}` : null,
    p.organization.vatNumber ? `الرقم الضريبي ${p.organization.vatNumber}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <PrintStyles />
      <div className="no-print">
        <PageHeader
          title={<span>إيصال الدفعة <span className="latin">{p.code}</span></span>}
          breadcrumbs={[{ label: "الدفعات", href: "/tenant/payments?tab=payments" }, { label: p.code }]}
          actions={
            <>
              <Link href="/tenant/payments?tab=payments" className="btn btn-ghost btn-sm">رجوع</Link>
              <PrintButton />
            </>
          }
        />
        {voided && (
          <div className="mb-4">
            <Alert tone="danger" title="هذه الدفعة غير سارية">تم عكس الدفعة أو إرجاعها، ولا يُعد هذا الإيصال إثباتًا للسداد.</Alert>
          </div>
        )}
      </div>

      <div className="mx-auto max-w-3xl">
        <Card className="print-sheet">
          <PrintHeader orgName={p.organization.name} orgMeta={orgMeta} title="إيصال استلام دفعة" code={p.code} date={date(p.paidAt)} extra={<StatusTag value={p.status} map={PAYMENT_STATUS} />} />

          <DL
            cols={2}
            items={[
              { label: "استلمنا من", value: p.tenant.name },
              { label: "تاريخ الدفع", value: <span className="num">{date(p.paidAt)}</span> },
              { label: "العقد", value: p.contract ? <span className="latin">{p.contract.code}</span> : "—" },
              { label: "العقار / الوحدة", value: p.contract ? `${p.contract.property.name} — ${p.contract.unit.number}` : "—" },
              { label: "طريقة الدفع", value: PAYMENT_METHODS[p.method] ?? p.method },
              { label: "المرجع / البنك", value: <span className="latin">{[p.reference, p.bank].filter(Boolean).join(" · ") || "—"}</span> },
            ]}
          />

          <div className="card-warm mt-5 flex flex-wrap items-center justify-between gap-2 p-4">
            <span className="text-[14px] font-bold text-brand">المبلغ المستلم</span>
            <span className={`num text-[26px] font-extrabold text-brand ${voided ? "line-through" : ""}`}>
              {money(p.amount, { decimals: true })} <span className="text-sm">ر.س</span>
            </span>
          </div>

          {p.allocations.length > 0 && (
            <div className="mt-5">
              <div className="mb-2 text-[12.5px] font-bold text-muted">تخصيص الدفعة على الأقساط</div>
              <Table>
                <thead>
                  <tr>
                    <th>القسط</th>
                    <th>تاريخ الاستحقاق</th>
                    <th className="num">قيمة القسط</th>
                    <th className="num">المخصص من هذه الدفعة</th>
                  </tr>
                </thead>
                <tbody>
                  {p.allocations.map((a) => (
                    <tr key={a.id}>
                      <td className="num">#{a.installment.seq}</td>
                      <td className="num">{date(a.installment.dueDate)}</td>
                      <td className="num">{money(a.installment.amount, { decimals: true })}</td>
                      <td className="num font-bold">{money(a.amount, { decimals: true })}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-end justify-between gap-3 border-t border-line pt-4 text-[11.5px] text-muted">
            <div>
              <div>صدر إلكترونيًا بتاريخ <span className="num">{datetime(p.createdAt)}</span> ولا يحتاج إلى توقيع.</div>
              <div>هذا الإيصال إثبات لاستلام المبلغ المذكور أعلاه فقط.</div>
            </div>
            <div>دارك · إدارة أملاكك. بصورة أوضح.</div>
          </div>
        </Card>
      </div>
    </>
  );
}
