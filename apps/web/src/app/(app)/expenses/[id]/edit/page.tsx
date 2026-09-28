import { notFound } from "next/navigation";
import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertCan, can, propertyIdScope, propertyScope } from "@/lib/permissions";
import { getOrgSettings } from "@/lib/engine";
import { inputDate } from "@/lib/format";
import { PageHeader, Alert } from "@/components/ui";
import { ExpenseForm } from "../../ExpenseForm";
import { updateExpense } from "../../actions";

export const dynamic = "force-dynamic";

export default async function EditExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaff();
  assertCan(user, "expenses.manage");
  const { id } = await params;
  const org = user.organizationId;
  const expense = await db.expense.findFirst({ where: { id, organizationId: org, ...propertyIdScope(user) } });
  if (!expense) notFound();

  const locked = expense.approvalStatus === "APPROVED" && !can(user, "expenses.approve");

  const [properties, owners, settings] = await Promise.all([
    db.property.findMany({
      where: { organizationId: org, status: { not: "ARCHIVED" }, ...propertyScope(user) },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        units: { where: { status: { not: "ARCHIVED" } }, orderBy: { number: "asc" }, select: { id: true, number: true } },
        ownerships: { where: { endDate: null }, orderBy: { percentage: "desc" }, take: 1, select: { ownerId: true } },
      },
    }),
    db.owner.findMany({ where: { organizationId: org, status: { not: "ARCHIVED" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    getOrgSettings(org),
  ]);
  const plain = { ...JSON.parse(JSON.stringify(expense)), date: inputDate(expense.date) };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={`تعديل المصروف ${expense.code}`} breadcrumbs={[{ label: "المصروفات", href: "/expenses" }, { label: expense.code, href: `/expenses/${id}` }, { label: "تعديل" }]} />
      {locked ? (
        <Alert tone="warning" title="هذا المصروف معتمد">
          لا يمكن تعديل مصروف معتمد إلا بصلاحية الاعتماد.{" "}
          <Link href={`/expenses/${id}`} className="link">
            العودة إلى المصروف
          </Link>
        </Alert>
      ) : (
        <>
          {expense.approvalStatus === "APPROVED" && <div className="mb-4"><Alert tone="info">هذا المصروف معتمد، وسيُسجل التعديل في سجل العمليات.</Alert></div>}
          <ExpenseForm
            action={updateExpense}
            expense={plain}
            properties={properties.map((p) => ({ id: p.id, name: p.name, ownerId: p.ownerships[0]?.ownerId ?? null, units: p.units }))}
            owners={owners}
            vatRate={settings.vatRate}
            autoApproveLimit={settings.autoApproveLimit}
          />
        </>
      )}
    </div>
  );
}
