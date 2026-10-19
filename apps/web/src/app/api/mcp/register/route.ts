// RFC 7591 dynamic client registration. Public clients only (PKCE, no secret); the client id is a signed record of the
// client's name and redirect URIs, so nothing is stored until a member actually approves a connection.
import { CORS, json, registerClient, validRedirectUri } from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "invalid_client_metadata", error_description: "JSON body required" }, 400);
  }
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : [];
  if (!uris.length || uris.length > 5 || !uris.every(validRedirectUri)) {
    return json({ error: "invalid_redirect_uri", error_description: "redirect_uris must be https (or http on localhost)" }, 400);
  }
  const name = typeof body.client_name === "string" && body.client_name.trim() ? body.client_name.trim() : new URL(uris[0]).hostname;
  const clientId = await registerClient(name, uris);
  return json(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: name.slice(0, 80),
      redirect_uris: uris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    201,
  );
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
