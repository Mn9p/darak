import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertCan, can, ROLE_PERMISSIONS, type Permission } from "@/lib/permissions";
import { ROLES, STAFF_ROLES, USER_STATUS, AUDIT_ACTIONS, ENTITY_TYPES, NOTIFICATION_CHANNELS, NOTIFICATION_EVENTS, type Role } from "@/lib/constants";
import { money, datetime, date, relative, pct, safeJson, addDays } from "@/lib/format";
import { PageHeader, Card, Table, StatusTag, Tabs, DL, StatGrid, StatCard, EmptyState, Tag, ActionButton, Avatar, KV, Alert } from "@/components/ui";
import { displayPhone } from "@/lib/phone";
import { deactivateEmployee, activateEmployee, revokeSession } from "../actions";

export const dynamic = "force-dynamic";
const OPEN = ["NEW", "ASSIGNED", "IN_PROGRESS", "WAITING"];
const TABS = [
  { key: "overview", label: "الملف" },
  { key: "permissions", label: "الصلاحيات ونطاق البيانات" },
  { key: "kpis", label: "مؤشرات الأداء" },
  { key: "activity", label: "النشاط" },
  { key: "sessions", label: "الجلسات والأمان" },
];

const MODULE_LABELS: Record<string, string> = {
  dashboard: "لوحة التحكم",
  properties: "العقارات",
  units: "الوحدات",
  owners: "الملاك",
  tenants: "المستأجرون",
  leasing: "التأجير",
  contracts: "العقود",
  installments: "جدول الدفعات",
  collections: "التحصيل",
  payments: "سندات القبض",
  expenses: "المصروفات",
  statements: "كشوف حساب الملاك",
  tasks: "المهام",
  employees: "الموظفون",
  reports: "التقارير",
  documents: "المستندات",
  audit: "سجل التدقيق",
  integrations: "التكاملات",
  settings: "الإعدادات",
  import: "الاستيراد",
};
const ACTION_LABELS: Record<string, string> = {
  view: "عرض",
  manage: "إدارة",
  approve: "اعتماد",
  financial: "بيانات مالية",
  waive: "إعفاء",
  export: "تصدير",
};

