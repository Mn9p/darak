// RFC 9728: tells an MCP client which authorization server protects /api/mcp. Served at the root and at /api/mcp suffix.
import { CORS, json, publicOrigin, resourceMetadata } from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return json(resourceMetadata(publicOrigin(req)));
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
