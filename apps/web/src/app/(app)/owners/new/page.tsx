import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { PageHeader } from "@/components/ui";
import { OwnerForm } from "../OwnerForm";
import { createOwner } from "../actions";
import { teamWith } from "@/lib/team";

export const dynamic = "force-dynamic";

export default async function NewOwnerPage() {
  const user = await requireStaff();
  if (!can(user, "owners.manage")) redirect("/forbidden");
  const managers = await teamWith(user.organizationId, "owners.view");
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="إضافة مالك" subtitle="بعد الحفظ أضف عقاره من صفحته بزر «إضافة عقار» ويُربط به تلقائيًا." breadcrumbs={[{ label: "الملاك", href: "/owners" }, { label: "مالك جديد" }]} />
      <OwnerForm action={createOwner} managers={managers} canFinancial={can(user, "owners.financial")} />
    </div>
  );
}
