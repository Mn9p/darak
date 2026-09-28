import Link from "next/link";
import type { Prisma } from "@darak/db";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { TASK_PRIORITY, TASK_STATUS, ENTITY_ROUTES, ENTITY_TYPES, STAFF_ROLES } from "@/lib/constants";
import { money, relative, date, tagsToArray, pageParam, startOfDay } from "@/lib/format";
import { PageHeader, Card, Table, StatusTag, EmptyState, Pagination, FilterBar, Input, Select, StatGrid, StatCard, Tag, Avatar } from "@/components/ui";
import { GuideCard } from "@/components/GuideCard";
import { MoreFilters } from "@/components/MoreFilters";
import { textLike } from "@/lib/search";

export const dynamic = "force-dynamic";
const PAGE = 25;
const OPEN = ["NEW", "ASSIGNED", "IN_PROGRESS", "WAITING"];
const BOARD_COLUMNS = ["NEW", "ASSIGNED", "IN_PROGRESS", "WAITING", "COMPLETED"];
const TASK_ENTITY_TYPES = Object.fromEntries(Object.keys(ENTITY_ROUTES).filter((k) => k !== "TASK").map((k) => [k, ENTITY_TYPES[k] ?? k]));
const SCOPES = { mine: "مهامي", team: "فريقي", all: "كل المهام" };

