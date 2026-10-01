import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertCan } from "@/lib/permissions";
import { STAFF_ROLES } from "@/lib/constants";
import { PageHeader } from "@/components/ui";
import { TeamForm } from "../../TeamForm";
import { updateEmployee } from "../../actions";

export const dynamic = "force-dynamic";

export default async function EditMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaff();
  assertCan(user, "employees.manage");
  const { id } = await params;
  const org = user.organizationId;
  const member = await db.user.findFirst({
    where: { id, organizationId: org, role: { in: STAFF_ROLES } },
    select: { id: true, name: true, phone: true, email: true, role: true, permissions: true, allProperties: true, status: true, branchId: true, department: true, jobTitle: true, employeeCode: true, managerId: true, preferences: true, assignments: { select: { propertyId: true } } },
  });
  if (!member) notFound();
  const [branches, managers, properties] = await Promise.all([
    db.branch.findMany({ where: { organizationId: org }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.user.findMany({ where: { organizationId: org, role: { in: STAFF_ROLES }, status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.property.findMany({ where: { organizationId: org, status: { not: "ARCHIVED" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const { assignments, ...rest } = member;
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={`تعديل: ${member.name}`} breadcrumbs={[{ label: "فريق العمل", href: "/employees" }, { label: member.name, href: `/employees/${id}` }, { label: "تعديل" }]} />
      <TeamForm action={updateEmployee} member={rest} branches={branches} managers={managers} properties={properties} assignedPropertyIds={assignments.map((a) => a.propertyId)} isSelf={member.id === user.id} />
    </div>
  );
}
