import { notFound, redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, isScoped } from "@/lib/permissions";
import { PageHeader, Alert } from "@/components/ui";
import { OwnerForm } from "../../OwnerForm";
import { updateOwner } from "../../actions";

export const dynamic = "force-dynamic";

export default async function EditOwnerPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaff();
  if (!can(user, "owners.manage")) redirect("/forbidden");
  const { id } = await params;
  const org = user.organizationId;
  const scope = isScoped(user) ? { ownerships: { some: { propertyId: { in: user.assignedPropertyIds } } } } : {};
  const owner = await db.owner.findFirst({ where: { id, organizationId: org, ...scope } });
  if (!owner) notFound();
  const managers = await db.user.findMany({
    where: { organizationId: org, status: "ACTIVE", role: { in: ["OFFICE_MANAGER", "PROPERTY_MANAGER", "ACCOUNTANT", "LEASING"] } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const canFinancial = can(user, "owners.financial");
  const plain = JSON.parse(JSON.stringify({ ...owner, iban: canFinancial ? owner.iban : null, bankName: canFinancial ? owner.bankName : null }));

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={`تعديل: ${owner.name}`} breadcrumbs={[{ label: "الملاك", href: "/owners" }, { label: owner.name, href: `/owners/${id}` }, { label: "تعديل" }]} />
      {owner.status === "ARCHIVED" && (
        <div className="mb-4">
          <Alert tone="warning">المالك مؤرشف — استعده من صفحة المالك قبل التعديل.</Alert>
        </div>
      )}
      <OwnerForm action={updateOwner} owner={plain} managers={managers} canFinancial={canFinancial} />
    </div>
  );
}
