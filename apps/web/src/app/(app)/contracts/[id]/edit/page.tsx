import { notFound, redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertCan, can, propertyScope, propertyIdScope } from "@/lib/permissions";
import { PageHeader, Alert } from "@/components/ui";
import { ContractForm } from "../../ContractForm";
import { updateContract } from "../../actions";

export const dynamic = "force-dynamic";

export default async function EditContractPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaff();
  assertCan(user, "contracts.manage");
  const { id } = await params;
  const org = user.organizationId;
  const contract = await db.contract.findFirst({ where: { id, organizationId: org, ...propertyIdScope(user) } });
  if (!contract) notFound();
  if (!["DRAFT", "PENDING_APPROVAL"].includes(contract.status)) redirect(`/contracts/${id}`);

  const [properties, units, tenants, owners] = await Promise.all([
    db.property.findMany({
      where: { organizationId: org, ...propertyScope(user), OR: [{ status: { not: "ARCHIVED" } }, { id: contract.propertyId }] },
      select: { id: true, name: true, ownerships: { where: { endDate: null }, orderBy: { percentage: "desc" }, take: 1, select: { ownerId: true, owner: { select: { managementFeePct: true } } } } },
      orderBy: { name: "asc" },
    }),
    db.unit.findMany({ where: { organizationId: org, ...propertyIdScope(user), OR: [{ status: { not: "ARCHIVED" } }, { id: contract.unitId }] }, select: { id: true, number: true, propertyId: true, status: true, targetRent: true }, orderBy: { number: "asc" } }),
    db.tenant.findMany({ where: { organizationId: org, OR: [{ status: { not: "ARCHIVED" } }, { id: contract.tenantId }] }, select: { id: true, name: true, phone: true }, orderBy: { name: "asc" } }),
    db.owner.findMany({ where: { organizationId: org, OR: [{ status: { not: "ARCHIVED" } }, { id: contract.ownerId }] }, select: { id: true, name: true, managementFeePct: true }, orderBy: { name: "asc" } }),
  ]);
  const plain = JSON.parse(JSON.stringify(contract));
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={`تعديل العقد ${contract.code}`} breadcrumbs={[{ label: "العقود", href: "/contracts" }, { label: contract.code, href: `/contracts/${id}` }, { label: "تعديل" }]} />
      {contract.status === "PENDING_APPROVAL" && (
        <div className="mb-4">
          <Alert tone="warning">هذا العقد بانتظار الاعتماد. سيبقى بنفس الحالة بعد الحفظ.</Alert>
        </div>
      )}
      <ContractForm
        action={updateContract}
        contract={plain}
        properties={properties.map((p) => ({ id: p.id, name: p.name, ownerId: p.ownerships[0]?.ownerId ?? null, ownerFeePct: p.ownerships[0]?.owner.managementFeePct ?? null }))}
        units={units}
        tenants={tenants}
        owners={owners}
        canApprove={can(user, "contracts.approve")}
        canCreateTenant={can(user, "tenants.manage")}
      />
    </div>
  );
}
