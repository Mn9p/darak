import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { NOTIFICATION_EVENTS, NOTIFICATION_CHANNELS, ENTITY_TYPES, RULE_AUDIENCES, type StatusMeta } from "@/lib/constants";
import { datetime, relative, safeJson, pageParam } from "@/lib/format";
import { displayPhone } from "@/lib/phone";
import { PageHeader, Card, Tabs, Tag, StatusTag, EmptyState, Pagination, FilterBar, Select, ActionButton, Table, Alert } from "@/components/ui";
import { MoreFilters } from "@/components/MoreFilters";
import { markRead, markUnread, markAllRead, createRule, updateRule, toggleRule, deleteRule, createTemplate, updateTemplate, toggleTemplate, savePreferences, type Preferences } from "./actions";
import { RuleForm } from "./RuleForm";
import { TemplateForm } from "./TemplateForm";
import { TEMPLATE_VARS, renderTemplate } from "./templating";

export const dynamic = "force-dynamic";
const PAGE = 30;

const SEVERITY: Record<string, StatusMeta> = {
  INFO: { label: "معلومة", tone: "info" },
  WARNING: { label: "تنبيه", tone: "warning" },
  DANGER: { label: "عاجل", tone: "danger" },
  SUCCESS: { label: "نجاح", tone: "success" },
};

const TABS = [
  { key: "inbox", label: "الإشعارات" },
  { key: "rules", label: "القواعد" },
  { key: "templates", label: "القوالب" },
  { key: "preferences", label: "التفضيلات" },
];

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireStaff();
  const sp = await searchParams;
  const tab = sp.tab && TABS.some((t) => t.key === sp.tab) ? sp.tab : "inbox";
  const org = user.organizationId;
  const manage = can(user, "settings.manage");
  const unread = await db.notification.count({ where: { userId: user.id, organizationId: org, readAt: null } });

  return (
    <>
      <PageHeader
        title="الإشعارات"
        actions={
          tab === "inbox" && unread > 0 ? (
            <ActionButton action={markAllRead} className="btn btn-primary btn-sm">
              تعليم الكل كمقروء ({unread})
            </ActionButton>
          ) : undefined
        }
      />
      <Tabs tabs={TABS.map((t) => (t.key === "inbox" ? { ...t, count: unread } : t))} active={tab} base="/notifications" />
      {tab === "inbox" && <Inbox userId={user.id} org={org} sp={sp} />}
      {tab === "rules" && <RulesTab org={org} manage={manage} editId={sp.edit} />}
      {tab === "templates" && <TemplatesTab org={org} manage={manage} editId={sp.edit} />}
      {tab === "preferences" && <PreferencesTab userId={user.id} />}
    </>
  );
}

/* ───────────── Inbox ───────────── */

