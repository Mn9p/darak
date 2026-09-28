import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { TASK_PRIORITY, TASK_STATUS, ENTITY_ROUTES, ENTITY_TYPES, AUDIT_ACTIONS, STAFF_ROLES } from "@/lib/constants";
import { datetime, date, relative, safeJson, tagsToArray } from "@/lib/format";
import { PageHeader, Card, StatusTag, Tabs, DL, EmptyState, Tag, ActionButton, Progress } from "@/components/ui";
import { MoreMenu } from "@/components/MoreMenu";
import { setTaskStatus, toggleChecklist } from "../actions";
import { TaskPanel } from "./TaskPanel";

export const dynamic = "force-dynamic";
const OPEN = ["NEW", "ASSIGNED", "IN_PROGRESS", "WAITING"];
const TABS = [
  { key: "overview", label: "التفاصيل" },
  { key: "activity", label: "النشاط والتعليقات" },
];

export default async function TaskDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const user = await requireStaff();
  const { id } = await params;
  const { tab = "overview" } = await searchParams;
  const org = user.organizationId;

  const t = await db.task.findFirst({ where: { id, organizationId: org }, include: { assignedTo: { select: { id: true, name: true } }, createdBy: { select: { id: true, name: true } } } });
  if (!t) notFound();

  const [assignees, activity] = await Promise.all([
    db.user.findMany({ where: { organizationId: org, role: { in: STAFF_ROLES }, status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.auditLog.findMany({ where: { entityType: "TASK", entityId: id }, orderBy: { createdAt: "desc" }, take: 80 }),
  ]);

  const now = new Date();
  const overdue = OPEN.includes(t.status) && t.dueDate !== null && t.dueDate < now;
  const terminal = ["COMPLETED", "CANCELLED"].includes(t.status);
  const canManage = can(user, "tasks.manage");
  const checklist = safeJson<{ text: string; done: boolean }[]>(t.checklist, []);
  const doneCount = checklist.filter((c) => c.done).length;
  const route = t.entityType ? ENTITY_ROUTES[t.entityType] : null;
  const entityHref = route && t.entityId ? `${route}/${t.entityId}` : null;

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {t.title} <StatusTag value={t.status} map={TASK_STATUS} /> {overdue && <StatusTag value="OVERDUE" map={TASK_STATUS} />} <StatusTag value={t.priority} map={TASK_PRIORITY} />
            {t.isAutomated && (
              <Tag tone="neutral" plain>
                تلقائية
              </Tag>
            )}
          </span>
        }
        subtitle={
          <span>
            {t.assignedTo ? <>المسؤول: <Link href={`/employees/${t.assignedTo.id}`} className="hover:text-brand">{t.assignedTo.name}</Link></> : "غير مسندة"}
            {t.dueDate && (
              <>
                {" "}
                · الاستحقاق <span className={overdue ? "font-bold text-danger" : ""}>{date(t.dueDate)} ({relative(t.dueDate)})</span>
              </>
            )}
            {t.completedAt && <> · أُنجزت في {datetime(t.completedAt)}</>}
          </span>
        }
        breadcrumbs={[{ label: "المهام", href: "/tasks" }, { label: t.title }]}
        actions={
          <>
            {canManage && !terminal && (
              <Link href={`/tasks/${t.id}/edit`} className="btn btn-outline btn-sm">
                تعديل
              </Link>
            )}
            {canManage && OPEN.includes(t.status) && (
              <ActionButton action={setTaskStatus} hidden={{ id: t.id, status: "COMPLETED" }} className="btn btn-primary btn-sm">
                إنجاز المهمة
              </ActionButton>
            )}
            {canManage && terminal && (
              <ActionButton action={setTaskStatus} hidden={{ id: t.id, status: "IN_PROGRESS" }} className="btn btn-primary btn-sm">
                إعادة فتح
              </ActionButton>
            )}
            <MoreMenu
              items={[
                !!entityHref && { label: `فتح ${ENTITY_TYPES[t.entityType!] ?? "السجل"}`, href: entityHref },
                canManage &&
                  ["NEW", "ASSIGNED", "WAITING"].includes(t.status) && {
                    label: "بدء العمل",
                    node: (
                      <ActionButton action={setTaskStatus} hidden={{ id: t.id, status: "IN_PROGRESS" }} className="btn btn-ghost btn-sm">
                        بدء العمل
                      </ActionButton>
                    ),
                  },
                canManage &&
                  ["ASSIGNED", "IN_PROGRESS"].includes(t.status) && {
                    label: "تعليق المهمة",
                    node: (
                      <ActionButton action={setTaskStatus} hidden={{ id: t.id, status: "WAITING" }} className="btn btn-ghost btn-sm">
                        تعليق المهمة
                      </ActionButton>
                    ),
                  },
                canManage &&
                  OPEN.includes(t.status) && {
                    label: "إلغاء المهمة",
                    danger: true,
                    node: (
                      <ActionButton action={setTaskStatus} hidden={{ id: t.id, status: "CANCELLED" }} className="btn btn-ghost btn-sm text-danger" confirm="هل تريد إلغاء المهمة؟">
                        إلغاء المهمة
                      </ActionButton>
                    ),
                  },
              ]}
            />
          </>
        }
      />

      <Tabs tabs={TABS} active={tab} base={`/tasks/${t.id}`} />

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {tab === "overview" && (
            <>
              <Card title="بيانات المهمة">
                <div className="mb-4 whitespace-pre-line rounded-xl bg-mist px-4 py-3 text-[13.5px] text-text-2">{t.description || <span className="text-faint">لا يوجد وصف</span>}</div>
                <DL
                  cols={3}
                  items={[
                    { label: "السجل المرتبط", value: t.entityType ? (entityHref ? <Link className="link" href={entityHref}>{ENTITY_TYPES[t.entityType] ?? t.entityType}: {t.entityLabel ?? t.entityId}</Link> : `${ENTITY_TYPES[t.entityType] ?? t.entityType}: ${t.entityLabel ?? ""}`) : null },
                    { label: "أنشأها", value: t.isAutomated ? "النظام تلقائيًا" : t.createdBy?.name },
                    { label: "تاريخ الإنشاء", value: datetime(t.createdAt) },
                    { label: "الوسوم", value: tagsToArray(t.tags).length ? <span className="flex flex-wrap gap-1">{tagsToArray(t.tags).map((x) => <Tag key={x} tone="brand" plain>{x}</Tag>)}</span> : null },
                  ]}
                />
              </Card>

              <Card title="قائمة التحقق" subtitle={checklist.length ? `${doneCount} من ${checklist.length} بند` : undefined}>
                {checklist.length === 0 ? (
                  <p className="text-[13px] text-faint">لا توجد بنود.</p>
                ) : (
                  <>
                    <div className="mb-3">
                      <Progress value={(doneCount / checklist.length) * 100} />
                    </div>
                    <ul className="space-y-1">
                      {checklist.map((c, i) => (
                        <li key={i} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-mist">
                          {canManage && !terminal ? (
                            <ActionButton action={toggleChecklist} hidden={{ id: t.id, index: String(i) }} className={`grid h-5 w-5 place-items-center rounded border text-[11px] ${c.done ? "border-brand bg-brand text-white" : "border-line bg-white"}`}>
                              {c.done ? "✓" : ""}
                            </ActionButton>
                          ) : (
                            <span className={`grid h-5 w-5 place-items-center rounded border text-[11px] ${c.done ? "border-brand bg-brand text-white" : "border-line"}`}>{c.done ? "✓" : ""}</span>
                          )}
                          <span className={`text-[13.5px] ${c.done ? "text-faint line-through" : "text-text"}`}>{c.text}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </Card>
            </>
          )}

          {tab === "activity" && (
            <Card title="النشاط والتعليقات">
              {activity.length === 0 ? (
                <EmptyState title="لا يوجد نشاط مسجل" />
              ) : (
                <div className="timeline">
                  {activity.map((a) => {
                    const nv = safeJson<Record<string, unknown>>(a.newValue, {});
                    const ov = safeJson<Record<string, unknown>>(a.oldValue, {});
                    const comment = typeof nv.comment === "string" ? nv.comment : null;
                    return (
                      <div key={a.id} className={`timeline-item ${comment ? "" : a.action === "STATUS_CHANGE" ? "warning" : "neutral"}`}>
                        <div className="text-[13px]">
                          {comment ? <Tag tone="brand">تعليق</Tag> : <StatusTag value={a.action} map={AUDIT_ACTIONS} />} <b>{a.userName}</b>
                          {!comment && a.entityLabel && <span className="text-muted"> — {a.entityLabel}</span>}
                        </div>
                        {comment && <div className="mt-1 rounded-lg bg-mist px-3 py-2 text-[13px] text-text-2">{comment}</div>}
                        {a.action === "STATUS_CHANGE" && typeof nv.status === "string" && (
                          <div className="mt-0.5 text-[12px] text-text-2">
                            {typeof ov.status === "string" ? TASK_STATUS[ov.status]?.label ?? ov.status : "—"} ← {TASK_STATUS[nv.status]?.label ?? nv.status}
                          </div>
                        )}
                        <div className="text-[11.5px] text-faint">{datetime(a.createdAt)}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          )}
        </div>
        <div>
          <TaskPanel taskId={t.id} assignedToId={t.assignedToId} assignees={assignees} canManage={canManage} terminal={terminal} />
        </div>
      </div>
    </>
  );
}
