import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { propertyScope } from "@/lib/permissions";
import { PageHeader } from "@/components/ui";
import { PropertyForm } from "../../PropertyForm";
import { updateProperty } from "../../actions";
import { teamWith } from "@/lib/team";

export default async function EditPropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("properties.manage");
  const { id } = await params;
  const org = user.organizationId;
  const property = await db.property.findFirst({ where: { id, organizationId: org, ...propertyScope(user) }, include: { ownerships: { where: { endDate: null } } } });
  if (!property) notFound();
  const [branches, managers, owners] = await Promise.all([
    db.branch.findMany({ where: { organizationId: org }, select: { id: true, name: true } }),
    teamWith(org, "properties.manage"),
    db.owner.findMany({ where: { organizationId: org, status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const plain = JSON.parse(JSON.stringify(property));
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={`تعديل: ${property.name}`} breadcrumbs={[{ label: "العقارات", href: "/properties" }, { label: property.name, href: `/properties/${id}` }, { label: "تعديل" }]} />
      <PropertyForm action={updateProperty} property={plain} branches={branches} managers={managers} owners={owners} ownerships={property.ownerships.map((o) => ({ ownerId: o.ownerId, percentage: o.percentage }))} />
    </div>
  );
}
