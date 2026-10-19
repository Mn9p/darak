// RFC 8414: OAuth endpoints for MCP clients (Claude, ChatGPT, Gemini). DARAK is its own authorization server.
import { CORS, authServerMetadata, json, publicOrigin } from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return json(authServerMetadata(publicOrigin(req)));
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
