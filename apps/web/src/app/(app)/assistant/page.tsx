import { headers } from "next/headers";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { isAccountOwner } from "@/lib/permissions";
import { datetime, relative } from "@/lib/format";
import { toolsFor } from "@/lib/mcp/tools";
import { PageHeader, Card, Table, Tag, ActionButton, EmptyState, Alert } from "@/components/ui";
import { CopyField } from "./CopyField";
import { revokeAiConnection } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "المساعد الذكي" };

const EXAMPLES = ["وش العقود اللي تنتهي خلال الشهرين الجايين؟", "مين أكثر المستأجرين تأخيرًا في السداد؟", "كم حصّلنا هالشهر مقارنة بالمستحق؟", "وش مصروفات الصيانة في عمارة النخيل هالسنة؟"];

/** Connect Claude, ChatGPT or Gemini to DARAK over MCP: the link, per-assistant steps and the live connections. */
export default async function AssistantPage() {
  const user = await requireStaff();
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto")?.split(",")[0] ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const url = `${origin}/api/mcp`;
  const owner = isAccountOwner(user);
  const tools = toolsFor({ ...user, connectionId: "", clientName: "" });

  const connections = await db.aiConnection.findMany({
    where: { organizationId: user.organizationId, revokedAt: null, ...(owner ? {} : { userId: user.id }) },
    include: { user: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });

  const providers = [
    {
      name: "Claude",
      steps: ["من claude.ai أو تطبيق Claude: الإعدادات ← Connectors ← Add custom connector.", "حط اسم «دارك» والصق الرابط، واضغط Add.", "اضغط Connect، وادخل دارك برقم جوالك، ووافق على القراءة."],
      extra: { label: "Claude Code", value: `claude mcp add --transport http darak ${url}` },
    },
    {
      name: "ChatGPT",
      steps: ["من ChatGPT: الإعدادات ← Apps & Connectors ← Advanced، وفعّل Developer mode.", "اضغط Create، حط اسم «دارك» والرابط، واختر OAuth للمصادقة.", "ادخل دارك برقم جوالك ووافق، وبعدها فعّل «دارك» من أدوات المحادثة."],
    },
    {
      name: "Gemini",
      steps: ["في Gemini CLI: أضف دارك لملف ~/.gemini/settings.json (الأمر تحت).", "شغّل gemini واكتب ‎/mcp auth darak‎.", "ادخل دارك برقم جوالك في المتصفح ووافق."],
      extra: { label: "settings.json", value: JSON.stringify({ mcpServers: { darak: { httpUrl: url } } }) },
    },
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="المساعد الذكي" subtitle="اربط Claude أو ChatGPT أو Gemini بدارك، واسأل عن بيانات مكتبك بالعربي." />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card title="رابط الربط (MCP)" subtitle="رابط واحد لكل المساعدات. كل واحد يربط بحسابه هو.">
          <CopyField value={url} label="نسخ الرابط" />
          <ul className="mt-4 space-y-1.5 text-[13px] text-text-2">
            <li>• المساعد يقرأ بس، وما يقدر يعدّل أو يحذف أي شي.</li>
            <li>• يشوف اللي تشوفه أنت في دارك بس، بنفس صلاحياتك وعقاراتك.</li>
            <li>• توقف الربط متى ما بغيت من الجدول تحت، ويوقف فورًا.</li>
          </ul>
        </Card>

        <Card title="جرّب تسأله" tone="warm">
          <ul className="space-y-2 text-[13.5px] text-text">
            {EXAMPLES.map((q) => (
              <li key={q} className="rounded-xl bg-white/70 px-3 py-2">
                {q}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {providers.map((p) => (
          <Card key={p.name} title={<span className="latin">{p.name}</span>}>
            <ol className="space-y-2 text-[13px] leading-6 text-text-2">
              {p.steps.map((s, i) => (
                <li key={s} className="flex gap-2">
                  <span className="num grid h-5 w-5 shrink-0 place-items-center rounded-full bg-mist text-[11px] font-bold text-brand">{i + 1}</span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
            {p.extra && (
              <div className="mt-3">
                <div className="mb-1 text-[12px] font-bold text-muted latin">{p.extra.label}</div>
                <CopyField value={p.extra.value} />
              </div>
            )}
          </Card>
        ))}
      </div>

      <div className="mt-4">
        <Card title="اللي يقدر يقرأه مساعدك" subtitle="حسب صلاحياتك في المكتب.">
          {tools.length ? (
            <div className="flex flex-wrap gap-2">
              {tools.map((t) => (
                <Tag key={t.name} tone="brand" plain>
                  {t.title}
                </Tag>
              ))}
            </div>
          ) : (
            <Alert tone="warning">ما عندك صلاحيات قراءة كافية. اطلب من صاحب الحساب يعطيك صلاحيات.</Alert>
          )}
        </Card>
      </div>

      <div className="mt-4">
        <Card title={owner ? "المساعدات المربوطة بالمكتب" : "مساعداتي المربوطة"} padded={false}>
          {connections.length === 0 ? (
            <EmptyState title="ما فيه مساعد مربوط" description="انسخ الرابط فوق وأضفه في مساعدك الذكي." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>المساعد</th>
                  {owner && <th>العضو</th>}
                  <th>رُبط</th>
                  <th>آخر استخدام</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {connections.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <span className="font-semibold">{c.clientName}</span>
                      {c.redirectHost && <span className="latin mr-2 text-[12px] text-muted">{c.redirectHost}</span>}
                    </td>
                    {owner && <td>{c.user.name}</td>}
                    <td className="num text-muted">{datetime(c.createdAt)}</td>
                    <td className="text-muted">{c.lastUsedAt ? relative(c.lastUsedAt) : "—"}</td>
                    <td>
                      <ActionButton action={revokeAiConnection} hidden={{ id: c.id }} className="btn btn-danger-soft btn-xs" confirm="توقف هذا الربط؟ المساعد ما راح يقدر يقرأ بيانات المكتب بعدها.">
                        إيقاف
                      </ActionButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
