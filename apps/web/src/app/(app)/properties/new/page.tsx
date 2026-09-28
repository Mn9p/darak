import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { PropertyForm } from "../PropertyForm";
import { createProperty } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewPropertyPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireRole(["OFFICE_MANAGER", "PROPERTY_MANAGER"]);
  const sp = await searchParams;
  const org = user.organizationId;
  const [branches, managers, owners] = await Promise.all([
    db.branch.findMany({ where: { organizationId: org }, select: { id: true, name: true } }),
    db.user.findMany({ where: { organizationId: org, role: { in: ["OFFICE_MANAGER", "PROPERTY_MANAGER"] }, status: "ACTIVE" }, select: { id: true, name: true } }),
    db.owner.findMany({ where: { organizationId: org, status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  // Coming from an owner's page (?ownerId=): pre-select that owner at 100%.
  const prefillOwner = sp.ownerId ? owners.find((o) => o.id === sp.ownerId) : undefined;
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="إضافة عقار"
        subtitle={prefillOwner ? `سيُربط العقار بالمالك: ${prefillOwner.name}` : undefined}
        breadcrumbs={prefillOwner ? [{ label: "الملاك", href: "/owners" }, { label: prefillOwner.name, href: `/owners/${prefillOwner.id}` }, { label: "عقار جديد" }] : [{ label: "العقارات", href: "/properties" }, { label: "عقار جديد" }]}
      />
      <PropertyForm action={createProperty} branches={branches} managers={managers} owners={owners} ownerships={prefillOwner ? [{ ownerId: prefillOwner.id, percentage: 100 }] : undefined} />
    </div>
  );
}
