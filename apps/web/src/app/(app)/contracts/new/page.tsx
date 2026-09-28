import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertCan, can, propertyScope, propertyIdScope } from "@/lib/permissions";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { ContractForm } from "../ContractForm";
import { createContract } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewContractPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireStaff();
  assertCan(user, "contracts.manage");
  const sp = await searchParams;
  const org = user.organizationId;
  const [properties, units, tenants, owners] = await Promise.all([
    db.property.findMany({
      where: { organizationId: org, status: { not: "ARCHIVED" }, ...propertyScope(user) },
      select: { id: true, name: true, ownerships: { where: { endDate: null }, orderBy: { percentage: "desc" }, take: 1, select: { ownerId: true, owner: { select: { managementFeePct: true } } } } },
      orderBy: { name: "asc" },
    }),
    db.unit.findMany({ where: { organizationId: org, status: { not: "ARCHIVED" }, ...propertyIdScope(user) }, select: { id: true, number: true, propertyId: true, status: true, targetRent: true }, orderBy: { number: "asc" } }),
    db.tenant.findMany({ where: { organizationId: org, status: { not: "ARCHIVED" } }, select: { id: true, name: true, phone: true }, orderBy: { name: "asc" } }),
    db.owner.findMany({ where: { organizationId: org, status: { not: "ARCHIVED" } }, select: { id: true, name: true, managementFeePct: true }, orderBy: { name: "asc" } }),
  ]);

  // A contract needs a property and a unit that is not already rented. Without them the form cannot be submitted,
  // so send the user to the step that is actually missing instead of showing empty selects.
  const availableUnits = units.filter((u) => u.status !== "RENTED");
  const blocked = properties.length === 0 || availableUnits.length === 0;
  if (blocked) {
    const noProperty = properties.length === 0;
    const targetProperty = properties.find((p) => p.id === sp.propertyId) ?? properties[0];
    const href = noProperty ? "/properties/new" : `/units/new?propertyId=${targetProperty.id}`;
    return (
      <div className="mx-auto max-w-5xl">
        <PageHeader title="عقد جديد" breadcrumbs={[{ label: "العقود", href: "/contracts" }, { label: "عقد جديد" }]} />
        <Card padded={false}>
          <EmptyState
            title="أضف عقارًا ووحدة أولًا"
            description={noProperty ? "العقد يُربط بوحدة داخل عقار. سجّل العقار ثم وحداته، وبعدها أنشئ العقد." : "كل الوحدات المسجلة مؤجرة حاليًا. أضف وحدة غير مؤجرة ثم أنشئ العقد."}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Link href={href} className="btn btn-primary">
                  {noProperty ? "إضافة عقار" : "إضافة وحدة"}
                </Link>
                <Link href="/contracts" className="btn btn-ghost">
                  العودة إلى العقود
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
      <PageHeader title="عقد جديد" breadcrumbs={[{ label: "العقود", href: "/contracts" }, { label: "عقد جديد" }]} />
      <ContractForm
        action={createContract}
        properties={properties.map((p) => ({ id: p.id, name: p.name, ownerId: p.ownerships[0]?.ownerId ?? null, ownerFeePct: p.ownerships[0]?.owner.managementFeePct ?? null }))}
        units={units}
        tenants={tenants}
        owners={owners}
        prefill={{ propertyId: sp.propertyId, unitId: sp.unitId, tenantId: sp.tenantId, tenantName: sp.tenantName, phone: sp.phone, leadId: sp.leadId, totalAmount: sp.totalAmount }}
        canApprove={can(user, "contracts.approve")}
        canCreateTenant={can(user, "tenants.manage")}
      />
    </div>
  );
}
