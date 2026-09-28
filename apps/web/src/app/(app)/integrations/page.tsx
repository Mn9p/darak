import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { INTEGRATION_PROVIDERS, INTEGRATION_STATUS, type StatusMeta } from "@/lib/constants";
import { relative, datetime, safeJson, pageParam } from "@/lib/format";
import { PageHeader, Card, Table, StatusTag, EmptyState, Tabs, Alert, ActionButton, Tag, FilterBar, Select, Pagination, StatGrid, StatCard } from "@/components/ui";
import { GuideCard } from "@/components/GuideCard";
import { disconnectIntegration, retryIntegration, syncIntegration } from "./actions";
import { PROVIDER_CONFIG_FIELDS } from "./providers";
import { ConnectForm } from "./ConnectForm";

export const dynamic = "force-dynamic";
const PAGE = 25;

const LOG_LEVEL: Record<string, StatusMeta> = {
  INFO: { label: "معلومة", tone: "info" },
  WARN: { label: "تحذير", tone: "warning" },
  ERROR: { label: "خطأ", tone: "danger" },
};

/** Short, plain descriptions shown on the cards (overrides the longer constants copy). */
const DESC: Record<string, string> = {
};

const TABS = [
  { key: "overview", label: "التكاملات" },
  { key: "logs", label: "السجلات" },
];

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireStaff();
  if (!can(user, "integrations.manage")) redirect("/forbidden");
  const sp = await searchParams;
  const org = user.organizationId;
  const tab = sp.tab ?? "overview";

  const rows = await db.integration.findMany({ where: { organizationId: org }, include: { _count: { select: { logs: true } } } });
  const byProvider = new Map(rows.map((r) => [r.provider, r]));
  const providers = Object.keys(INTEGRATION_PROVIDERS);
  const connected = rows.filter((r) => r.status === "CONNECTED").length;
  const errors = rows.filter((r) => r.status === "ERROR").length;

  let logs: { id: string; level: string; message: string; payload: string | null; createdAt: Date; integration: { name: string; provider: string } }[] = [];
  let logsTotal = 0;
  const page = pageParam(sp.page);
  if (tab === "logs") {
    const where = { integration: { organizationId: org, ...(sp.provider ? { provider: sp.provider } : {}) }, ...(sp.level ? { level: sp.level } : {}) };
    [logsTotal, logs] = await Promise.all([
      db.integrationLog.count({ where }),
      db.integrationLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE, include: { integration: { select: { name: true, provider: true } } } }),
    ]);
  }

  return (
    <>
      <PageHeader title="التكاملات" subtitle="قنوات التواصل والربط البنكي." />

      <GuideCard
        id="integrations"
        show={rows.length === 0}
        title="التكاملات: قنوات الرسائل والربط البنكي"
        steps={[
          "فعّل قناة الرسائل (SMS أو واتساب) لتصل التذكيرات للمستأجرين.",
          "اربط الحساب البنكي لتُستورد الحركات تلقائيًا للمطابقة.",
          "كل اتصال يُسجل في تبويب السجلات لتعرف ما أُرسل وما تعثر.",
        ]}
        note="ابدأ من البطاقات أدناه؛ لكل مزود زر ربط خاص به."
        secondary={{ href: "/help", label: "مركز المساعدة" }}
      />

      <StatGrid cols={3}>
        <StatCard label="متصل" value={<span className="num">{connected}</span>} tone="success" />
        <StatCard label="بحاجة لتدخل" value={<span className="num">{errors}</span>} tone={errors ? "danger" : undefined} />
        <StatCard label="السجلات" value={<span className="num">{rows.reduce((s, r) => s + r._count.logs, 0)}</span>} href="/integrations?tab=logs" />
      </StatGrid>

      <div className="mt-4">
        <Tabs tabs={TABS} active={tab} base="/integrations" />
      </div>

      {tab === "overview" && (
        <div className="grid gap-4 lg:grid-cols-2">
          {providers.map((provider) => {
            const meta = INTEGRATION_PROVIDERS[provider];
            const row = byProvider.get(provider);
            const status = row?.status ?? "DISCONNECTED";
            const config = safeJson<Record<string, string>>(row?.config, {});
            const fields = PROVIDER_CONFIG_FIELDS[provider] ?? [];
            const summary = fields.filter((f) => config[f.key]).map((f) => `${f.label}: ${f.options ? f.options[config[f.key]] ?? config[f.key] : config[f.key]}`);
            const isConnected = status === "CONNECTED" || status === "SYNCING";
            return (
              <Card key={provider} title={meta.label} subtitle={DESC[provider] ?? meta.description} actions={<StatusTag value={status} map={INTEGRATION_STATUS} />}>
                <div className="space-y-3">
                  {row?.lastError && status === "ERROR" && (
                    <Alert tone="danger" title="آخر خطأ">
                      {row.lastError}
                    </Alert>
                  )}
                  <div className="grid grid-cols-2 gap-2 text-[12.5px]">
                    <div>
                      <div className="text-muted">آخر مزامنة</div>
                      <div className="font-semibold text-text">{row?.lastSyncAt ? `${relative(row.lastSyncAt)} · ${datetime(row.lastSyncAt)}` : "—"}</div>
                    </div>
                    <div>
                      <div className="text-muted">الإعدادات</div>
                      {(
                        <div className="truncate font-semibold text-text" title={summary.join(" · ")}>
                          {summary.length ? summary.join(" · ") : <span className="text-faint">لم تُضبط بعد</span>}
                        </div>
                      )}
                    </div>
                  </div>

                  {row && (
                    <div className="flex flex-wrap items-center gap-2">
                      {isConnected && (
                        <ActionButton action={syncIntegration} hidden={{ id: row.id }} className="btn btn-primary btn-sm">
                          مزامنة الآن
                        </ActionButton>
                      )}
                      {status === "ERROR" && (
                        <>
                          <ActionButton action={retryIntegration} hidden={{ id: row.id }} className="btn btn-primary btn-sm">
                            إعادة المحاولة
                          </ActionButton>
                          <ActionButton action={syncIntegration} hidden={{ id: row.id }} className="btn btn-outline btn-sm">
                            مزامنة الآن
                          </ActionButton>
                        </>
                      )}
                      <Link className="btn btn-link btn-sm" href={`/integrations?tab=logs&provider=${provider}`}>
                        السجلات ({row._count.logs})
                      </Link>
                      {status !== "DISCONNECTED" && (
                        <ActionButton action={disconnectIntegration} hidden={{ id: row.id }} className="btn btn-link btn-sm text-danger" confirm="سيتم فصل التكامل. هل أنت متأكد؟">
                          فصل
                        </ActionButton>
                      )}
                    </div>
                  )}

                  <details className="rounded-xl border border-line px-4 py-3" open={!isConnected && status !== "ERROR"}>
                    <summary className="cursor-pointer text-[13px] font-bold text-brand">{isConnected ? "تعديل الإعدادات" : "الإعدادات"}</summary>
                    <div className="mt-3">
                      <ConnectForm provider={provider} fields={fields} config={config} connected={isConnected} />
                    </div>
                  </details>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {tab === "logs" && (
        <Card title="سجلات التكاملات" padded={false}>
          <div className="px-5 pt-3">
            <FilterBar base="/integrations?tab=logs" hasFilters={Boolean(sp.provider || sp.level)}>
              <input type="hidden" name="tab" value="logs" />
              <Select name="provider" defaultValue={sp.provider ?? ""} placeholder="كل المزودين" options={Object.fromEntries(providers.map((p) => [p, INTEGRATION_PROVIDERS[p].label]))} />
              <Select name="level" defaultValue={sp.level ?? ""} placeholder="كل المستويات" options={LOG_LEVEL} />
            </FilterBar>
          </div>
          {logs.length === 0 ? (
            <EmptyState
              title="لا توجد سجلات"
              description="تظهر هنا نتائج المزامنة والأخطاء."
              action={
                <Link className="btn btn-primary btn-sm" href="/integrations">
                  العودة للتكاملات
                </Link>
              }
            />
          ) : (
            <>
              <Table>
                <thead>
                  <tr>
                    <th>الوقت</th>
                    <th>المزود</th>
                    <th>المستوى</th>
                    <th>الرسالة</th>
                    <th>التفاصيل</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((l) => (
                    <tr key={l.id}>
                      <td className="num whitespace-nowrap text-muted">{datetime(l.createdAt)}</td>
                      <td>{l.integration.name}</td>
                      <td>
                        <StatusTag value={l.level} map={LOG_LEVEL} />
                      </td>
                      <td>{l.message}</td>
                      <td className="latin max-w-[260px] truncate text-[12px] text-muted" title={l.payload ?? ""}>
                        {l.payload ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <Pagination page={page} pageSize={PAGE} total={logsTotal} base="/integrations" params={{ ...sp, tab: "logs" }} />
            </>
          )}
        </Card>
      )}
    </>
  );
}
