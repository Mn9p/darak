import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, propertyScope } from "@/lib/permissions";
import Link from "next/link";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { UnitForm } from "../UnitForm";
import { createUnit } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewUnitPage({ searchParams }: { searchParams: Promise<{ propertyId?: string }> }) {
  const user = await requireStaff();
  if (!can(user, "units.manage")) redirect("/forbidden");
  const { propertyId } = await searchParams;
  const org = user.organizationId;
  const properties = await db.property.findMany({ where: { organizationId: org, ...propertyScope(user), status: { not: "ARCHIVED" } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const prefill = propertyId && properties.some((p) => p.id === propertyId) ? properties.find((p) => p.id === propertyId)! : null;

  if (properties.length === 0) {
    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader title="إضافة وحدة" breadcrumbs={[{ label: "الوحدات", href: "/units" }, { label: "وحدة جديدة" }]} />
        <Card padded={false}>
          <EmptyState
            title="أضف العقار أولًا"
            description="كل وحدة تتبع عقارًا. سجّل العقار ثم أضف وحداته واحدة أو كنطاق أرقام."
            action={
              can(user, "properties.manage") ? (
                <Link href="/properties/new" className="btn btn-primary">
                  إضافة عقار
                </Link>
              ) : (
                <Link href="/properties" className="btn btn-outline">
                  العقارات
                </Link>
              )
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="إضافة وحدة"
        subtitle={prefill ? `ستُضاف الوحدة إلى العقار: ${prefill.name}` : undefined}
        breadcrumbs={
          prefill
            ? [{ label: "العقارات", href: "/properties" }, { label: prefill.name, href: `/properties/${prefill.id}` }, { label: "وحدة جديدة" }]
            : [{ label: "الوحدات", href: "/units" }, { label: "وحدة جديدة" }]
        }
      />
      <UnitForm action={createUnit} properties={properties} unit={prefill ? { propertyId: prefill.id } : null} />
    </div>
  );
}
