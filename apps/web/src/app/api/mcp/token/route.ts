// OAuth token endpoint (authorization_code + PKCE, refresh_token) and RFC 7009 revocation (`token` without grant_type).
import { CORS, exchangeCode, json, readClient, refresh, revokeToken } from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";

async function params(req: Request): Promise<URLSearchParams> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return new URLSearchParams(Object.entries(body).map(([k, v]) => [k, String(v)]));
  }
  return new URLSearchParams(await req.text());
}

const invalid = (error: string, description: string) => json({ error, error_description: description }, 400);

export async function POST(req: Request) {
  const p = await params(req);
  const grant = p.get("grant_type");

  if (!grant && p.get("token")) {
    await revokeToken(p.get("token")!);
    return new Response(null, { status: 200, headers: CORS });
  }

  if (grant === "authorization_code") {
    const clientId = p.get("client_id") ?? "";
    const client = await readClient(clientId);
    const redirectUri = p.get("redirect_uri") ?? "";
    if (!client || !client.redirectUris.includes(redirectUri)) return invalid("invalid_client", "Unknown client or redirect_uri");
    const tokens = await exchangeCode(p.get("code") ?? "", clientId, redirectUri, p.get("code_verifier") ?? "");
    return tokens ? json(tokens) : invalid("invalid_grant", "Code expired, already used, or PKCE check failed");
  }

  if (grant === "refresh_token") {
    const tokens = await refresh(p.get("refresh_token") ?? "");
    return tokens ? json(tokens) : invalid("invalid_grant", "Refresh token expired or revoked — reconnect the assistant");
  }

  return invalid("unsupported_grant_type", "Use authorization_code or refresh_token");
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
