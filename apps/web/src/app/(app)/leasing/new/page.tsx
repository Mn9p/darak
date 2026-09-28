import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertCan, propertyIdScope } from "@/lib/permissions";
import { PageHeader } from "@/components/ui";
import { LeadForm } from "../LeadForm";
import { createLead } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewLeadPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireStaff();
  assertCan(user, "leasing.manage");
  const sp = await searchParams;
  const org = user.organizationId;
  const [units, users] = await Promise.all([
    db.unit.findMany({
      where: { organizationId: org, ...propertyIdScope(user), OR: [{ status: { in: ["VACANT", "AVAILABLE", "RESERVED"] } }, ...(sp.unitId ? [{ id: sp.unitId }] : [])] },
      select: { id: true, number: true, targetRent: true, property: { select: { name: true } } },
      orderBy: [{ property: { name: "asc" } }, { number: "asc" }],
    }),
    db.user.findMany({ where: { organizationId: org, role: { in: ["OFFICE_MANAGER", "PROPERTY_MANAGER", "LEASING"] }, status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="عميل محتمل جديد" breadcrumbs={[{ label: "التأجير", href: "/leasing" }, { label: "عميل جديد" }]} />
      <LeadForm
        action={createLead}
        units={units.map((u) => ({ id: u.id, label: `${u.number} — ${u.property.name}${u.targetRent ? ` (${u.targetRent} ر.س)` : ""}` }))}
        users={users}
        defaults={{ unitId: sp.unitId, assignedToId: user.role === "LEASING" ? user.id : undefined }}
      />
    </div>
  );
}
