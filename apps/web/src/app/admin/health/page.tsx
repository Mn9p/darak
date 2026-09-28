import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { num, datetime, relative, safeJson, addDays } from "@/lib/format";
import { INTEGRATION_PROVIDERS, INTEGRATION_STATUS } from "@/lib/constants";
import { PageHeader, Card, Table, StatusTag, EmptyState, StatGrid, StatCard, ActionButton, Alert, Tag } from "@/components/ui";
import { dbPing } from "../_shared";
import { runScheduledJobsNow } from "../actions";

export const dynamic = "force-dynamic";

export default async function HealthPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireSuperAdmin();
  const sp = await searchParams;
  const now = new Date();
  const dayAgo = addDays(now, -1);

  const [ping, lastRun, runs, integrationsByStatus, errorIntegrations, integrationErrors, sessions, notifications24h, undelivered, audit24h, failedImports, orgs, lastAudit] = await Promise.all([
    dbPing(),
    db.auditLog.findFirst({ where: { action: "SYNC", entityType: "SYSTEM" }, orderBy: { createdAt: "desc" } }),
    db.auditLog.findMany({ where: { action: "SYNC", entityType: "SYSTEM" }, orderBy: { createdAt: "desc" }, take: 10 }),
    db.integration.groupBy({ by: ["status"], _count: true }),
    db.integration.findMany({ where: { status: { in: ["ERROR", "SYNCING"] } }, include: { organization: { select: { id: true, name: true } } }, orderBy: { updatedAt: "desc" } }),
    db.integrationLog.findMany({ where: { level: "ERROR" }, orderBy: { createdAt: "desc" }, take: 15, include: { integration: { select: { provider: true, organization: { select: { id: true, name: true } } } } } }),
    db.session.count({ where: { revokedAt: null, expiresAt: { gt: now } } }),
    db.notification.count({ where: { createdAt: { gte: dayAgo } } }),
    db.notification.count({ where: { deliveredAt: null, channel: { not: "IN_APP" } } }),
    db.auditLog.count({ where: { createdAt: { gte: dayAgo } } }),
    db.importJob.count({ where: { status: "FAILED", createdAt: { gte: addDays(now, -7) } } }),
    db.organization.count({ where: { status: { not: "SUSPENDED" } } }),
    db.auditLog.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);

  const iCount = (s: string) => integrationsByStatus.find((i) => i.status === s)?._count ?? 0;
  const jobsFresh = Boolean(lastRun && now.getTime() - lastRun.createdAt.getTime() < 86400000);
  const errorCount = iCount("ERROR");
  const checks = [
    { label: "قاعدة البيانات", ok: ping.ok, value: ping.ok ? `${ping.latencyMs} ms` : ping.error ?? "خطأ" },
    { label: "المهام المجدولة (آخر 24 ساعة)", ok: jobsFresh, value: lastRun ? relative(lastRun.createdAt) : "لم تُشغّل يدويًا بعد" },
    { label: "التكاملات", ok: errorCount === 0, value: errorCount ? `${num(errorCount)} بحالة خطأ` : "سليمة" },
    { label: "قناة الإشعارات الخارجية", ok: undelivered < 50, value: undelivered ? `${num(undelivered)} بانتظار الإرسال` : "لا يوجد متأخر" },
    { label: "الاستيراد (7 أيام)", ok: failedImports === 0, value: failedImports ? `${num(failedImports)} عملية فاشلة` : "لا أخطاء" },
    { label: "واجهة الفحص /api/health", ok: true, value: "متاحة" },
  ];
  const healthy = checks.filter((c) => c.ok).length;
  const overallTone = healthy === checks.length ? "success" : healthy >= checks.length - 1 ? "warning" : "danger";

  return (
    <>
      <PageHeader
        title="حالة الخدمات"
        subtitle="فحص مباشر لقاعدة البيانات والمهام المجدولة والتكاملات وقنوات الإشعارات"
        actions={
          <ActionButton action={runScheduledJobsNow} className="btn btn-primary btn-sm" confirm="سيتم تشغيل محرك الحالات والأتمتة لكل المكاتب النشطة الآن. متابعة؟">
            تشغيل المهام المجدولة الآن
          </ActionButton>
        }
      />

      {sp.ran === "1" && (
        <div className="mb-4">
          <Alert tone="success" title="تم تشغيل المهام المجدولة">
            شملت <span className="num">{num(Number(sp.orgs ?? 0))}</span> مكتب ونفّذت <span className="num">{num(Number(sp.updates ?? 0))}</span> تحديث حالة.
          </Alert>
        </div>
      )}

      <StatGrid cols={4}>
        <StatCard label="الحالة العامة" value={healthy === checks.length ? "سليمة" : healthy >= checks.length - 1 ? "تحتاج انتباه" : "متدهورة"} sub={`${num(healthy)} من ${num(checks.length)} فحوصات ناجحة`} tone={overallTone === "success" ? undefined : overallTone} dark />
        <StatCard label="زمن استجابة قاعدة البيانات" value={ping.ok ? `${num(ping.latencyMs)} ms` : "خطأ"} tone={ping.ok ? undefined : "danger"} />
        <StatCard label="جلسات نشطة" value={num(sessions)} sub={`${num(orgs)} مكتب ضمن الجدولة`} />
        <StatCard label="إشعارات آخر 24 ساعة" value={num(notifications24h)} sub={`${num(audit24h)} عملية مسجلة`} />
      </StatGrid>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title="الفحوصات" subtitle={`آخر نشاط مسجل: ${lastAudit ? relative(lastAudit.createdAt) : "—"}`}>
          <ul className="space-y-2 text-[13px]">
            {checks.map((c) => (
              <li key={c.label} className="flex items-center justify-between rounded-xl bg-mist px-3 py-2">
                <span className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${c.ok ? "bg-success" : "bg-danger"}`} />
                  {c.label}
                </span>
                <span className={`num max-w-[50%] truncate text-end font-bold ${c.ok ? "text-success" : "text-danger"}`} title={c.value}>{c.value}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11.5px] text-muted">
            جدولة خارجية: استدعِ <span className="latin">GET /api/cron/run</span> كل ساعة من أي مجدول. الفحص الآلي: <span className="latin">GET /api/health</span>.
          </p>
        </Card>

        <Card title="التكاملات عبر المنصة" subtitle="توزيع الحالات">
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(INTEGRATION_STATUS).map(([k, m]) => (
              <div key={k} className="rounded-xl bg-mist px-3 py-2">
                <div className="text-[11.5px] text-muted">{m.label}</div>
                <div className={`num text-lg font-bold ${k === "ERROR" && iCount(k) ? "text-danger" : ""}`}>{num(iCount(k))}</div>
              </div>
            ))}
          </div>
          {errorIntegrations.length === 0 ? (
            <div className="mt-3"><EmptyState title="لا توجد تكاملات متعثرة" /></div>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {errorIntegrations.map((i) => (
                <li key={i.id} className="py-2 text-[12.5px]">
                  <div className="flex items-center justify-between gap-2">
                    <Link href={`/admin/organizations/${i.organization.id}?tab=integrations`} className="link">{i.organization.name}</Link>
                    <span className="flex items-center gap-1">
                      <Tag tone="neutral" plain>{INTEGRATION_PROVIDERS[i.provider]?.label ?? i.provider}</Tag>
                      <StatusTag value={i.status} map={INTEGRATION_STATUS} />
                    </span>
                  </div>
                  <div className="truncate text-[11.5px] text-muted" title={i.lastError ?? ""}>{i.lastError ?? "—"} · آخر مزامنة {i.lastSyncAt ? relative(i.lastSyncAt) : "—"}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="سجل تشغيل المهام" subtitle="آخر 10 تشغيلات يدوية" padded={false}>
          {runs.length === 0 ? (
            <EmptyState title="لم تُشغّل المهام يدويًا بعد" description="استخدم الزر أعلى الصفحة أو اربط المجدول الخارجي." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>الوقت</th>
                  <th>بواسطة</th>
                  <th>المكاتب</th>
                  <th>التحديثات</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const v = safeJson<{ orgs?: number; updates?: number }>(r.newValue, {});
                  return (
                    <tr key={r.id}>
                      <td className="num whitespace-nowrap">{datetime(r.createdAt)}</td>
                      <td>{r.userName ?? "النظام"}</td>
                      <td className="num">{num(v.orgs ?? 0)}</td>
                      <td className="num">{num(v.updates ?? 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <div className="mt-4">
        <Card title="أخطاء التكاملات الأخيرة" subtitle="آخر 15 سجل بمستوى ERROR" padded={false}>
          {integrationErrors.length === 0 ? (
            <EmptyState title="لا توجد أخطاء مسجلة" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>الوقت</th>
                  <th>المكتب</th>
                  <th>المزود</th>
                  <th>الرسالة</th>
                </tr>
              </thead>
              <tbody>
                {integrationErrors.map((l) => (
                  <tr key={l.id}>
                    <td className="num whitespace-nowrap">{datetime(l.createdAt)}</td>
                    <td><Link href={`/admin/organizations/${l.integration.organization.id}?tab=integrations`} className="link">{l.integration.organization.name}</Link></td>
                    <td>{INTEGRATION_PROVIDERS[l.integration.provider]?.label ?? l.integration.provider}</td>
                    <td className="max-w-lg truncate text-[12.5px]" title={l.message}>{l.message}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
