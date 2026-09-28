import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { PageHeader } from "@/components/ui";
import { TenantForm } from "../TenantForm";
import { createTenant } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewTenantPage() {
  const user = await requireStaff();
  if (!can(user, "tenants.manage")) redirect("/forbidden");
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="إضافة مستأجر" subtitle="بعد الحفظ يمكنك إنشاء عقد على وحدة لهذا المستأجر." breadcrumbs={[{ label: "المستأجرون", href: "/tenants" }, { label: "مستأجر جديد" }]} />
      <TenantForm action={createTenant} />
    </div>
  );
}
