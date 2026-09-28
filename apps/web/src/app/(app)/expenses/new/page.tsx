import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertCan, propertyScope } from "@/lib/permissions";
import { getOrgSettings } from "@/lib/engine";
import { PageHeader } from "@/components/ui";
import { ExpenseForm } from "../ExpenseForm";
import { createExpense } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewExpensePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireStaff();
  assertCan(user, "expenses.manage");
  const sp = await searchParams;
  const org = user.organizationId;
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
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="تسجيل مصروف" breadcrumbs={[{ label: "المصروفات", href: "/expenses" }, { label: "مصروف جديد" }]} />
      <ExpenseForm
        action={createExpense}
        properties={properties.map((p) => ({ id: p.id, name: p.name, ownerId: p.ownerships[0]?.ownerId ?? null, units: p.units }))}
        owners={owners}
        vatRate={settings.vatRate}
        autoApproveLimit={settings.autoApproveLimit}
        defaultPropertyId={sp.propertyId}
      />
    </div>
  );
}
