import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { PageHeader, Card, Table, EmptyState, Tag, ActionButton } from "@/components/ui";
import { BranchForm } from "../BranchForm";
import { createBranch, updateBranch, setMainBranch } from "../actions";

export const dynamic = "force-dynamic";

export default async function BranchesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireStaff();
  if (!can(user, "settings.manage")) redirect("/forbidden");
  const sp = await searchParams;
  const org = user.organizationId;
  const branches = await db.branch.findMany({ where: { organizationId: org }, orderBy: [{ isMain: "desc" }, { createdAt: "asc" }], include: { _count: { select: { users: true, properties: true } } } });
  const editing = sp.edit ? branches.find((b) => b.id === sp.edit) ?? null : null;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="الفروع" subtitle="اربط الموظفين والعقارات بفرع محدد." breadcrumbs={[{ label: "الإعدادات", href: "/settings" }, { label: "الفروع" }]} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="الفروع" className="lg:col-span-2" padded={false}>
          {branches.length === 0 ? (
            <EmptyState title="لا توجد فروع بعد" description="أضف الفرع الرئيسي من النموذج المجاور." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>الفرع</th>
                  <th>المدينة</th>
                  <th className="num">الموظفون</th>
                  <th className="num">العقارات</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {branches.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <span className="cell-primary">{b.name}</span>{" "}
                      {b.isMain && (
                        <Tag tone="brand" plain>
                          رئيسي
                        </Tag>
                      )}
                      {b.address && <div className="cell-sub">{b.address}</div>}
                    </td>
                    <td>
                      {b.city ?? "—"}
                      {b.phone && <div className="cell-sub num">{b.phone}</div>}
                    </td>
                    <td className="num">{b._count.users}</td>
                    <td className="num">{b._count.properties}</td>
                    <td className="whitespace-nowrap">
                      <Link className="btn btn-ghost btn-xs" href={`/settings/branches?edit=${b.id}`}>
                        تعديل
                      </Link>
                      {!b.isMain && (
                        <ActionButton action={setMainBranch} hidden={{ id: b.id }} className="btn btn-link btn-xs">
                          تعيين كرئيسي
                        </ActionButton>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card title={editing ? `تعديل: ${editing.name}` : "إضافة فرع"}>
          <BranchForm key={editing?.id ?? "new"} action={editing ? updateBranch : createBranch} branch={editing} />
        </Card>
      </div>
    </div>
  );
}
