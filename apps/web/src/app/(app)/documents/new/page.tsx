import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { PageHeader } from "@/components/ui";
import { DocumentForm } from "../DocumentForm";
import { createDocument } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewDocumentPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireStaff();
  if (!can(user, "documents.manage")) redirect("/forbidden");
  const sp = await searchParams;
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="رفع مستند" breadcrumbs={[{ label: "المستندات", href: "/documents" }, { label: "مستند جديد" }]} subtitle={sp.entityLabel ? `مرتبط بـ: ${sp.entityLabel}` : undefined} />
      <DocumentForm action={createDocument} prefill={{ entityType: sp.entityType, entityId: sp.entityId, entityLabel: sp.entityLabel }} />
    </div>
  );
}
