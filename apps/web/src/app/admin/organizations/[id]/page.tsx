import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSuperAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { num, date, datetime, inputDate, money, pct, daysFromToday } from "@/lib/format";
import { displayPhone } from "@/lib/phone";
import { PLANS, ORG_STATUS, ROLES, USER_STATUS, INTEGRATION_PROVIDERS, INTEGRATION_STATUS, AUDIT_ACTIONS, TICKET_PRIORITY, TICKET_STATUS } from "@/lib/constants";
import { PageHeader, Card, Table, StatusTag, Tabs, DL, StatGrid, StatCard, Progress, EmptyState, ActionButton, Tag, Alert, Field, Input, Textarea } from "@/components/ui";
import { OrgLimitsForm } from "../OrgLimitsForm";
import { MoreMenu } from "@/components/MoreMenu";
import { updateOrganizationLimits, toggleFeatureFlag, supportAccess } from "../../actions";
import { FEATURE_FLAGS, readFlags } from "../../_shared";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "overview", label: "نظرة عامة" },
  { key: "subscription", label: "الاشتراك والحدود" },
  { key: "features", label: "الخصائص" },
  { key: "users", label: "المستخدمون" },
  { key: "integrations", label: "التكاملات" },
  { key: "support", label: "الدعم" },
  { key: "audit", label: "سجل العمليات" },
];

