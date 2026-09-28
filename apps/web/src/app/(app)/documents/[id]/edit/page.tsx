import { notFound, redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { inputDate } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { DocumentForm } from "../../DocumentForm";
import { updateDocument } from "../../actions";

export const dynamic = "force-dynamic";

export default async function EditDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaff();
  if (!can(user, "documents.manage")) redirect("/forbidden");
  const { id } = await params;
  const d = await db.document.findFirst({ where: { id, organizationId: user.organizationId } });
  if (!d) notFound();
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={`تعديل: ${d.name}`} breadcrumbs={[{ label: "المستندات", href: "/documents" }, { label: d.name, href: `/documents/${d.id}` }, { label: "تعديل" }]} />
      <DocumentForm action={updateDocument} document={{ ...d, issueDate: inputDate(d.issueDate), expiryDate: inputDate(d.expiryDate), createdAt: undefined }} />
    </div>
  );
}
