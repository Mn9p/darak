import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertCan } from "@/lib/permissions";
import { STAFF_ROLES } from "@/lib/constants";
import { PageHeader } from "@/components/ui";
import { EmployeeForm } from "../../EmployeeForm";
import { updateEmployee } from "../../actions";

export const dynamic = "force-dynamic";

export default async function EditEmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaff();
  assertCan(user, "employees.manage");
  const { id } = await params;
  const org = user.organizationId;
  const employee = await db.user.findFirst({ where: { id, organizationId: org, role: { in: STAFF_ROLES } }, include: { assignments: { select: { propertyId: true } } } });
  if (!employee) notFound();
  const [branches, managers, properties] = await Promise.all([
    db.branch.findMany({ where: { organizationId: org }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.user.findMany({ where: { organizationId: org, role: { in: STAFF_ROLES }, status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.property.findMany({ where: { organizationId: org, status: { not: "ARCHIVED" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const { assignments, ...rest } = employee;
  const plain = JSON.parse(JSON.stringify(rest));
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={`تعديل: ${employee.name}`} breadcrumbs={[{ label: "الموظفون", href: "/employees" }, { label: employee.name, href: `/employees/${id}` }, { label: "تعديل" }]} />
      <EmployeeForm action={updateEmployee} employee={plain} branches={branches} managers={managers} properties={properties} assignedPropertyIds={assignments.map((a) => a.propertyId)} isSelf={employee.id === user.id} />
    </div>
  );
}
