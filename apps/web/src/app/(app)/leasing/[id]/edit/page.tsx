import { notFound, redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertCan, isScoped, propertyIdScope } from "@/lib/permissions";
import { PageHeader } from "@/components/ui";
import { LeadForm } from "../../LeadForm";
import { updateLead } from "../../actions";

export const dynamic = "force-dynamic";

export default async function EditLeadPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaff();
  assertCan(user, "leasing.manage");
  const { id } = await params;
  const org = user.organizationId;
  const lead = await db.lead.findFirst({
    where: { id, organizationId: org, ...(isScoped(user) ? { OR: [{ unitId: null }, { unit: { propertyId: { in: user.assignedPropertyIds } } }] } : {}) },
  });
  if (!lead) notFound();
  if (lead.stage === "RENTED") redirect(`/leasing/${id}`);
  const [units, users] = await Promise.all([
    db.unit.findMany({
      where: { organizationId: org, ...propertyIdScope(user), OR: [{ status: { in: ["VACANT", "AVAILABLE", "RESERVED"] } }, ...(lead.unitId ? [{ id: lead.unitId }] : [])] },
      select: { id: true, number: true, targetRent: true, property: { select: { name: true } } },
      orderBy: [{ property: { name: "asc" } }, { number: "asc" }],
    }),
    db.user.findMany({ where: { organizationId: org, role: { in: ["OFFICE_MANAGER", "PROPERTY_MANAGER", "LEASING"] }, status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const plain = JSON.parse(JSON.stringify(lead));
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={`تعديل: ${lead.name}`} breadcrumbs={[{ label: "التأجير", href: "/leasing" }, { label: lead.name, href: `/leasing/${id}` }, { label: "تعديل" }]} />
      <LeadForm action={updateLead} lead={plain} units={units.map((u) => ({ id: u.id, label: `${u.number} — ${u.property.name}${u.targetRent ? ` (${u.targetRent} ر.س)` : ""}` }))} users={users} />
    </div>
  );
}
