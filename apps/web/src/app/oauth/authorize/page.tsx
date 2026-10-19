import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AuthShell } from "@/components/AuthShell";
import { Alert } from "@/components/ui";
import { toolsFor } from "@/lib/mcp/tools";
import { ConsentForm } from "./ConsentForm";
import { parseAuthorize, withParams } from "./request";

export const metadata = { title: "ربط مساعد ذكي" };
export const dynamic = "force-dynamic";

const PASS = ["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state", "scope", "resource"];

/** OAuth consent: a staff member lets an AI assistant read the office data they can already see in DARAK. */
export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const req = await parseAuthorize(sp);
  if ("redirectError" in req) redirect(withParams(req.redirectUri, { error: req.redirectError, state: req.state }));
  if ("fatal" in req) {
    return (
      <AuthShell title="تعذر الربط" width="max-w-[460px]">
        <Alert tone="danger">{req.fatal}</Alert>
      </AuthShell>
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    const query = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === "string"));
    redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${query.toString()}`)}`);
  }
  const staff = Boolean(user.organizationId) && (user.role === "ACCOUNT_OWNER" || user.role === "EMPLOYEE") && !user.supportAccess;
  const { client, redirectUri } = req.ok;
  const params = Object.fromEntries(PASS.filter((k) => sp[k]).map((k) => [k, sp[k]!]));
  const tools = staff ? toolsFor({ ...user, organizationId: user.organizationId!, connectionId: "", clientName: client.name }) : [];

  return (
    <AuthShell title={`ربط ${client.name} بدارك`} subtitle={`${user.organizationName ?? ""} · ${user.name}`} width="max-w-[480px]">
      {!staff ? (
        <Alert tone="warning">ربط المساعد الذكي متاح لصاحب الحساب وموظفي المكتب فقط.</Alert>
      ) : (
        <div className="space-y-4">
          <p className="text-[14px] leading-7 text-text-2">
            <b className="text-text">{client.name}</b> يبي يقرأ بيانات مكتبك عشان يجاوب على أسئلتك. بيشوف بس اللي تقدر تشوفه أنت في دارك، وما يقدر يعدّل أو يحذف أي شي.
          </p>
          <div className="rounded-xl border border-line bg-white px-4 py-3">
            <div className="mb-2 text-[12.5px] font-bold text-muted">اللي يقدر يقرأه</div>
            <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-[13px] text-text">
              {tools.map((t) => (
                <li key={t.name} className="flex items-center gap-1.5">
                  <span className="text-success" aria-hidden>
                    ✓
                  </span>
                  {t.title}
                </li>
              ))}
            </ul>
          </div>
          <Alert tone="neutral">
            يرجع الرد إلى <span className="latin font-semibold">{new URL(redirectUri).host}</span>. تقدر توقف الربط متى ما بغيت من صفحة{" "}
            <Link href="/assistant" className="link">
              المساعد الذكي
            </Link>
            .
          </Alert>
          <ConsentForm params={params} />
        </div>
      )}
    </AuthShell>
  );
}
