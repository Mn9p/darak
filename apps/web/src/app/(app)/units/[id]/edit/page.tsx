import { notFound, redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, propertyIdScope, propertyScope } from "@/lib/permissions";
import { PageHeader, Alert } from "@/components/ui";
import { UnitForm } from "../../UnitForm";
import { updateUnit } from "../../actions";

export const dynamic = "force-dynamic";

export default async function EditUnitPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaff();
  if (!can(user, "units.manage")) redirect("/forbidden");
  const { id } = await params;
  const org = user.organizationId;
  const unit = await db.unit.findFirst({
    where: { id, organizationId: org, ...propertyIdScope(user) },
    include: { property: { select: { id: true, name: true } }, _count: { select: { contracts: { where: { status: { in: ["ACTIVE", "EXPIRING_SOON", "RENEWAL_PENDING"] } } } } } },
  });
  if (!unit) notFound();
  const properties = await db.property.findMany({ where: { organizationId: org, ...propertyScope(user), status: { not: "ARCHIVED" } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const plain = JSON.parse(JSON.stringify(unit));

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={`تعديل الوحدة ${unit.number}`}
        subtitle={unit.property.name}
        breadcrumbs={[{ label: "الوحدات", href: "/units" }, { label: unit.number, href: `/units/${id}` }, { label: "تعديل" }]}
      />
      {unit.status === "ARCHIVED" && (
        <div className="mb-4">
          <Alert tone="warning">الوحدة مؤرشفة — استعدها من صفحة الوحدة قبل التعديل.</Alert>
        </div>
      )}
      <UnitForm action={updateUnit} unit={plain} properties={properties} hasActiveContract={unit._count.contracts > 0} />
    </div>
  );
}
