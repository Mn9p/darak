import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { datetime, safeJson, pageParam } from "@/lib/format";
import { PageHeader, Card, Table, StatusTag, EmptyState, Pagination, Tag, StatGrid, StatCard } from "@/components/ui";
import { GuideCard } from "@/components/GuideCard";
import { IMPORT_ENTITIES, IMPORT_JOB_STATUS } from "./spec";
import { ImportCenter } from "./ImportWizard";

export const dynamic = "force-dynamic";
const PAGE = 15;

export default async function ImportPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireStaff();
  if (!can(user, "import.manage")) redirect("/forbidden");
  const sp = await searchParams;
  const org = user.organizationId;
  const page = pageParam(sp.page);
  const where = { organizationId: org };

  const [total, jobs, agg] = await Promise.all([
    db.importJob.count({ where }),
    db.importJob.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE, include: { user: { select: { name: true } } } }),
    db.importJob.aggregate({ where, _sum: { totalRows: true, successRows: true, failedRows: true } }),
  ]);

  return (
    <>
      <PageHeader title="الاستيراد" subtitle="انقل بياناتك من Excel أو CSV. يُتحقق من كل صف قبل الحفظ." />

      <GuideCard
        id="import"
        show={total === 0}
        title="الاستيراد: انقل بياناتك من Excel بدل الإدخال اليدوي"
        steps={[
          "نزّل قالب CSV للنوع الذي تريده: ملاك، عقارات، وحدات، مستأجرون، عقود.",
          "عبّئه بنفس الأعمدة ثم ارفعه من الأسفل.",
          "يُتحقق من كل صف قبل الحفظ، وتُعرض الأخطاء دون إهمال أي صف.",
        ]}
        note="الترتيب المفيد: الملاك ثم العقارات ثم الوحدات ثم المستأجرون ثم العقود."
        secondary={{ href: "/help", label: "مركز المساعدة" }}
      />

      <StatGrid cols={4}>
        <StatCard label="عمليات الاستيراد" value={<span className="num">{total}</span>} />
        <StatCard label="الصفوف" value={<span className="num">{agg._sum.totalRows ?? 0}</span>} />
        <StatCard label="ناجحة" value={<span className="num">{agg._sum.successRows ?? 0}</span>} tone="success" />
        <StatCard label="لم تُحفظ" value={<span className="num">{agg._sum.failedRows ?? 0}</span>} tone={(agg._sum.failedRows ?? 0) > 0 ? "danger" : undefined} />
      </StatGrid>

      <div className="mt-4 space-y-4">
        <ImportCenter initial={sp.type} />

        <Card title="سجل الاستيراد" padded={false}>
          {jobs.length === 0 ? (
            <EmptyState title="لا توجد عمليات استيراد بعد" description="اختر نوع البيانات من الأعلى وارفع الملف." />
          ) : (
            <>
              <Table>
                <thead>
                  <tr>
                    <th>الملف</th>
                    <th>النوع</th>
                    <th className="num">الصفوف</th>
                    <th>الحالة</th>
                    <th>التاريخ</th>
                    <th>الأخطاء</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j) => {
                    const errs = safeJson<{ row: number; message: string }[]>(j.errors, []);
                    return (
                      <tr key={j.id}>
                        <td className="latin cell-primary">{j.fileName}</td>
                        <td>{IMPORT_ENTITIES[j.entityType]?.label ?? j.entityType}</td>
                        <td className="num">
                          {j.totalRows}
                          <div className="cell-sub num">
                            <span className="text-success">{j.successRows} ناجح</span>
                            {j.failedRows > 0 && <span className="text-danger"> · {j.failedRows} فشل</span>}
                          </div>
                        </td>
                        <td>
                          <StatusTag value={j.status} map={IMPORT_JOB_STATUS} />
                        </td>
                        <td className="whitespace-nowrap">
                          <span className="num text-muted">{datetime(j.createdAt)}</span>
                          <div className="cell-sub">{j.user?.name ?? "—"}</div>
                        </td>
                        <td>
                          {errs.length ? (
                            <details>
                              <summary className="cursor-pointer">
                                <Tag tone="danger" plain>
                                  {errs.length} خطأ
                                </Tag>
                              </summary>
                              <ul className="mt-2 max-h-40 max-w-[360px] space-y-1 overflow-auto text-[12px] text-danger">
                                {errs.map((e, i) => (
                                  <li key={i}>
                                    <b className="num">الصف {e.row}:</b> {e.message}
                                  </li>
                                ))}
                              </ul>
                            </details>
                          ) : (
                            <span className="text-faint">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
              <Pagination page={page} pageSize={PAGE} total={total} base="/import" params={sp} />
            </>
          )}
        </Card>
      </div>
    </>
  );
}
