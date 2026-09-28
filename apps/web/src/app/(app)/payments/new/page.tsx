import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, contractScope } from "@/lib/permissions";
import { inputDate, date } from "@/lib/format";
import Link from "next/link";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { PaymentForm, type OpenInstallment } from "../PaymentForm";
import { createPayment } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewPaymentPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireStaff();
  if (!can(user, "payments.manage")) redirect("/forbidden");
  const sp = await searchParams;
  const org = user.organizationId;

  const [tenants, open] = await Promise.all([
    db.tenant.findMany({ where: { organizationId: org, status: { not: "ARCHIVED" } }, select: { id: true, code: true, name: true, phone: true }, orderBy: { name: "asc" } }),
    db.installment.findMany({
      where: { organizationId: org, status: { notIn: ["PAID", "WAIVED"] }, ...(sp.propertyId ? { contract: { ...(contractScope(user).contract ?? {}), propertyId: sp.propertyId } } : contractScope(user)) },
      orderBy: { dueDate: "asc" },
      select: { id: true, tenantId: true, contractId: true, seq: true, dueDate: true, amount: true, paidAmount: true, status: true, contract: { select: { code: true, unit: { select: { number: true } } } } },
    }),
  ]);

  const installments: OpenInstallment[] = open.map((i) => ({
    id: i.id,
    tenantId: i.tenantId,
    contractId: i.contractId,
    contractCode: i.contract.code,
    unitNumber: i.contract.unit.number,
    seq: i.seq,
    dueDate: inputDate(i.dueDate),
    dueLabel: date(i.dueDate),
    amount: i.amount,
    paidAmount: i.paidAmount,
    status: i.status,
  }));

  // Prefill: from a collection case (?installmentId=&tenantId=) or from a bank transaction (?amount=&reference=&date=).
  let tenantId = sp.tenantId;
  if (sp.installmentId && !tenantId) tenantId = installments.find((i) => i.id === sp.installmentId)?.tenantId;
  const amount = Number(sp.amount ?? 0) || undefined;
  const prefillDate = sp.date && !Number.isNaN(new Date(sp.date).getTime()) ? inputDate(new Date(sp.date)) : inputDate(new Date());

  // Nothing to allocate against: a receipt needs an active contract with an open installment (or at least a tenant).
  if (tenants.length === 0 || (installments.length === 0 && !sp.propertyId)) {
    return (
      <div className="mx-auto max-w-5xl">
        <PageHeader title="تسجيل سند قبض" breadcrumbs={[{ label: "المدفوعات", href: "/payments" }, { label: "سند جديد" }]} />
        <Card padded={false}>
          <EmptyState
            title="لا توجد دفعات مستحقة بعد — أنشئ عقدًا نشطًا أولًا"
            description="تُولَّد الدفعات المستحقة من العقد عند تفعيله، ويُخصَّص سند القبض عليها."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {can(user, "contracts.manage") && (
                  <Link href="/contracts/new" className="btn btn-primary">
                    عقد جديد
                  </Link>
                )}
                <Link href="/payments" className="btn btn-ghost">
                  العودة إلى سندات القبض
                </Link>
              </div>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="تسجيل سند قبض" subtitle="اختر المستأجر وأدخل المبلغ، ويُخصَّص على الأقساط المفتوحة تلقائيًا." breadcrumbs={[{ label: "المدفوعات", href: "/payments" }, { label: "سند جديد" }]} />
      <PaymentForm action={createPayment} tenants={tenants} installments={installments} prefill={{ tenantId, installmentId: sp.installmentId, amount, reference: sp.reference, date: prefillDate }} />
    </div>
  );
}
