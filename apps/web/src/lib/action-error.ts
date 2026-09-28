// Failures inside server actions.
// Next.js replaces the message of any error thrown by a server action with a generic English text in production, so an
// Arabic `throw new Error("…")` would never reach the user. Every exported action is wrapped (see the action files):
//   - form actions (useActionState)  → `return actionFailure(e)`  → { error: "<Arabic reason>" } shown in the form
//   - button actions (ActionButton)   → `await failFromError(e)`  → back to the page with an error toast
// Next's own control-flow errors (redirect, notFound, forbidden) are re-thrown untouched.
import { headers } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import { logger } from "./logger";

export const GENERIC_ACTION_ERROR = "تعذر إتمام العملية حاليًا. لم يتم حفظ أي تغيير.";

const ARABIC = /[؀-ۿ]/;

/** The Arabic business message carried by an error, or the generic Arabic fallback (technical errors are logged, never shown). */
export function userMessage(e: unknown, fallback = GENERIC_ACTION_ERROR): string {
  unstable_rethrow(e);
  const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  if (msg && ARABIC.test(msg) && !/prisma|invocation|ECONN|timeout/i.test(msg)) return msg;
  logger.error("action.failed", { error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) });
  return fallback;
}

/** Form actions: turn a failure into the form's error state. */
export function actionFailure(e: unknown): { error: string } {
  return { error: userMessage(e) };
}

/** Same-origin path of the page that posted the action (without toast params), or null. */
async function backPath(): Promise<string | null> {
  try {
    const h = await headers();
    const ref = h.get("referer");
    if (!ref) return null;
    const url = new URL(ref);
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (host && url.host !== host) return null;
    url.searchParams.delete("toast");
    url.searchParams.delete("msg");
    const q = url.searchParams.toString();
    return url.pathname + (q ? `?${q}` : "");
  } catch {
    return null;
  }
}

/** Ends the action: back to the posting page with an Arabic error toast. Never returns. */
export async function failBack(message: string, fallback = "/dashboard"): Promise<never> {
  const path = (await backPath()) ?? fallback;
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${sep}toast=error&msg=${encodeURIComponent(message.slice(0, 300))}`);
}

/** Button actions: report a failure as an error toast on the page the user is on. Never returns. */
export async function failFromError(e: unknown): Promise<never> {
  return failBack(userMessage(e));
}
