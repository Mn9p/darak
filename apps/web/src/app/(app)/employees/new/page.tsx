import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertCan } from "@/lib/permissions";
import { STAFF_ROLES } from "@/lib/constants";
import { PageHeader, Alert } from "@/components/ui";
import { TeamForm } from "../TeamForm";
import { createEmployee } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewMemberPage() {
  const user = await requireStaff();
  assertCan(user, "employees.manage");
  const org = user.organizationId;
  const [branches, managers, properties, orgRow, staffCount] = await Promise.all([
    db.branch.findMany({ where: { organizationId: org }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.user.findMany({ where: { organizationId: org, role: { in: STAFF_ROLES }, status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.property.findMany({ where: { organizationId: org, status: { not: "ARCHIVED" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.organization.findUnique({ where: { id: org }, select: { usersLimit: true } }),
    db.user.count({ where: { organizationId: org, role: { in: STAFF_ROLES }, status: { not: "INACTIVE" } } }),
  ]);
  const limit = orgRow?.usersLimit ?? 0;
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="إضافة عضو إلى الفريق" subtitle={`المقاعد المستخدمة: ${staffCount} من ${limit} في باقتك.`} breadcrumbs={[{ label: "فريق العمل", href: "/employees" }, { label: "عضو جديد" }]} />
      {staffCount >= limit && (
        <div className="mb-4">
          <Alert tone="warning" title="وصلت لحد المستخدمين">
            عطّل عضوًا غير نشط أو قم بترقية الباقة من الإعدادات لإضافة عضو جديد.
          </Alert>
        </div>
      )}
      <TeamForm action={createEmployee} branches={branches} managers={managers} properties={properties} />
    </div>
  );
}
