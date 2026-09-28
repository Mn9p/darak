import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, isScoped } from "@/lib/permissions";
import { getOrgSettings } from "@/lib/engine";
import { DOCUMENT_TYPES, DOCUMENT_VISIBILITY, ENTITY_TYPES, ENTITY_ROUTES, TASK_STATUS, TASK_PRIORITY, AUDIT_ACTIONS } from "@/lib/constants";
import { date, datetime, daysFromToday, tagsToArray, inputDate, addDays } from "@/lib/format";
import { PageHeader, Card, DL, Tag, StatusTag, ActionButton, EmptyState, Table, Alert, Field, Input, KV } from "@/components/ui";
import { MoreMenu } from "@/components/MoreMenu";
import { uploadVersion, archiveDocument, restoreDocument } from "../actions";

export const dynamic = "force-dynamic";

const FILE_PREFIX = "/api/files/";
const TYPE_LABELS: Record<string, string> = {
  "application/pdf": "PDF",
  "image/jpeg": "صورة JPG",
  "image/png": "صورة PNG",
  "image/webp": "صورة WEBP",
  "image/gif": "صورة GIF",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel (XLSX)",
  "application/vnd.ms-excel": "Excel (XLS)",
  "text/csv": "CSV",
  "application/msword": "Word (DOC)",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word (DOCX)",
};

