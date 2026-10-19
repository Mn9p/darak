// Validation of an OAuth authorize request, shared by the consent page and its server action (re-checked on submit).
import { readClient, type Client } from "@/lib/mcp/oauth";

export interface AuthorizeRequest {
  clientId: string;
  client: Client;
  redirectUri: string;
  codeChallenge: string;
  state: string | null;
}

/**
 * `fatal`: the client or redirect URI cannot be trusted, so the error is shown here and never sent anywhere.
 * `redirectError`: the redirect URI is fine but the request is not (RFC 6749 §4.1.2.1) — reported back to the client.
 */
export async function parseAuthorize(
  sp: Record<string, string | undefined>,
): Promise<{ ok: AuthorizeRequest } | { fatal: string } | { redirectError: string; redirectUri: string; state: string | null }> {
  const clientId = sp.client_id ?? "";
  const client = clientId ? await readClient(clientId) : null;
  if (!client) return { fatal: "رابط الربط غير صالح أو انتهت صلاحيته. ابدأ الربط من جديد من مساعدك الذكي." };
  const redirectUri = sp.redirect_uri ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : "");
  if (!client.redirectUris.includes(redirectUri)) return { fatal: "عنوان الرجوع لا يطابق المساعد المسجّل. ابدأ الربط من جديد." };
  const state = sp.state ?? null;
  if (sp.response_type !== "code") return { redirectError: "unsupported_response_type", redirectUri, state };
  if (!sp.code_challenge || (sp.code_challenge_method ?? "plain") !== "S256") return { redirectError: "invalid_request", redirectUri, state };
  return { ok: { clientId, client, redirectUri, codeChallenge: sp.code_challenge, state } };
}

export function withParams(uri: string, params: Record<string, string | null>) {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v !== null) u.searchParams.set(k, v);
  return u.toString();
}