async function Inbox({ userId, org, sp }: { userId: string; org: string; sp: Record<string, string | undefined> }) {
  const page = pageParam(sp.page);
  const where = {
    userId,
    organizationId: org,
    ...(sp.unread === "1" ? { readAt: null } : {}),
    ...(sp.severity ? { severity: sp.severity } : {}),
    ...(sp.entityType ? { entityType: sp.entityType } : {}),
  };
  const [total, rows, types] = await Promise.all([
    db.notification.count({ where }),
    db.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE }),
    db.notification.groupBy({ by: ["entityType"], where: { userId, organizationId: org }, _count: true }),
  ]);
  const hasFilters = Boolean(sp.unread || sp.severity || sp.entityType);
  return (
    <Card padded={false}>
      <div className="px-4 pt-4">
        <FilterBar base="/notifications" hasFilters={hasFilters}>
          <input type="hidden" name="tab" value="inbox" />
          <Select name="unread" options={{ "1": "غير المقروءة فقط" }} placeholder="الكل" defaultValue={sp.unread ?? ""} className="!w-40" />
          <Select name="severity" options={SEVERITY} placeholder="كل الدرجات" defaultValue={sp.severity ?? ""} className="!w-36" />
          <MoreFilters open={Boolean(sp.entityType)}>
            <Select name="entityType" options={types.filter((t) => t.entityType).map((t) => ({ value: t.entityType!, label: `${ENTITY_TYPES[t.entityType!] ?? t.entityType} (${t._count})` }))} placeholder="كل الأنواع" defaultValue={sp.entityType ?? ""} className="!w-44" />
          </MoreFilters>
        </FilterBar>
      </div>
      {rows.length === 0 ? (
        <EmptyState title={hasFilters ? "لا توجد إشعارات مطابقة" : "لا توجد إشعارات"} description="ستصلك هنا تنبيهات الاستحقاق والتأخر وانتهاء العقود." action={hasFilters ? <Link href="/notifications" className="btn btn-outline">عرض الكل</Link> : undefined} />
      ) : (
        <ul className="divide-y divide-line-soft">
          {rows.map((n) => (
            <li key={n.id} className={`flex items-start gap-3 px-5 py-3 ${n.readAt ? "" : "bg-sand-75/40"}`}>
              <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${n.readAt ? "bg-transparent" : "bg-brand"}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusTag value={n.severity} map={SEVERITY} />
                  {n.href ? (
                    <Link href={n.href} className={`text-[13.5px] hover:text-brand ${n.readAt ? "text-text-2" : "font-bold text-text"}`}>
                      {n.title}
                    </Link>
                  ) : (
                    <span className={`text-[13.5px] ${n.readAt ? "text-text-2" : "font-bold text-text"}`}>{n.title}</span>
                  )}
                </div>
                {n.body && <p className="mt-0.5 text-[12.5px] text-muted">{n.body}</p>}
                <div className="mt-1 flex flex-wrap gap-2 text-[11.5px] text-faint">
                  <span title={datetime(n.createdAt)}>{relative(n.createdAt)}</span>
                  {n.entityType && <span>· {ENTITY_TYPES[n.entityType] ?? n.entityType}</span>}
                  <span>· {NOTIFICATION_CHANNELS[n.channel] ?? n.channel}</span>
                  {n.readAt && <span>· قُرئ {relative(n.readAt)}</span>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {n.href && (
                  <Link href={n.href} className="btn btn-ghost btn-xs">
                    فتح
                  </Link>
                )}
                {n.readAt ? (
                  <ActionButton action={markUnread} hidden={{ id: n.id }} className="btn btn-link btn-xs">
                    غير مقروء
                  </ActionButton>
                ) : (
                  <ActionButton action={markRead} hidden={{ id: n.id }} className="btn btn-outline btn-xs">
                    تعليم كمقروء
                  </ActionButton>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={page} pageSize={PAGE} total={total} base="/notifications" params={{ ...sp, tab: "inbox" }} />
    </Card>
  );
}

/* ───────────── Rules ───────────── */

async function RulesTab({ org, manage, editId }: { org: string; manage: boolean; editId?: string }) {
  const rules = await db.notificationRule.findMany({ where: { organizationId: org }, orderBy: [{ event: "asc" }, { daysBefore: "desc" }] });
  const editing = editId ? rules.find((r) => r.id === editId) : null;
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card className="xl:col-span-2" padded={false} title={`قواعد التنبيه (${rules.length})`}>
        {rules.length === 0 ? (
          <EmptyState title="لا توجد قواعد" description="أضف قاعدة لتنبيه الفريق قبل انتهاء العقود أو عند تأخر الدفعات." />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>القاعدة</th>
                <th className="num">قبل (يوم)</th>
                <th>القنوات</th>
                <th>الأدوار</th>
                <th>الحالة</th>
                {manage && <th></th>}
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} className={editing?.id === r.id ? "bg-sand-75/40" : ""}>
                  <td>
                    <div className="cell-primary">{r.name}</div>
                    <div className="cell-sub">
                      {NOTIFICATION_EVENTS[r.event] ?? r.event}
                      {r.createTask ? " · مع مهمة تلقائية" : ""}
                    </div>
                  </td>
                  <td className="num">{r.daysBefore}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {r.channels.split(",").filter(Boolean).map((c) => (
                        <Tag key={c} tone="neutral" plain>
                          {NOTIFICATION_CHANNELS[c] ?? c}
                        </Tag>
                      ))}
                    </div>
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {[...new Set(r.targetRoles.split(",").filter(Boolean))].map((c) => (
                        <Tag key={c} tone="info" plain>
                          {RULE_AUDIENCES[c] ?? c}
                        </Tag>
                      ))}
                    </div>
                  </td>
                  <td>
                    {manage ? (
                      <ActionButton action={toggleRule} hidden={{ id: r.id }} className={`tag ${r.isActive ? "tag-success" : "tag-neutral"} cursor-pointer`}>
                        {r.isActive ? "نشطة" : "متوقفة"}
                      </ActionButton>
                    ) : (
                      <Tag tone={r.isActive ? "success" : "neutral"}>{r.isActive ? "نشطة" : "متوقفة"}</Tag>
                    )}
                  </td>
                  {manage && (
                    <td>
                      <div className="flex items-center gap-1">
                        <Link href={`/notifications?tab=rules&edit=${r.id}`} className="btn btn-ghost btn-xs">
                          تعديل
                        </Link>
                        <ActionButton action={deleteRule} hidden={{ id: r.id }} className="btn btn-link btn-xs text-danger" confirm="حذف القاعدة؟">
                          حذف
                        </ActionButton>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <div>
        {manage ? (
          <RuleForm key={editing?.id ?? "new"} action={editing ? updateRule : createRule} rule={editing} />
        ) : (
          <Alert tone="neutral">إدارة القواعد متاحة لصاحب الحساب فقط.</Alert>
        )}
      </div>
    </div>
  );
}

/* ───────────── Templates ───────────── */

async function TemplatesTab({ org, manage, editId }: { org: string; manage: boolean; editId?: string }) {
  const templates = await db.notificationTemplate.findMany({ where: { organizationId: org }, orderBy: [{ event: "asc" }, { channel: "asc" }] });
  const editing = editId ? templates.find((t) => t.id === editId) : null;
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <div className="space-y-3 xl:col-span-2">
        {templates.length === 0 ? (
          <Card>
            <EmptyState title="لا توجد قوالب" description="أضف قالب رسالة للتذكير بالاستحقاق أو انتهاء العقد." />
          </Card>
        ) : (
          templates.map((t) => (
            <Card key={t.id} className={editing?.id === t.id ? "!border-brand" : ""}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <b className="text-[14px]">{t.name}</b>
                    <Tag tone="info" plain>
                      {NOTIFICATION_EVENTS[t.event] ?? t.event}
                    </Tag>
                    <Tag tone="neutral" plain>
                      {NOTIFICATION_CHANNELS[t.channel] ?? t.channel}
                    </Tag>
                    <Tag tone="neutral" plain className="latin">
                      {t.language}
                    </Tag>
                    {manage ? (
                      <ActionButton action={toggleTemplate} hidden={{ id: t.id }} className={`tag ${t.isActive ? "tag-success" : "tag-neutral"} cursor-pointer`}>
                        {t.isActive ? "نشط" : "متوقف"}
                      </ActionButton>
                    ) : (
                      <Tag tone={t.isActive ? "success" : "neutral"}>{t.isActive ? "نشط" : "متوقف"}</Tag>
                    )}
                  </div>
                  <p className="mt-2 rounded-lg bg-mist px-3 py-2 text-[13px] text-text-2" dir="auto">
                    {t.body}
                  </p>
                  <div className="mt-2 text-[11.5px] font-bold text-muted">معاينة</div>
                  <p className="text-[13px]" dir="auto">
                    {renderTemplate(t.body)}
                  </p>
                </div>
                {manage && (
                  <Link href={`/notifications?tab=templates&edit=${t.id}`} className="btn btn-ghost btn-xs">
                    تعديل
                  </Link>
                )}
              </div>
            </Card>
          ))
        )}
      </div>
      <div className="space-y-4">
        {manage ? (
          <TemplateForm key={editing?.id ?? "new"} action={editing ? updateTemplate : createTemplate} template={editing} />
        ) : (
          <Alert tone="neutral">إدارة القوالب متاحة لصاحب الحساب فقط.</Alert>
        )}
        <Card title="المتغيرات المتاحة">
          <ul className="space-y-1 text-[12.5px]">
            {TEMPLATE_VARS.map((v) => (
              <li key={v.key} className="flex items-center justify-between">
                <span className="latin text-brand">{`{{${v.key}}}`}</span>
                <span className="text-muted">{v.label}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

/* ───────────── Preferences ───────────── */

async function PreferencesTab({ userId }: { userId: string }) {
  const me = await db.user.findUnique({ where: { id: userId }, select: { preferences: true, email: true, phone: true } });
  const prefsAll = safeJson<{ notifications?: Preferences; digest?: string; quietHours?: { from: string; to: string } | null }>(me?.preferences, {});
  const prefs = prefsAll.notifications ?? {};
  const channels = Object.keys(NOTIFICATION_CHANNELS);
  const isOn = (ev: string, ch: string) => (prefs[ev] ? prefs[ev].includes(ch) : ch === "IN_APP");
  return (
    <form action={savePreferences}>
      <Card title="تفضيلات الإشعارات" subtitle="اختر قنوات الاستلام لكل حدث." padded={false}>
        <Table>
          <thead>
            <tr>
              <th>الحدث</th>
              {channels.map((c) => (
                <th key={c} className="text-center">
                  {NOTIFICATION_CHANNELS[c]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.entries(NOTIFICATION_EVENTS).map(([ev, label]) => (
              <tr key={ev}>
                <td className="cell-primary">{label}</td>
                {channels.map((c) => (
                  <td key={c} className="text-center">
                    <input type="checkbox" name={`pref_${ev}`} value={c} defaultChecked={isOn(ev, c)} aria-label={`${label} — ${NOTIFICATION_CHANNELS[c]}`} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </Table>
        <div className="flex flex-wrap items-end gap-3 border-t border-line px-5 py-4">
          <label className="field">
            <span className="label">تجميع الإشعارات</span>
            <select name="digest" className="select !w-44" defaultValue={prefsAll.digest ?? "instant"}>
              <option value="instant">فوري</option>
              <option value="daily">ملخص يومي</option>
              <option value="weekly">ملخص أسبوعي</option>
            </select>
          </label>
          <label className="field">
            <span className="label">ساعات الهدوء من</span>
            <input type="time" name="quietFrom" className="input !w-32" defaultValue={prefsAll.quietHours?.from ?? ""} />
          </label>
          <label className="field">
            <span className="label">إلى</span>
            <input type="time" name="quietTo" className="input !w-32" defaultValue={prefsAll.quietHours?.to ?? ""} />
          </label>
          <span className="mr-auto text-[12px] text-muted">
            تصل إلى: <span className="latin">{[me?.phone ? displayPhone(me.phone) : null, me?.email].filter(Boolean).join(" · ") || "—"}</span>
          </span>
          <button type="submit" className="btn btn-primary btn-sm">
            حفظ
          </button>
        </div>
      </Card>
    </form>
  );
}