export default async function EmployeePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const user = await requireStaff();
  assertCan(user, "employees.view");
  const { id } = await params;
  const { tab = "overview" } = await searchParams;
  const org = user.organizationId;

  const e = await db.user.findFirst({
    where: { id, organizationId: org, role: { in: STAFF_ROLES } },
    include: {
      branch: { select: { name: true } },
      manager: { select: { id: true, name: true } },
      reports: { select: { id: true, name: true, role: true }, orderBy: { name: "asc" } },
      assignments: { include: { property: { select: { id: true, name: true, code: true, city: true } } } },
      managedProperties: { select: { id: true, name: true }, where: { status: { not: "ARCHIVED" } } },
    },
  });
  if (!e) notFound();

  const now = new Date();
  const since30 = addDays(now, -30);
  const canManage = can(user, "employees.manage");
  const isSelf = e.id === user.id;
  const role = e.role as Role;
  const prefs = safeJson<{ channels?: string[]; events?: string[] }>(e.preferences, {});

  const [openTasks, overdueTasks, completed30, collectionActions30, collected30, contracts30, activity, sessions] = await Promise.all([
    db.task.count({ where: { organizationId: org, assignedToId: id, status: { in: OPEN } } }),
    db.task.count({ where: { organizationId: org, assignedToId: id, status: { in: OPEN }, dueDate: { lt: now } } }),
    db.task.findMany({ where: { organizationId: org, assignedToId: id, status: "COMPLETED", completedAt: { gte: since30 } }, select: { dueDate: true, completedAt: true } }),
    db.collectionAction.count({ where: { byUserId: id, createdAt: { gte: since30 }, case: { organizationId: org } } }),
    db.payment.aggregate({ where: { organizationId: org, recordedById: id, paidAt: { gte: since30 }, status: { in: ["RECORDED", "APPROVED"] } }, _sum: { amount: true }, _count: true }),
    db.contract.count({ where: { organizationId: org, createdById: id, createdAt: { gte: since30 } } }),
    tab === "activity" ? db.auditLog.findMany({ where: { organizationId: org, userId: id }, orderBy: { createdAt: "desc" }, take: 60 }) : Promise.resolve([]),
    tab === "sessions" ? db.session.findMany({ where: { userId: id }, orderBy: { createdAt: "desc" }, take: 30 }) : Promise.resolve([]),
  ]);

  const withDue = completed30.filter((t) => t.dueDate && t.completedAt);
  const onTime = withDue.filter((t) => t.completedAt! <= t.dueDate!).length;
  const onTimePct = withDue.length ? (onTime / withDue.length) * 100 : null;

  const perms = ROLE_PERMISSIONS[role] ?? [];
  const grouped = perms.reduce<Record<string, string[]>>((acc, p) => {
    const [mod, act] = (p as Permission).split(".");
    (acc[mod] ??= []).push(act);
    return acc;
  }, {});
  const scoped = role === "PROPERTY_MANAGER";

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <Avatar name={e.name} /> {e.name} <StatusTag value={e.role} map={ROLES} /> <StatusTag value={e.status} map={USER_STATUS} />
            {isSelf && (
              <Tag tone="brand" plain>
                أنت
              </Tag>
            )}
          </span>
        }
        subtitle={
          <span>
            <span className="num">{displayPhone(e.phone)}</span>
            {e.email && <> · <span className="latin">{e.email}</span></>}
            {e.jobTitle && ` · ${e.jobTitle}`}
            {e.department && ` · ${e.department}`}
            {e.branch && ` · ${e.branch.name}`}
          </span>
        }
        breadcrumbs={[{ label: "الموظفون", href: "/employees" }, { label: e.name }]}
        actions={
          canManage ? (
            <>
              {can(user, "tasks.manage") && (
                <Link href={`/tasks/new?assignedToId=${e.id}`} className="btn btn-ghost btn-sm">
                  + مهمة
                </Link>
              )}
              {!isSelf &&
                (e.status === "INACTIVE" ? (
                  <ActionButton action={activateEmployee} hidden={{ id: e.id }} className="btn btn-success-soft btn-sm">
                    تفعيل الحساب
                  </ActionButton>
                ) : (
                  <ActionButton action={deactivateEmployee} hidden={{ id: e.id }} className="btn btn-danger-soft btn-sm" confirm="سيتم تعطيل الحساب وإنهاء جلساته. متابعة؟">
                    تعطيل الحساب
                  </ActionButton>
                ))}
              <Link href={`/employees/${e.id}/edit`} className="btn btn-primary btn-sm">
                تعديل
              </Link>
            </>
          ) : undefined
        }
      />

      <StatGrid cols={5}>
        <StatCard label="مهام مفتوحة" value={money(openTasks)} href={`/tasks?scope=all&assignedToId=${e.id}`} />
        <StatCard label="مهام متأخرة" value={money(overdueTasks)} tone={overdueTasks > 0 ? "danger" : undefined} href={`/tasks?scope=all&assignedToId=${e.id}&overdue=1`} />
        <StatCard label="أُنجزت (30 يوم)" value={money(completed30.length)} tone="success" />
        <StatCard label="الالتزام بالمواعيد" value={onTimePct === null ? "—" : pct(onTimePct, 0)} sub={withDue.length ? `${onTime} من ${withDue.length} مهمة` : "لا توجد بيانات"} />
        <StatCard label="آخر دخول" value={e.lastLoginAt ? relative(e.lastLoginAt) : "—"} sub={e.lastLoginAt ? datetime(e.lastLoginAt) : "لم يسجل دخولًا بعد"} />
      </StatGrid>

      <div className="mt-4">
        <Tabs tabs={TABS} active={tab} base={`/employees/${e.id}`} />
      </div>

      {tab === "overview" && (
        <div className="grid gap-4 xl:grid-cols-3">
          <Card title="بيانات الموظف" className="xl:col-span-2">
            <DL
              cols={3}
              items={[
                { label: "الاسم", value: e.name },
                { label: "رقم الجوال (الدخول)", value: <span className="num">{displayPhone(e.phone)}</span> },
                { label: "البريد الإلكتروني", value: e.email ? <span className="latin">{e.email}</span> : null },
                { label: "الرقم الوظيفي", value: e.employeeCode ? <span className="latin">{e.employeeCode}</span> : null },
                { label: "الدور", value: ROLES[role]?.label ?? e.role },
                { label: "الحالة", value: <StatusTag value={e.status} map={USER_STATUS} /> },
                { label: "الفرع", value: e.branch?.name },
                { label: "القسم", value: e.department },
                { label: "المسمى الوظيفي", value: e.jobTitle },
                { label: "المدير المباشر", value: e.manager ? <Link className="link" href={`/employees/${e.manager.id}`}>{e.manager.name}</Link> : null },
                { label: "تاريخ الإنشاء", value: date(e.createdAt) },
              ]}
            />
          </Card>
          <div className="space-y-4">
            <Card title="الفريق المباشر" subtitle={e.reports.length ? `${e.reports.length} موظف` : undefined}>
              {e.reports.length === 0 ? (
                <p className="text-[13px] text-faint">لا يوجد موظفون تحت إدارته.</p>
              ) : (
                e.reports.map((r) => (
                  <div key={r.id} className="flex items-center justify-between border-b border-[#EDF1EF] py-2 last:border-0">
                    <Link href={`/employees/${r.id}`} className="font-bold hover:text-brand">
                      {r.name}
                    </Link>
                    <StatusTag value={r.role} map={ROLES} />
                  </div>
                ))
              )}
            </Card>
            <Card title="تفضيلات الإشعارات">
              <KV k="القنوات" v={<span className="text-[12.5px]">{(prefs.channels ?? ["IN_APP"]).map((c) => NOTIFICATION_CHANNELS[c] ?? c).join("، ") || "—"}</span>} />
              <KV k="الأحداث" v={<span className="text-[12.5px]">{prefs.events ? `${prefs.events.length} حدث` : "الافتراضي"}</span>} />
              {prefs.events && prefs.events.length > 0 && <p className="mt-2 text-[12px] text-muted">{prefs.events.map((k) => NOTIFICATION_EVENTS[k] ?? k).join(" · ")}</p>}
            </Card>
            {e.managedProperties.length > 0 && (
              <Card title="مدير عقار لـ" subtitle={`${e.managedProperties.length} عقار`}>
                {e.managedProperties.map((p) => (
                  <div key={p.id} className="py-1 text-[13.5px]">
                    <Link href={`/properties/${p.id}`} className="link">
                      {p.name}
                    </Link>
                  </div>
                ))}
              </Card>
            )}
          </div>
        </div>
      )}

      {tab === "permissions" && (
        <div className="grid gap-4 xl:grid-cols-3">
          <Card title={`صلاحيات الدور: ${ROLES[role]?.label ?? e.role}`} subtitle="الصلاحيات تُدار على مستوى الدور (RBAC) — لتغييرها غيّر الدور" className="xl:col-span-2">
            {perms.length === 0 ? (
              <p className="text-[13px] text-faint">لا توجد صلاحيات لهذا الدور.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {Object.entries(grouped).map(([mod, acts]) => (
                  <div key={mod} className="rounded-xl bg-mist px-3 py-2.5">
                    <div className="text-[13px] font-bold text-text">{MODULE_LABELS[mod] ?? mod}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {acts.map((a) => (
                        <Tag key={a} tone={a === "view" ? "neutral" : a === "approve" ? "success" : "info"} plain>
                          {ACTION_LABELS[a] ?? a}
                        </Tag>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card title="نطاق البيانات" subtitle={scoped ? "يرى العقارات المسندة فقط" : "يرى كل عقارات المكتب"}>
            {scoped && e.assignments.length === 0 && (
              <div className="mb-3">
                <Alert tone="warning">لا توجد عقارات مسندة — يرى هذا الموظف كل العقارات حتى يتم تحديد نطاقه.</Alert>
              </div>
            )}
            {e.assignments.length === 0 ? (
              <p className="text-[13px] text-faint">لا توجد عقارات مسندة.</p>
            ) : (
              <ul className="space-y-1">
                {e.assignments.map((a) => (
                  <li key={a.id} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-[13.5px] hover:bg-mist">
                    <Link href={`/properties/${a.property.id}`} className="link">
                      {a.property.name}
                    </Link>
                    <span className="latin text-[11.5px] text-muted">{a.property.code}</span>
                  </li>
                ))}
              </ul>
            )}
            {canManage && (
              <div className="mt-3">
                <Link href={`/employees/${e.id}/edit`} className="btn btn-outline btn-xs">
                  تعديل النطاق
                </Link>
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === "kpis" && (
        <>
          <div className="mb-4">
            <Alert tone="info" title="مؤشرات تشغيلية">
              هذه الأرقام مؤشرات تشغيلية لآخر 30 يومًا مبنية على السجلات فقط، وليست تقييمًا نهائيًا لأداء الموظف.
            </Alert>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Card title="المهام">
              <KV k="مفتوحة الآن" v={<span className="num">{openTasks}</span>} />
              <KV k="متأخرة الآن" v={<span className={`num ${overdueTasks > 0 ? "text-danger" : ""}`}>{overdueTasks}</span>} />
              <KV k="منجزة (30 يوم)" v={<span className="num">{completed30.length}</span>} />
              <KV k="الالتزام بالمواعيد" v={<span className="num">{onTimePct === null ? "—" : pct(onTimePct, 0)}</span>} />
            </Card>
            <Card title="التحصيل">
              <KV k="إجراءات تحصيل (30 يوم)" v={<span className="num">{collectionActions30}</span>} />
              <KV k="دفعات سجلها" v={<span className="num">{collected30._count}</span>} />
              <KV k="مبالغ سجلها" v={<span className="num">{money(collected30._sum.amount ?? 0)} ر.س</span>} />
            </Card>
            <Card title="التأجير">
              <KV k="عقود أنشأها (30 يوم)" v={<span className="num">{contracts30}</span>} />
            </Card>
          </div>
        </>
      )}

      {tab === "activity" && (
        <Card title="النشاط الأخير" subtitle="آخر 60 عملية من سجل التدقيق">
          {activity.length === 0 ? (
            <EmptyState title="لا يوجد نشاط مسجل" />
          ) : (
            <div className="timeline">
              {activity.map((a) => (
                <div key={a.id} className={`timeline-item ${a.action === "PERMISSION_CHANGE" ? "warning" : a.action === "LOGIN" ? "neutral" : ""}`}>
                  <div className="text-[13px]">
                    <StatusTag value={a.action} map={AUDIT_ACTIONS} /> <span className="text-muted">{ENTITY_TYPES[a.entityType] ?? a.entityType}</span>
                    {a.entityLabel && <b> — {a.entityLabel}</b>}
                  </div>
                  <div className="text-[11.5px] text-faint">
                    {datetime(a.createdAt)}
                    {a.ip && <span className="latin"> · {a.ip}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {tab === "sessions" && (
        <div className="grid gap-4 xl:grid-cols-3">
          <Card padded={false} title="الجلسات" subtitle="آخر 30 جلسة" className="xl:col-span-2">
            {sessions.length === 0 ? (
              <EmptyState title="لا توجد جلسات" />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <th>الجهاز</th>
                    <th>IP</th>
                    <th>بدأت</th>
                    <th>تنتهي</th>
                    <th>الحالة</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => {
                    const active = !s.revokedAt && s.expiresAt > now;
                    return (
                      <tr key={s.id}>
                        <td className="max-w-[260px] truncate latin text-[12px] text-muted" title={s.device ?? ""}>
                          {s.device ?? "—"}
                        </td>
                        <td className="latin">{s.ip ?? "—"}</td>
                        <td>{datetime(s.createdAt)}</td>
                        <td>{datetime(s.expiresAt)}</td>
                        <td>{active ? <Tag tone="success">نشطة</Tag> : s.revokedAt ? <Tag tone="neutral">منتهية</Tag> : <Tag tone="neutral">منتهية الصلاحية</Tag>}</td>
                        <td>
                          {active && canManage && (
                            <ActionButton action={revokeSession} hidden={{ sessionId: s.id }} className="btn btn-danger-soft btn-xs">
                              إنهاء الجلسة
                            </ActionButton>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