export default async function OrganizationDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; error?: string }> }) {
  await requireSuperAdmin();
  const { id } = await params;
  const { tab = "overview", error } = await searchParams;

  const org = await db.organization.findUnique({
    where: { id },
    include: {
      _count: { select: { users: true, units: { where: { status: { not: "ARCHIVED" } } }, properties: true, contracts: { where: { status: { in: ["ACTIVE", "EXPIRING_SOON", "RENEWAL_PENDING"] } } }, tenants: true, owners: true } },
      users: { orderBy: [{ role: "asc" }, { name: "asc" }], select: { id: true, name: true, phone: true, email: true, role: true, status: true, lastLoginAt: true, createdAt: true } },
      integrations: { orderBy: { provider: "asc" } },
      supportTickets: { orderBy: { createdAt: "desc" }, take: 20, include: { user: { select: { name: true } } } },
      auditLogs: { orderBy: { createdAt: "desc" }, take: 40 },
      branches: { select: { id: true, name: true, city: true, isMain: true } },
    },
  });
  if (!org) notFound();

  const activeUsers = org.users.filter((u) => u.status === "ACTIVE").length;
  const unitsPct = org.unitsLimit ? (org._count.units / org.unitsLimit) * 100 : 0;
  const usersPct = org.usersLimit ? (activeUsers / org.usersLimit) * 100 : 0;
  const flags = readFlags(org.settings);
  const renewalLeft = org.renewalDate ? daysFromToday(org.renewalDate) : null;
  const plan = PLANS[org.plan];
  const supportLogs = org.auditLogs.filter((a) => a.action === "SUPPORT_ACCESS");

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {org.name} <StatusTag value={org.status} map={ORG_STATUS} />
          </span>
        }
        subtitle={<span className="latin">{org.slug} · {plan?.label ?? org.plan} · {org.city ?? ""}</span>}
        breadcrumbs={[{ label: "العملاء", href: "/admin/organizations" }, { label: org.name }]}
        actions={
          <>
            <MoreMenu
              items={[
                { label: "الاشتراك والحدود", href: `/admin/organizations/${org.id}?tab=subscription` },
                { label: "تذاكر هذا المكتب", href: `/admin/support?org=${org.id}` },
                { label: "السجل الكامل", href: `/admin/audit?org=${org.id}` },
              ]}
            />
            <Link href={`/admin/organizations/${org.id}?tab=support`} className="btn btn-primary btn-sm">دخول دعم فني</Link>
          </>
        }
      />

      {error === "reason" && <div className="mb-4"><Alert tone="danger">يرجى كتابة سبب واضح لدخول الدعم الفني (5 أحرف على الأقل).</Alert></div>}
      {error === "nomanager" && <div className="mb-4"><Alert tone="danger">لا يوجد مدير مكتب نشط في هذا المكتب لتنفيذ دخول الدعم الفني.</Alert></div>}
      {error === "duration" && <div className="mb-4"><Alert tone="danger">مدة جلسة الدعم يجب أن تكون بين 15 و240 دقيقة.</Alert></div>}

      <StatGrid cols={4}>
        <StatCard label="الوحدات" value={`${num(org._count.units)} / ${num(org.unitsLimit)}`} sub={<Progress value={unitsPct} tone={unitsPct >= 90 ? "danger" : unitsPct >= 75 ? "warn" : undefined} />} />
        <StatCard label="المستخدمون النشطون" value={`${num(activeUsers)} / ${num(org.usersLimit)}`} sub={<Progress value={usersPct} tone={usersPct >= 90 ? "danger" : usersPct >= 75 ? "warn" : undefined} />} />
        <StatCard label="الاشتراك الشهري" value={plan?.price ? money(plan.price) : "اتفاق"} sub={`${plan?.label ?? org.plan} · ${num(org._count.properties)} عقار · ${num(org._count.contracts)} عقد نشط`} dark />
        <StatCard label="التجديد" value={renewalLeft === null ? "—" : renewalLeft < 0 ? "منتهي" : `${num(renewalLeft)} يوم`} sub={date(org.renewalDate)} tone={renewalLeft !== null && renewalLeft <= 30 ? "warning" : undefined} />
      </StatGrid>

      <div className="mt-4">
        <Tabs tabs={TABS} active={tab} base={`/admin/organizations/${org.id}`} />
      </div>

      {tab === "overview" && (
        <div className="grid gap-4 xl:grid-cols-3">
          <Card title="بيانات المكتب" className="xl:col-span-2">
            <DL
              cols={3}
              items={[
                { label: "الاسم", value: org.name },
                { label: "المعرّف", value: <span className="latin">{org.slug}</span> },
                { label: "المدينة", value: org.city },
                { label: "الهاتف", value: <span className="latin">{org.phone}</span> },
                { label: "البريد", value: <span className="latin">{org.email}</span> },
                { label: "السجل التجاري", value: <span className="latin">{org.crNumber}</span> },
                { label: "الرقم الضريبي", value: <span className="latin">{org.vatNumber}</span> },
                { label: "تاريخ الانضمام", value: <span className="num">{date(org.createdAt)}</span> },
                { label: "آخر تحديث", value: <span className="num">{datetime(org.updatedAt)}</span> },
              ]}
            />
            <div className="mt-4">
              <div className="mb-1 text-[12px] font-semibold text-muted">الفروع</div>
              <div className="flex flex-wrap gap-2">
                {org.branches.map((b) => (
                  <Tag key={b.id} tone={b.isMain ? "brand" : "neutral"} plain>{b.name}{b.city ? ` — ${b.city}` : ""}</Tag>
                ))}
              </div>
            </div>
          </Card>
          <Card title="الاستخدام">
            <div className="space-y-4 text-[13px]">
              <div>
                <div className="mb-1 flex justify-between"><span>الوحدات</span><b className="num">{pct(unitsPct, 0)}</b></div>
                <Progress value={unitsPct} tone={unitsPct >= 90 ? "danger" : unitsPct >= 75 ? "warn" : undefined} />
              </div>
              <div>
                <div className="mb-1 flex justify-between"><span>المستخدمون</span><b className="num">{pct(usersPct, 0)}</b></div>
                <Progress value={usersPct} tone={usersPct >= 90 ? "danger" : usersPct >= 75 ? "warn" : undefined} />
              </div>
              <div className="text-[12px] text-muted">آخر دخول دعم فني: {supportLogs[0] ? <span className="num">{datetime(supportLogs[0].createdAt)}</span> : "لا يوجد"}</div>
            </div>
          </Card>
        </div>
      )}

      {tab === "subscription" && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card title="الخطة والحدود" subtitle="تُسجَّل كل التغييرات في سجل العمليات">
            <OrgLimitsForm action={updateOrganizationLimits} org={{ id: org.id, plan: org.plan, status: org.status, unitsLimit: org.unitsLimit, usersLimit: org.usersLimit, renewalDate: inputDate(org.renewalDate) }} />
          </Card>
          <Card title="مقارنة الخطط" padded={false}>
            <Table>
              <thead>
                <tr>
                  <th>الخطة</th>
                  <th>الوحدات</th>
                  <th>المستخدمون</th>
                  <th>السعر / شهر</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(PLANS).map(([k, p]) => (
                  <tr key={k} className={k === org.plan ? "bg-sand-75/40" : ""}>
                    <td className="font-bold">{p.label}{k === org.plan && <Tag tone="brand" plain className="mr-2">الحالية</Tag>}</td>
                    <td className="num">{num(p.units)}</td>
                    <td className="num">{num(p.users)}</td>
                    <td className="num">{p.price ? `${money(p.price)} ر.س` : "حسب الاتفاق"}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>
      )}

      {tab === "features" && (
        <Card title="الخصائص المفعّلة" subtitle="تُخزَّن في إعدادات المكتب (settings.featureFlags)">
          <ul className="divide-y divide-line">
            {Object.entries(FEATURE_FLAGS).map(([key, label]) => (
              <li key={key} className="flex items-center justify-between py-3">
                <div>
                  <div className="text-[13.5px] font-bold text-text">{label}</div>
                  <div className="latin text-[11px] text-muted">{key}</div>
                </div>
                <div className="flex items-center gap-3">
                  <Tag tone={flags[key] ? "success" : "neutral"}>{flags[key] ? "مفعّل" : "معطّل"}</Tag>
                  <ActionButton action={toggleFeatureFlag} hidden={{ id: org.id, flag: key }} className={`btn btn-sm ${flags[key] ? "btn-danger-soft" : "btn-success-soft"}`}>
                    {flags[key] ? "تعطيل" : "تفعيل"}
                  </ActionButton>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {tab === "users" && (
        <Card padded={false} title="المستخدمون" subtitle={`${num(activeUsers)} نشط من أصل ${num(org.users.length)}`}>
          <Table>
            <thead>
              <tr>
                <th>الاسم</th>
                <th>البريد</th>
                <th>الدور</th>
                <th>الحالة</th>
                <th>آخر دخول</th>
                <th>أُنشئ</th>
              </tr>
            </thead>
            <tbody>
              {org.users.map((u) => (
                <tr key={u.id}>
                  <td className="font-semibold">{u.name}</td>
                  <td className="text-[12.5px]">
                    <span className="num">{displayPhone(u.phone)}</span>
                    {u.email && <div className="cell-sub latin">{u.email}</div>}
                  </td>
                  <td><StatusTag value={u.role} map={ROLES} /></td>
                  <td><StatusTag value={u.status} map={USER_STATUS} /></td>
                  <td className="num">{datetime(u.lastLoginAt)}</td>
                  <td className="num">{date(u.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {tab === "integrations" && (
        <Card padded={false} title="التكاملات">
          {org.integrations.length === 0 ? (
            <EmptyState title="لا توجد تكاملات مسجلة" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>المزود</th>
                  <th>الاسم</th>
                  <th>الحالة</th>
                  <th>آخر مزامنة</th>
                  <th>آخر خطأ</th>
                </tr>
              </thead>
              <tbody>
                {org.integrations.map((i) => (
                  <tr key={i.id}>
                    <td className="font-semibold">{INTEGRATION_PROVIDERS[i.provider]?.label ?? i.provider}</td>
                    <td>{i.name}</td>
                    <td><StatusTag value={i.status} map={INTEGRATION_STATUS} /></td>
                    <td className="num">{datetime(i.lastSyncAt)}</td>
                    <td className="max-w-xs truncate text-[12px] text-danger">{i.lastError ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {tab === "support" && (
        <div className="grid gap-4 xl:grid-cols-3">
          <Card tone="warm" title="دخول دعم فني" subtitle="يفتح جلسة مؤقتة باسم مدير المكتب؛ تنتهي تلقائيًا بعد المدة المحددة وتُسجَّل كل إجراءاتها باسم فريق دارك في سجل المكتب والمنصة">
            <form action={supportAccess} className="space-y-3">
              <input type="hidden" name="id" value={org.id} />
              <Field label="سبب الدخول" name="reason" required help="يظهر في سجل العمليات للمكتب">
                <Textarea name="reason" rows={3} required minLength={5} placeholder="مثال: تذكرة #12 — فحص خطأ الربط البنكي" />
              </Field>
              <Field label="المدة (دقائق)" name="duration" help="من 15 إلى 240 دقيقة">
                <Input name="duration" type="number" min={15} max={240} step={1} defaultValue={60} />
              </Field>
              <button type="submit" className="btn btn-primary w-full">بدء جلسة الدعم والانتقال إلى المكتب</button>
              <p className="text-[11.5px] text-muted">ستُستبدل جلستك الحالية بجلسة مدير المكتب. يمكنك إنهاؤها في أي وقت من الشريط العلوي، ثم تسجيل الدخول مجددًا إلى حساب المنصة.</p>
            </form>
          </Card>
          <div className="space-y-4 xl:col-span-2">
            <Card title="تذاكر الدعم" actions={<Link href={`/admin/support?org=${org.id}`} className="link text-xs">مركز الدعم</Link>} padded={false}>
              {org.supportTickets.length === 0 ? (
                <EmptyState title="لا توجد تذاكر" />
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <th>الموضوع</th>
                      <th>مقدم الطلب</th>
                      <th>الأولوية</th>
                      <th>الحالة</th>
                      <th>التاريخ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {org.supportTickets.map((t) => (
                      <tr key={t.id}>
                        <td className="font-semibold">{t.subject}</td>
                        <td>{t.user?.name ?? "—"}</td>
                        <td><StatusTag value={t.priority} map={TICKET_PRIORITY} /></td>
                        <td><StatusTag value={t.status} map={TICKET_STATUS} /></td>
                        <td className="num">{datetime(t.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
            <Card title="سجل دخول الدعم الفني" padded={false}>
              {supportLogs.length === 0 ? (
                <EmptyState title="لم يتم أي دخول دعم فني" />
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <th>بواسطة</th>
                      <th>التفاصيل</th>
                      <th>التاريخ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {supportLogs.map((a) => (
                      <tr key={a.id}>
                        <td>{a.userName}</td>
                        <td className="max-w-md truncate text-[12px] text-muted">{a.newValue}</td>
                        <td className="num">{datetime(a.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          </div>
        </div>
      )}

      {tab === "audit" && (
        <Card padded={false} title="سجل العمليات" subtitle="آخر 40 عملية" actions={<Link href={`/admin/audit?org=${org.id}`} className="link text-xs">السجل الكامل</Link>}>
          {org.auditLogs.length === 0 ? (
            <EmptyState title="لا توجد عمليات مسجلة" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>المستخدم</th>
                  <th>الإجراء</th>
                  <th>الكيان</th>
                  <th>التفاصيل</th>
                </tr>
              </thead>
              <tbody>
                {org.auditLogs.map((a) => (
                  <tr key={a.id}>
                    <td className="num">{datetime(a.createdAt)}</td>
                    <td>{a.userName ?? "—"}</td>
                    <td><StatusTag value={a.action} map={AUDIT_ACTIONS} /></td>
                    <td>{a.entityType}{a.entityLabel ? ` — ${a.entityLabel}` : ""}</td>
                    <td className="max-w-xs truncate text-[12px] text-muted">{a.newValue ?? a.oldValue ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}
    </>
  );
}
