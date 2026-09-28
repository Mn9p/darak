import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { datetime } from "@/lib/format";
import { NOTIFICATION_CHANNELS } from "@/lib/constants";
import { PageHeader, Card, Tag, Field, Input, Select, FormGrid, ActionButton, Alert } from "@/components/ui";
import { GuideCard } from "@/components/GuideCard";
import { REPORTS, REPORT_GROUPS, PERIODS, reportBySlug, reportAllowed } from "./queries";
import { saveSchedule, deleteSchedule } from "./actions";

export const dynamic = "force-dynamic";

const FREQ: Record<string, string> = { daily: "يومي", weekly: "أسبوعي", monthly: "شهري" };

const DEMO_SCHEDULES = [
  { name: "ملخص التحصيل الأسبوعي", desc: "التحصيل والمتأخرات لمدير المكتب والمحاسب.", frequency: "weekly", channel: "EMAIL" },
  { name: "كشوف الملاك الشهرية", desc: "كشف حساب الشهر السابق لكل مالك.", frequency: "monthly", channel: "EMAIL" },
];

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireStaff();
  const sp = await searchParams;
  const org = user.organizationId;
  const financial = can(user, "reports.financial");
  const schedules = await db.savedView.findMany({ where: { organizationId: org, module: "reports", OR: [{ userId: user.id }, { isShared: true }] }, orderBy: { createdAt: "desc" }, include: { user: { select: { name: true } } } });
  const allowed = REPORTS.filter((r) => reportAllowed(user, r));
  const contractsCount = await db.contract.count({ where: { organizationId: org, status: { notIn: ["DRAFT", "CANCELLED"] } } });

  return (
    <>
      <PageHeader
        title="التقارير"
        subtitle="اختر تقريرًا لعرضه أو تصديره أو طباعته."
        actions={
          <Link href="/dashboard" className="btn btn-outline btn-sm">
            لوحة المؤشرات
          </Link>
        }
      />

      <GuideCard
        id="reports"
        show={contractsCount === 0}
        title="التقارير تُبنى من بياناتك: الإشغال والتحصيل وأعمار الديون وكشوف الملاك"
        steps={[
          "لا تحتاج إعدادًا؛ كل تقرير يقرأ من العقود والدفعات والمصروفات مباشرة.",
          "أنشئ عقدًا واحدًا نشطًا وستظهر الأرقام هنا.",
          "يمكنك حفظ تقرير بفلاتره وجدولته ليصلك دوريًا.",
        ]}
        cta={{ href: "/contracts/new", label: "إنشاء عقد" }}
        secondary={{ href: "/dashboard", label: "لوحة المؤشرات" }}
      />

      {!financial && (
        <div className="mb-4">
          <Alert tone="neutral">التقارير المالية متاحة لمدير المكتب والمحاسب والمدقق فقط.</Alert>
        </div>
      )}
      {sp.saved && (
        <div className="mb-4">
          <Alert tone="success">تم حفظ جدولة التقرير.</Alert>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {REPORT_GROUPS.map((g) => {
            const items = allowed.filter((r) => r.group === g.key);
            if (!items.length) return null;
            return (
              <Card key={g.key} title={g.label}>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((r) => (
                    <Link key={r.slug} href={`/reports/${r.slug}`} className="group rounded-xl border border-line px-4 py-3 transition hover:border-brand hover:bg-mist">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[13.5px] font-bold text-text group-hover:text-brand">{r.title}</span>
                        {r.financial && (
                          <Tag tone="brand" plain className="!text-[10px]">
                            مالي
                          </Tag>
                        )}
                      </div>
                      <p className="mt-1 line-clamp-2 text-[12px] text-muted">{r.description}</p>
                    </Link>
                  ))}
                </div>
              </Card>
            );
          })}
        </div>

        <div className="space-y-4">
          <Card title="التقارير المجدولة">
            <ul className="space-y-2">
              {DEMO_SCHEDULES.map((s) => (
                <li key={s.name} className="rounded-xl bg-mist px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <b className="text-[13px]">{s.name}</b>
                    <Tag tone="success" plain>
                      نشط
                    </Tag>
                  </div>
                  <p className="mt-0.5 text-[12px] text-muted">{s.desc}</p>
                  <div className="mt-1 text-[11.5px] text-faint">
                    {FREQ[s.frequency]} · {NOTIFICATION_CHANNELS[s.channel]}
                  </div>
                </li>
              ))}
              {schedules.map((s) => {
                const q = new URLSearchParams(s.query);
                const meta = reportBySlug(q.get("slug") ?? "");
                return (
                  <li key={s.id} className="rounded-xl border border-line px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <b className="text-[13px]">{s.name}</b>
                      <Tag tone="info" plain>
                        مجدول
                      </Tag>
                    </div>
                    <p className="mt-0.5 text-[12px] text-muted">
                      {meta?.title ?? q.get("slug")} · {FREQ[q.get("frequency") ?? ""] ?? q.get("frequency")} · {PERIODS[q.get("period") ?? ""] ?? q.get("period")} · {NOTIFICATION_CHANNELS[q.get("channel") ?? ""] ?? q.get("channel")}
                      {q.get("recipients") && <span className="latin"> → {q.get("recipients")}</span>}
                    </p>
                    <div className="mt-1 flex items-center justify-between text-[11.5px] text-faint">
                      <span>
                        {s.user.name} · {datetime(s.createdAt)}
                        {s.isShared ? " · مشترك" : ""}
                      </span>
                      {(s.userId === user.id || can(user, "settings.manage")) && (
                        <ActionButton action={deleteSchedule} hidden={{ id: s.id }} className="btn btn-link btn-xs text-danger">
                          إزالة
                        </ActionButton>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card title="جدولة تقرير">
            <form action={saveSchedule} className="space-y-3">
              <FormGrid cols={1}>
                <Field label="التقرير" name="slug" required>
                  <Select name="slug" options={allowed.map((r) => ({ value: r.slug, label: `${REPORT_GROUPS.find((g) => g.key === r.group)?.label} — ${r.title}` }))} defaultValue={allowed[0]?.slug} />
                </Field>
              </FormGrid>
              <FormGrid cols={2}>
                <Field label="التكرار" name="frequency">
                  <Select name="frequency" options={FREQ} defaultValue="weekly" />
                </Field>
                <Field label="القناة" name="channel">
                  <Select name="channel" options={{ EMAIL: NOTIFICATION_CHANNELS.EMAIL, WHATSAPP: NOTIFICATION_CHANNELS.WHATSAPP, IN_APP: NOTIFICATION_CHANNELS.IN_APP }} defaultValue="EMAIL" />
                </Field>
              </FormGrid>
              <Field label="المستلمون" name="recipients" help="بريد أو جوال، مفصولة بفاصلة">
                <Input name="recipients" className="ltr" placeholder="manager@darak.sa" />
              </Field>
              <details className="rounded-xl border border-line">
                <summary className="cursor-pointer px-3 py-2 text-[13px] font-bold text-brand">خيارات إضافية</summary>
                <div className="space-y-3 border-t border-line px-3 pb-3 pt-3">
                  <Field label="اسم الجدولة" name="name" help="يُولّد تلقائيًا من اسم التقرير إن تُرك فارغًا">
                    <Input name="name" />
                  </Field>
                  <Field label="الفترة المشمولة" name="period">
                    <Select name="period" options={Object.fromEntries(Object.entries(PERIODS).filter(([k]) => k !== "custom"))} defaultValue="monthly" />
                  </Field>
                  <label className="flex items-center gap-2 text-[13px]">
                    <input type="checkbox" name="shared" /> مشاركة الجدولة مع فريق المكتب
                  </label>
                </div>
              </details>
              <button className="btn btn-primary btn-sm w-full" type="submit">
                حفظ الجدولة
              </button>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}