function sizeLabel(kb: number | null | undefined) {
  if (!kb) return null;
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`;
}

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaff();
  if (!can(user, "documents.view")) redirect("/forbidden");
  const { id } = await params;
  const org = user.organizationId;
  const d = await db.document.findFirst({ where: { id, organizationId: org }, include: { uploadedBy: { select: { id: true, name: true } } } });
  if (!d) notFound();
  if (isScoped(user)) {
    const ok =
      d.uploadedById === user.id ||
      (d.entityType === "PROPERTY" && d.entityId && user.assignedPropertyIds.includes(d.entityId)) ||
      (d.entityType === "UNIT" && d.entityId && (await db.unit.count({ where: { id: d.entityId, propertyId: { in: user.assignedPropertyIds } } })) > 0);
    if (!ok) notFound();
  }

  const hasFile = Boolean(d.url && d.url.startsWith(FILE_PREFIX));
  const fileKey = hasFile ? d.url!.slice(FILE_PREFIX.length) : null;

  const [versions, tasks, activity, settings, stored] = await Promise.all([
    db.document.findMany({ where: { organizationId: org, name: d.name.replace(/^\[مؤرشف\]\s*/, ""), entityType: d.entityType, entityId: d.entityId }, orderBy: { version: "desc" }, include: { uploadedBy: { select: { name: true } } } }),
    db.task.findMany({ where: { organizationId: org, entityType: "DOCUMENT", entityId: d.id }, orderBy: { createdAt: "desc" }, include: { assignedTo: { select: { name: true } } } }),
    db.auditLog.findMany({ where: { organizationId: org, entityType: "DOCUMENT", entityId: d.id }, orderBy: { createdAt: "desc" }, take: 20 }),
    getOrgSettings(org),
    fileKey ? db.storedFile.findFirst({ where: { key: fileKey, organizationId: org }, select: { name: true, contentType: true, sizeBytes: true } }) : Promise.resolve(null),
  ]);
  const archived = d.name.startsWith("[مؤرشف]");
  const left = d.expiryDate ? daysFromToday(d.expiryDate) : null;
  const route = d.entityType ? ENTITY_ROUTES[d.entityType] : null;
  const fileTag = tagsToArray(d.tags).find((t) => t.startsWith("ملف:"));
  const fileName = stored?.name ?? (fileTag ? fileTag.replace("ملف: ", "") : null);
  const tags = tagsToArray(d.tags).filter((t) => !t.startsWith("ملف:") && t !== "archived");
  const alerts = settings.documentExpiryAlerts ?? [90, 60, 30, 7];
  const manage = can(user, "documents.manage");
  const contentType = stored?.contentType ?? null;
  const isImage = Boolean(contentType?.startsWith("image/"));
  const isPdf = contentType === "application/pdf";

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {d.name}
            <Tag tone={archived ? "neutral" : d.visibility === "INTERNAL" ? "neutral" : d.visibility === "OWNER" ? "success" : "info"} plain>
              {archived ? "مؤرشف" : DOCUMENT_VISIBILITY[d.visibility]}
            </Tag>
            <Tag tone="brand" plain className="num">
              v{d.version}
            </Tag>
          </span>
        }
        subtitle={`${DOCUMENT_TYPES[d.type] ?? d.type} · رفعه ${d.uploadedBy?.name ?? "—"} في ${date(d.createdAt)}`}
        breadcrumbs={[{ label: "المستندات", href: "/documents" }, { label: d.name }]}
        actions={
          <>
            {hasFile && (
              <a href={d.url!} download={fileName ?? undefined} className="btn btn-outline btn-sm">
                تنزيل
              </a>
            )}
            {manage && !archived && (
              <Link href={`/documents/${d.id}/edit`} className="btn btn-primary btn-sm">
                تعديل
              </Link>
            )}
            <MoreMenu
              items={[
                hasFile && { label: "فتح الملف في تبويب جديد", node: <a href={d.url!} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">فتح الملف في تبويب جديد</a> },
                can(user, "tasks.manage") && { label: "إضافة مهمة", href: `/tasks/new?entityType=DOCUMENT&entityId=${d.id}&entityLabel=${encodeURIComponent(d.name)}` },
                manage &&
                  (archived
                    ? { label: "استعادة", node: <ActionButton action={restoreDocument} hidden={{ id: d.id }} className="btn btn-ghost btn-sm">استعادة من الأرشيف</ActionButton> }
                    : { label: "أرشفة", danger: true, node: <ActionButton action={archiveDocument} hidden={{ id: d.id }} className="btn btn-ghost btn-sm text-danger" confirm="أرشفة المستند؟ لن يُحذف وستبقى كل إصداراته محفوظة.">أرشفة المستند</ActionButton> }),
              ]}
            />
          </>
        }
      />

      {left !== null && left < 0 && !archived && (
        <div className="mb-4">
          <Alert tone="danger" title="مستند منتهي">انتهى هذا المستند منذ {-left} يومًا. ارفع نسخة جديدة أو أرشفه.</Alert>
        </div>
      )}
      {left !== null && left >= 0 && left <= 30 && !archived && (
        <div className="mb-4">
          <Alert tone="warning" title="اقتراب الانتهاء">ينتهي هذا المستند خلال {left} يومًا.</Alert>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="بيانات المستند">
            <DL
              cols={3}
              items={[
                { label: "تاريخ الانتهاء", value: d.expiryDate ? <span className={left !== null && left < 0 ? "text-danger" : left !== null && left <= 30 ? "text-warning" : ""}>{date(d.expiryDate)}{left !== null && ` (${left < 0 ? `منذ ${-left} يوم` : `بعد ${left} يوم`})`}</span> : null },
                { label: "تاريخ الإصدار", value: date(d.issueDate) },
                {
                  label: "الكيان المرتبط",
                  value: d.entityType ? (
                    <span>
                      <span className="text-muted">{ENTITY_TYPES[d.entityType] ?? d.entityType}: </span>
                      {route && d.entityId ? <Link className="link" href={`${route}/${d.entityId}`}>{d.entityLabel ?? d.entityId}</Link> : d.entityLabel ?? d.entityId}
                    </span>
                  ) : null,
                },
                { label: "الملف", value: fileName ? <span className="latin">{fileName}</span> : null },
                { label: "الصيغة", value: contentType ? <span className="latin">{TYPE_LABELS[contentType] ?? contentType}</span> : null },
                { label: "الحجم", value: d.sizeKb ? <span className="num">{sizeLabel(d.sizeKb)}</span> : null },
                { label: "الوسوم", value: tags.length ? <span className="flex flex-wrap gap-1">{tags.map((t) => <Tag key={t} tone="neutral" plain>{t}</Tag>)}</span> : null },
              ]}
            />
          </Card>

          <Card title="معاينة الملف" padded={false}>
            {!hasFile ? (
              <EmptyState title="لا يوجد ملف لهذا الإصدار" description="ارفع نسخة جديدة من اللوحة الجانبية." />
            ) : isImage ? (
              <div className="grid place-items-center bg-mist p-4">
                <a href={d.url!} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={d.url!} alt={fileName ?? d.name} className="max-h-[520px] w-auto rounded-xl object-contain shadow-sm" />
                </a>
              </div>
            ) : isPdf ? (
              <iframe src={d.url!} title={fileName ?? d.name} className="h-[620px] w-full rounded-b-2xl bg-white" />
            ) : (
              <div className="flex items-center gap-3 px-5 py-6">
                <div className="min-w-0">
                  <div className="latin truncate font-bold">{fileName ?? d.name}</div>
                  <div className="text-[12.5px] text-muted">
                    {contentType ? TYPE_LABELS[contentType] ?? contentType : "ملف"} · <span className="num">{sizeLabel(d.sizeKb) ?? "—"}</span> · لا تتوفر معاينة لهذه الصيغة، نزّل الملف لفتحه.
                  </div>
                </div>
              </div>
            )}
          </Card>

          <Card title={`الإصدارات (${versions.length})`} padded={false}>
            <Table>
              <thead>
                <tr>
                  <th className="num">النسخة</th>
                  <th>الملف</th>
                  <th>الانتهاء</th>
                  <th>رفعه</th>
                  <th>التاريخ</th>
                  <th className="num">الحجم</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => {
                  const f = tagsToArray(v.tags).find((t) => t.startsWith("ملف:"));
                  const vHasFile = Boolean(v.url && v.url.startsWith(FILE_PREFIX));
                  return (
                    <tr key={v.id} className={v.id === d.id ? "bg-sand-75/40" : ""}>
                      <td className="num">
                        {v.id === d.id ? <b>v{v.version}</b> : <Link href={`/documents/${v.id}`} className="link">v{v.version}</Link>}
                        {v.version === versions[0]?.version && <span className="cell-sub">الأحدث</span>}
                      </td>
                      <td className="latin text-[12.5px]">
                        {vHasFile ? (
                          <a href={v.url!} target="_blank" rel="noreferrer" className="link">
                            {f ? f.replace("ملف: ", "") : "فتح"}
                          </a>
                        ) : f ? (
                          f.replace("ملف: ", "")
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>{date(v.expiryDate)}</td>
                      <td className="text-muted">{v.uploadedBy?.name ?? "—"}</td>
                      <td>{datetime(v.createdAt)}</td>
                      <td className="num text-muted">{sizeLabel(v.sizeKb) ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Card>

          <Card title={`المهام المرتبطة (${tasks.length})`} padded={false}>
            {tasks.length === 0 ? (
              <EmptyState title="لا توجد مهام مرتبطة" description="يُنشئ النظام مهمة تجديد تلقائيًا عند اقتراب انتهاء المستند." />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <th>المهمة</th>
                    <th>المسند إليه</th>
                    <th>الأولوية</th>
                    <th>الاستحقاق</th>
                    <th>الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <Link href={`/tasks/${t.id}`} className="cell-primary hover:text-brand">
                          {t.title}
                        </Link>
                        {t.isAutomated && <span className="cell-sub"> · تلقائي</span>}
                      </td>
                      <td className="text-muted">{t.assignedTo?.name ?? "—"}</td>
                      <td>
                        <StatusTag value={t.priority} map={TASK_PRIORITY} />
                      </td>
                      <td>{date(t.dueDate)}</td>
                      <td>
                        <StatusTag value={t.status} map={TASK_STATUS} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          {manage && !archived && (
            <Card title="رفع نسخة جديدة" subtitle={`سيُنشأ الإصدار v${(versions[0]?.version ?? d.version) + 1}`}>
              <form action={uploadVersion} className="space-y-3" encType="multipart/form-data">
                <input type="hidden" name="id" value={d.id} />
                <Field label="الملف" name="file" required help="PDF أو صورة أو Excel أو Word، حتى 4MB">
                  <input type="file" name="file" id="file" className="input !py-1.5" required accept=".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.xls,.csv,.doc,.docx" />
                </Field>
                <Field label="تاريخ الإصدار" name="issueDate">
                  <Input name="issueDate" type="date" defaultValue={inputDate(new Date())} />
                </Field>
                <Field label="تاريخ الانتهاء الجديد" name="expiryDate" help="اتركه فارغًا للإبقاء على التاريخ الحالي">
                  <Input name="expiryDate" type="date" defaultValue="" />
                </Field>
                <button type="submit" className="btn btn-primary btn-sm w-full">
                  رفع النسخة
                </button>
              </form>
            </Card>
          )}

          <Card title="تنبيهات الانتهاء">
            {d.expiryDate ? (
              alerts
                .slice()
                .sort((a, b) => b - a)
                .map((n) => {
                  const at = new Date(d.expiryDate!);
                  at.setTime(addDays(at, -n).getTime());
                  const passed = at <= new Date();
                  return <KV key={n} k={`قبل ${n} يوم`} v={<span className={passed ? "text-muted" : ""}>{date(at)}{passed ? " · أُرسل" : ""}</span>} />;
                })
            ) : (
              <p className="text-[13px] text-muted">لا يوجد تاريخ انتهاء لهذا المستند.</p>
            )}
          </Card>

          <Card title="سجل العمليات">
            {activity.length === 0 ? (
              <p className="text-[13px] text-muted">لا توجد عمليات مسجلة.</p>
            ) : (
              <div className="timeline">
                {activity.map((a) => (
                  <div key={a.id} className="timeline-item">
                    <div className="text-[13px]">
                      <StatusTag value={a.action} map={AUDIT_ACTIONS} /> <b>{a.userName}</b>
                    </div>
                    <div className="text-[11.5px] text-faint">{datetime(a.createdAt)}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
