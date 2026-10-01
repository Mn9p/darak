import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, num, date, relative, datetime, pct } from "@/lib/format";
import { PLANS, ORG_STATUS, INTEGRATION_PROVIDERS, TICKET_PRIORITY } from "@/lib/constants";
import { StatCard, StatGrid, Card, StatusTag, Table, EmptyState, Tag, Progress, ActionButton } from "@/components/ui";
import { LogoMark } from "@/components/Logo";
import { dbPing } from "./_shared";
import { prepareTestAccounts } from "./actions";
import { TEST_ACCOUNTS, availableTestAccounts, testAccountsEnabled } from "@/lib/test-accounts";
import { displayPhone } from "@/lib/phone";

export const dynamic = "force-dynamic";
// "تجهيز الحسابات التجريبية" builds a whole sandbox office in one action; give it more than the default serverless time.
export const maxDuration = 60;

export default async function AdminOverview() {
  const user = await requireSuperAdmin();
  const [orgs, orgsByStatus, units, users, contracts, tenants, recentOrgs, openTickets, ticketsList, errorIntegrations, lastAudit, lastNotification, ping, newRequests] = await Promise.all([
    db.organization.findMany({ select: { id: true, plan: true, status: true } }),
    db.organization.groupBy({ by: ["status"], _count: true }),
    db.unit.count({ where: { status: { not: "ARCHIVED" } } }),
    db.user.count({ where: { status: "ACTIVE", role: { not: "SUPER_ADMIN" } } }),
    db.contract.count({ where: { status: { in: ["ACTIVE", "EXPIRING_SOON", "RENEWAL_PENDING"] } } }),
    db.tenant.count(),
    db.organization.findMany({ orderBy: { createdAt: "desc" }, take: 6, select: { id: true, name: true, city: true, plan: true, status: true, createdAt: true, _count: { select: { users: true, units: true } } } }),
    db.supportTicket.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] } } }),
    db.supportTicket.findMany({ where: { status: { in: ["OPEN", "IN_PROGRESS"] } }, orderBy: [{ priority: "desc" }, { createdAt: "asc" }], take: 6, include: { organization: { select: { name: true } } } }),
    db.integration.findMany({ where: { status: "ERROR" }, include: { organization: { select: { id: true, name: true } } }, orderBy: { updatedAt: "desc" } }),
    db.auditLog.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    db.notification.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    dbPing(),
    db.accessRequest.count({ where: { status: "NEW" } }),
  ]);

  const count = (s: string) => orgsByStatus.find((o) => o.status === s)?._count ?? 0;
  const mrr = orgs.filter((o) => o.status === "ACTIVE").reduce((s, o) => s + (PLANS[o.plan]?.price ?? 0), 0);
  const arr = mrr * 12;
  const byPlan = Object.keys(PLANS).map((p) => ({ plan: p, n: orgs.filter((o) => o.plan === p).length }));
  const lastJob = [lastAudit?.createdAt, lastNotification?.createdAt].filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0] ?? null;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <LogoMark size={40} />
          <div className="leading-tight">
            <div className="text-[12.5px] text-muted">إدارة المنصة · {date(new Date())}</div>
            <h1 className="text-[22px] font-bold text-ink">مرحبًا، {user.name.split(" ")[0]}</h1>
          </div>
        </div>
        <Link href="/admin/organizations/new" className="btn btn-primary btn-sm">مكتب جديد</Link>
      </div>

      <StatGrid cols={5}>
        <StatCard label="المكاتب النشطة" value={num(count("ACTIVE"))} sub={`${num(count("TRIAL"))} تجريبي · ${num(count("SUSPENDED"))} موقوف`} href="/admin/organizations" dark />
        <StatCard label="طلبات حسابات جديدة" value={num(newRequests)} sub="من نموذج «اطلب حسابًا»" tone={newRequests > 0 ? "info" : undefined} href="/admin/requests" />
        <StatCard label="الإيراد الشهري المتوقع" value={money(mrr)} sub={`سنوي ≈ ${money(arr)}`} href="/admin/subscriptions" />
        <StatCard label="الوحدات المدارة" value={num(units)} sub={`${num(users)} مستخدم · ${num(contracts)} عقد نشط · ${num(tenants)} مستأجر`} />
        <StatCard label="تذاكر مفتوحة" value={num(openTickets)} tone={openTickets > 0 ? "warning" : undefined} href="/admin/support" />
      </StatGrid>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title="حالة النظام" subtitle="فحص مباشر" actions={<Link href="/admin/health" className="link text-xs">التفاصيل</Link>}>
          <div className="space-y-2.5 text-[13px]">
            <Row label="قاعدة البيانات" ok={ping.ok} v={ping.ok ? `${ping.latencyMs} ms` : "خطأ"} />
            <Row label="المهام المجدولة" ok={Boolean(lastJob && Date.now() - lastJob.getTime() < 86400000 * 2)} v={lastJob ? relative(lastJob) : "لم تُشغّل"} />
            <Row label="التكاملات" ok={errorIntegrations.length === 0} v={errorIntegrations.length ? `${errorIntegrations.length} خطأ` : "سليمة"} />
            <Row label="هدف التوفر" ok v="99.9%" />
          </div>
        </Card>

        <Card title="توزيع الخطط" subtitle="عدد المكاتب حسب الخطة">
          <div className="space-y-3">
            {byPlan.map((b) => (
              <div key={b.plan}>
                <div className="mb-1 flex justify-between text-[12.5px]">
                  <span>{PLANS[b.plan].label} <span className="num text-muted">({PLANS[b.plan].price ? `${money(PLANS[b.plan].price)} ر.س/شهر` : "حسب الاتفاق"})</span></span>
                  <b className="num">{b.n}</b>
                </div>
                <Progress value={orgs.length ? (b.n / orgs.length) * 100 : 0} tone={b.plan === "ENTERPRISE" ? "sand" : undefined} />
              </div>
            ))}
            <div className="text-[11.5px] text-muted">نسبة النشط: <b className="num">{pct(orgs.length ? (count("ACTIVE") / orgs.length) * 100 : 0, 0)}</b> من {num(orgs.length)} مكتب</div>
          </div>
        </Card>

        <Card title="تكاملات بحالة خطأ" subtitle="عبر جميع المكاتب">
          {errorIntegrations.length === 0 ? (
            <EmptyState title="لا توجد أخطاء" />
          ) : (
            <ul className="divide-y divide-line">
              {errorIntegrations.slice(0, 6).map((i) => (
                <li key={i.id} className="py-2 text-[13px]">
                  <div className="flex items-center justify-between gap-2">
                    <Link href={`/admin/organizations/${i.organization.id}`} className="link">{i.organization.name}</Link>
                    <Tag tone="danger" plain>{INTEGRATION_PROVIDERS[i.provider]?.label ?? i.provider}</Tag>
                  </div>
                  <div className="truncate text-[11.5px] text-muted">{i.lastError ?? "—"}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card title="أحدث المكاتب" actions={<Link href="/admin/organizations" className="link text-xs">كل المكاتب</Link>} padded={false}>
          <Table>
            <thead>
              <tr>
                <th>المكتب</th>
                <th>المدينة</th>
                <th>الخطة</th>
                <th>الوحدات / المستخدمون</th>
                <th>الحالة</th>
                <th>انضم</th>
              </tr>
            </thead>
            <tbody>
              {recentOrgs.map((o) => (
                <tr key={o.id}>
                  <td><Link href={`/admin/organizations/${o.id}`} className="link">{o.name}</Link></td>
                  <td>{o.city ?? "—"}</td>
                  <td>{PLANS[o.plan]?.label ?? o.plan}</td>
                  <td className="num">{o._count.units} / {o._count.users}</td>
                  <td><StatusTag value={o.status} map={ORG_STATUS} /></td>
                  <td className="num">{date(o.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
        <Card title="تذاكر الدعم المفتوحة" actions={<Link href="/admin/support" className="link text-xs">مركز الدعم</Link>} padded={false}>
          {ticketsList.length === 0 ? (
            <EmptyState title="لا توجد تذاكر مفتوحة" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>الموضوع</th>
                  <th>المكتب</th>
                  <th>الأولوية</th>
                  <th>الحالة</th>
                  <th>منذ</th>
                </tr>
              </thead>
              <tbody>
                {ticketsList.map((t) => (
                  <tr key={t.id}>
                    <td className="max-w-xs truncate font-semibold">{t.subject}</td>
                    <td>{t.organization.name}</td>
                    <td><StatusTag value={t.priority} map={TICKET_PRIORITY} /></td>
                    <td><Tag tone={t.status === "OPEN" ? "warning" : "info"}>{t.status === "OPEN" ? "مفتوحة" : "قيد المعالجة"}</Tag></td>
                    <td className="num">{datetime(t.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <TestAccountsCard />
    </>
  );
}

/** One fake number per role for demos and testing: the code shows on the login screen, no SMS is sent. */
async function TestAccountsCard() {
  if (!testAccountsEnabled()) return null;
  const ready = await availableTestAccounts();
  const have = new Set(ready.map((a) => a.phone));
  return (
    <Card
      className="mt-4"
      title="الحسابات التجريبية"
      subtitle="رقم وهمي لكل دور داخل مكتب تجريبي منفصل. رمز الدخول يظهر على الشاشة ولا تُرسل رسالة. أوقفها عند الإطلاق بـ TEST_ACCOUNTS=off."
      actions={
        ready.length < TEST_ACCOUNTS.length ? (
          <ActionButton action={prepareTestAccounts} className="btn btn-primary btn-sm">
            تجهيز الحسابات التجريبية
          </ActionButton>
        ) : undefined
      }
    >
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {TEST_ACCOUNTS.map((a) => (
          <li key={a.phone} className="rounded-xl border border-line px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <b className="num text-[15px]">{displayPhone(a.phone)}</b>
              <Tag tone={have.has(a.phone) ? "success" : "neutral"} plain>
                {have.has(a.phone) ? "جاهز" : "غير موجود"}
              </Tag>
            </div>
            <div className="mt-1 text-[13px] font-bold text-ink">{a.label}</div>
            <div className="text-[12px] text-muted">{a.hint}</div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Row({ label, ok, v }: { label: string; ok: boolean; v: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-mist px-3 py-2">
      <span className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${ok ? "bg-success" : "bg-danger"}`} />
        {label}
      </span>
      <span className={`num font-bold ${ok ? "text-success" : "text-danger"}`}>{v}</span>
    </div>
  );
}
