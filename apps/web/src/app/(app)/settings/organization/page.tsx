import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { PageHeader } from "@/components/ui";
import { OrganizationForm } from "../OrganizationForm";
import { readSettings } from "../lib";

export const dynamic = "force-dynamic";

export default async function OrganizationSettingsPage() {
  const user = await requireStaff();
  if (!can(user, "settings.manage")) redirect("/forbidden");
  const [org, settings] = await Promise.all([db.organization.findUnique({ where: { id: user.organizationId } }), readSettings(user.organizationId)]);
  if (!org) redirect("/login");
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="ملف المكتب والسياسات" subtitle="بيانات المكتب وحدود الاعتماد وسياسات التحصيل." breadcrumbs={[{ label: "الإعدادات", href: "/settings" }, { label: "ملف المكتب" }]} />
      <OrganizationForm
        org={{ name: org.name, crNumber: org.crNumber, vatNumber: org.vatNumber, phone: org.phone, email: org.email, city: org.city }}
        settings={{
          autoApproveLimit: settings.autoApproveLimit,
          managerApprovalLimit: settings.managerApprovalLimit,
          graceDays: settings.graceDays,
          dueSoonDays: settings.dueSoonDays,
          vatRate: settings.vatRate,
          contractExpiryAlerts: settings.contractExpiryAlerts,
          documentExpiryAlerts: settings.documentExpiryAlerts,
        }}
      />
    </div>
  );
}
