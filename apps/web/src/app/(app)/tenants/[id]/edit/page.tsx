import { notFound, redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, isScoped } from "@/lib/permissions";
import { PageHeader, Alert } from "@/components/ui";
import { TenantForm } from "../../TenantForm";
import { updateTenant } from "../../actions";

export const dynamic = "force-dynamic";

export default async function EditTenantPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaff();
  if (!can(user, "tenants.manage")) redirect("/forbidden");
  const { id } = await params;
  const scope = isScoped(user) ? { contracts: { some: { propertyId: { in: user.assignedPropertyIds } } } } : {};
  const tenant = await db.tenant.findFirst({ where: { id, organizationId: user.organizationId, ...scope } });
  if (!tenant) notFound();
  const plain = JSON.parse(JSON.stringify(tenant));

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={`تعديل: ${tenant.name}`} breadcrumbs={[{ label: "المستأجرون", href: "/tenants" }, { label: tenant.name, href: `/tenants/${id}` }, { label: "تعديل" }]} />
      {tenant.status === "ARCHIVED" && (
        <div className="mb-4">
          <Alert tone="warning">المستأجر مؤرشف — استعده من صفحة المستأجر قبل التعديل.</Alert>
        </div>
      )}
      <TenantForm action={updateTenant} tenant={plain} />
    </div>
  );
}