export default async function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireStaff();
  const sp = await searchParams;
  const org = user.organizationId;
  const page = pageParam(sp.page);
  const now = new Date();
  const board = sp.view === "board";
  const scope = sp.scope === "all" || sp.scope === "team" ? sp.scope : "mine";
  const q = sp.q?.trim();

  const reports = scope === "team" ? await db.user.findMany({ where: { organizationId: org, managerId: user.id }, select: { id: true } }) : [];
  const scopeWhere = scope === "mine" ? { OR: [{ assignedToId: user.id }, { assignedToId: null, createdById: user.id }] } : scope === "team" ? { assignedToId: { in: [user.id, ...reports.map((r) => r.id)] } } : {};

  const where = {
    organizationId: org,
    AND: [
      scopeWhere,
      sp.status ? { status: sp.status } : board ? { status: { not: "CANCELLED" } } : {},
      sp.priority ? { priority: sp.priority } : {},
      sp.assignedToId ? { assignedToId: sp.assignedToId } : {},
      sp.entityType ? { entityType: sp.entityType } : {},
      sp.overdue === "1" ? { status: { in: OPEN }, dueDate: { lt: now } } : {},
      sp.automated === "1" ? { isAutomated: true } : {},
      q ? { OR: [{ title: textLike(q) }, { description: textLike(q) }, { entityLabel: textLike(q) }, { tags: textLike(q) }] } : {},
    ],
  };
  const todayStart = startOfDay(now);
  const orderBy: Prisma.TaskOrderByWithRelationInput[] = board ? [{ priority: "desc" }, { dueDate: "asc" }] : [{ dueDate: "asc" }, { createdAt: "desc" }];

  const [total, rows, assignees, statOpen, statOverdue, statDoneToday, statAutomated] = await Promise.all([
    db.task.count({ where }),
    db.task.findMany({
      where,
      orderBy,
      skip: board ? 0 : (page - 1) * PAGE,
      take: board ? 300 : PAGE,
      include: { assignedTo: { select: { id: true, name: true } } },
    }),
    db.user.findMany({ where: { organizationId: org, role: { in: STAFF_ROLES }, status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.task.count({ where: { organizationId: org, ...scopeWhere, status: { in: OPEN } } }),
    db.task.count({ where: { organizationId: org, ...scopeWhere, status: { in: OPEN }, dueDate: { lt: now } } }),
    db.task.count({ where: { organizationId: org, ...scopeWhere, status: "COMPLETED", completedAt: { gte: todayStart } } }),
    db.task.count({ where: { organizationId: org, ...scopeWhere, status: { in: OPEN }, isAutomated: true } }),
  ]);

  const hasFilters = Boolean(sp.q || sp.status || sp.priority || sp.assignedToId || sp.entityType || sp.overdue || sp.automated);
  const mk = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    Object.entries({ ...sp, ...patch }).forEach(([k, v]) => v && k !== "page" && p.set(k, v));
    const s = p.toString();
    return `/tasks${s ? `?${s}` : ""}`;
  };
  const isOverdue = (t: { status: string; dueDate: Date | null }) => OPEN.includes(t.status) && t.dueDate !== null && t.dueDate < now;

  return (
    <>
      <PageHeader
        title="المهام"
        actions={
          <>
            <Link href={board ? mk({ view: undefined }) : mk({ view: "board" })} className="btn btn-outline btn-sm">
              {board ? "عرض القائمة" : "عرض اللوحة"}
            </Link>
            {can(user, "tasks.manage") && (
              <Link href="/tasks/new" className="btn btn-primary btn-sm">
                إضافة مهمة
              </Link>
            )}
          </>
        }
      />

      <GuideCard
        id="tasks"
        show={total === 0 && !hasFilters}
        title="المهام: ما يحتاج متابعة من أحد أفراد الفريق"
        steps={[
          "أنشئ مهمة وأسندها لموظف مع تاريخ استحقاق.",
          "بعض المهام تُنشأ تلقائيًا: تجديد عقد، اعتماد مصروف، مستند ينتهي، وحدة شاغرة.",
          "المطالبات المالية لها قائمتها الخاصة في التحصيل ولا تُسجل كمهام.",
        ]}
        cta={{ href: "/tasks/new", label: "إضافة مهمة" }}
        secondary={{ href: "/collections", label: "التحصيل" }}
      />

      <StatGrid cols={4}>
        <StatCard label="مهام مفتوحة" value={money(statOpen)} href={mk({ status: undefined, overdue: undefined })} />
        <StatCard label="متأخرة" value={money(statOverdue)} tone={statOverdue > 0 ? "danger" : undefined} href={mk({ overdue: "1" })} />
        <StatCard label="أُنجزت اليوم" value={money(statDoneToday)} tone="success" />
        <StatCard label="تلقائية مفتوحة" value={money(statAutomated)} href={mk({ automated: "1" })} />
      </StatGrid>

      <Card className="mt-4" padded={false}>
        <div className="px-4 pt-4">
          <FilterBar base="/tasks" hasFilters={hasFilters}>
            {board && <input type="hidden" name="view" value="board" />}
            <Input name="q" placeholder="بحث في العنوان أو السجل المرتبط" defaultValue={sp.q ?? ""} className="!w-56" />
            <Select name="scope" options={SCOPES} defaultValue={scope} className="!w-32" />
            <Select name="status" options={Object.fromEntries(Object.entries(TASK_STATUS).filter(([k]) => k !== "OVERDUE"))} placeholder="كل الحالات" defaultValue={sp.status ?? ""} className="!w-36" />
            <MoreFilters open={Boolean(sp.priority || sp.assignedToId || sp.entityType || sp.overdue || sp.automated)}>
              <Select name="priority" options={TASK_PRIORITY} placeholder="كل الأولويات" defaultValue={sp.priority ?? ""} className="!w-36" />
              <Select name="assignedToId" options={assignees.map((a) => ({ value: a.id, label: a.name }))} placeholder="كل الموظفين" defaultValue={sp.assignedToId ?? ""} className="!w-40" />
              <Select name="entityType" options={TASK_ENTITY_TYPES} placeholder="كل السجلات" defaultValue={sp.entityType ?? ""} className="!w-36" />
              <label className="flex items-center gap-1.5 pb-2 text-[13px] text-text-2">
                <input type="checkbox" name="overdue" value="1" defaultChecked={sp.overdue === "1"} /> متأخرة
              </label>
              <label className="flex items-center gap-1.5 pb-2 text-[13px] text-text-2">
                <input type="checkbox" name="automated" value="1" defaultChecked={sp.automated === "1"} /> تلقائية
              </label>
            </MoreFilters>
          </FilterBar>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            title={hasFilters ? "لا توجد نتائج مطابقة" : scope === "mine" ? "لا توجد مهام مسندة إليك" : "لا توجد مهام"}
            description={hasFilters ? "جرّب تعديل الفلاتر." : "أضف مهمة لبدء المتابعة."}
            action={!hasFilters && can(user, "tasks.manage") ? <Link href="/tasks/new" className="btn btn-primary">إضافة مهمة</Link> : undefined}
          />
        ) : board ? (
          <div className="flex gap-3 overflow-x-auto px-4 pb-4">
            {BOARD_COLUMNS.map((col) => {
              const items = rows.filter((r) => r.status === col);
              return (
                <div key={col} className="kanban-col flex w-64 flex-none flex-col gap-2">
                  <div className="flex items-center justify-between px-1 pb-1">
                    <StatusTag value={col} map={TASK_STATUS} />
                    <span className="pill-count">{items.length}</span>
                  </div>
                  {items.length === 0 && <div className="rounded-lg border border-dashed border-line px-2 py-4 text-center text-[12px] text-faint">لا توجد مهام</div>}
                  {items.map((t) => (
                    <Link key={t.id} href={`/tasks/${t.id}`} className="card block px-3 py-2.5 transition hover:shadow-card">
                      <div className="flex items-center justify-between gap-2">
                        <StatusTag value={t.priority} map={TASK_PRIORITY} />
                        {t.isAutomated && (
                          <Tag tone="neutral" plain>
                            تلقائية
                          </Tag>
                        )}
                      </div>
                      <div className="mt-1 text-[13px] font-bold text-text">{t.title}</div>
                      {t.entityLabel && <div className="mt-0.5 truncate text-[12px] text-muted">{t.entityLabel}</div>}
                      <div className="mt-1.5 flex items-center justify-between text-[11.5px]">
                        <span className="text-muted">{t.assignedTo?.name ?? "غير مسندة"}</span>
                        {t.dueDate && <span className={isOverdue(t) ? "font-bold text-danger" : "text-faint"}>{relative(t.dueDate)}</span>}
                      </div>
                    </Link>
                  ))}
                </div>
              );
            })}
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>المهمة</th>
                <th>المسؤول</th>
                <th>الأولوية</th>
                <th>الاستحقاق</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const overdue = isOverdue(t);
                const route = t.entityType ? ENTITY_ROUTES[t.entityType] : null;
                const tags = tagsToArray(t.tags);
                return (
                  <tr key={t.id}>
                    <td>
                      <Link href={`/tasks/${t.id}`} className="cell-primary hover:text-brand">
                        {t.title}
                      </Link>
                      {(t.entityType || t.isAutomated || tags.length > 0) && (
                        <div className="cell-sub flex flex-wrap items-center gap-1">
                          {t.entityType &&
                            (route && t.entityId ? (
                              <Link href={`${route}/${t.entityId}`} className="hover:text-brand">
                                {ENTITY_TYPES[t.entityType] ?? t.entityType}: {t.entityLabel ?? t.entityId}
                              </Link>
                            ) : (
                              <span>{t.entityLabel}</span>
                            ))}
                          {t.isAutomated && <span>· تلقائية</span>}
                          {tags.map((tg) => (
                            <Tag key={tg} tone="brand" plain>
                              {tg}
                            </Tag>
                          ))}
                        </div>
                      )}
                    </td>
                    <td>
                      {t.assignedTo ? (
                        <span className="flex items-center gap-2">
                          <Avatar name={t.assignedTo.name} sm />
                          <Link href={`/employees/${t.assignedTo.id}`} className="hover:text-brand">
                            {t.assignedTo.name}
                          </Link>
                        </span>
                      ) : (
                        <span className="text-faint">غير مسندة</span>
                      )}
                    </td>
                    <td>
                      <StatusTag value={t.priority} map={TASK_PRIORITY} />
                    </td>
                    <td className={overdue ? "font-bold text-danger" : ""}>
                      {t.dueDate ? relative(t.dueDate) : <span className="text-faint">—</span>}
                      {t.dueDate && <div className={`cell-sub ${overdue ? "text-danger" : ""}`}>{date(t.dueDate)}</div>}
                    </td>
                    <td>
                      <span className="flex flex-wrap gap-1">
                        <StatusTag value={t.status} map={TASK_STATUS} />
                        {overdue && <StatusTag value="OVERDUE" map={TASK_STATUS} />}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        {!board && <Pagination page={page} pageSize={PAGE} total={total} base="/tasks" params={sp} />}
      </Card>
    </>
  );
}
