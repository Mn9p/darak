import { requireSuperAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { datetime } from "@/lib/format";
import { localPhone } from "@/lib/phone";
import { PageHeader } from "@/components/ui";
import { OrgForm, type OrgPrefill } from "../OrgForm";
import { createOrganization } from "../../actions";

export const dynamic = "force-dynamic";

export default async function NewOrganizationPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireSuperAdmin();
  const sp = await searchParams;

  // Coming from /admin/requests: prefill the office and its first manager from the access request.
  let prefill: OrgPrefill | undefined;
  if (sp.requestId) {
    const r = await db.accessRequest.findUnique({ where: { id: sp.requestId } });
    if (r && r.status !== "CONVERTED") {
      prefill = {
        requestId: r.id,
        requestedAt: datetime(r.createdAt),
        name: r.company,
        city: r.city ?? undefined,
        phone: localPhone(r.phone),
        managerName: r.name,
        managerPhone: localPhone(r.phone),
      };
    }
  }

  return (
    <>
      <PageHeader
        title="مكتب جديد"
        subtitle="يُنشأ المكتب مع فرع رئيسي، ومدير مكتب، وقواعد التنبيهات الافتراضية، وسجلات التكاملات (غير متصلة)"
        breadcrumbs={prefill ? [{ label: "طلبات الحسابات", href: "/admin/requests" }, { label: "مكتب جديد" }] : [{ label: "العملاء", href: "/admin/organizations" }, { label: "جديد" }]}
      />
      <div className="max-w-4xl">
        <OrgForm action={createOrganization} prefill={prefill} />
      </div>
    </>
  );
}
