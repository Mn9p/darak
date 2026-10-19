// MCP server (Streamable HTTP, stateless, JSON responses): lets Claude, ChatGPT or Gemini read the office's data on
// behalf of a signed-in staff member. OAuth bearer tokens only (lib/mcp/oauth); tools are read-only (lib/mcp/tools).
import { logger } from "@/lib/logger";
import { CORS, json, publicOrigin, userFromAccessToken, type McpUser } from "@/lib/mcp/oauth";
import { toolsFor } from "@/lib/mcp/tools";

export const dynamic = "force-dynamic";

const PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS = `DARAK (دارك) is a Saudi property-management system. These tools read one real-estate office's live data — properties, units, lease contracts, rent installments and collections, receipt vouchers, expenses, owner statements and tasks — limited to what the signed-in member may see. Amounts are SAR; dates are yyyy-mm-dd in Riyadh time. Answer in the user's language (usually Arabic). Start with office_overview for broad questions. The tools cannot change anything: for edits, direct the user to DARAK itself.`;

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

const ok = (id: Rpc["id"], result: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result });
const fail = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

function unauthorized(req: Request) {
  const meta = `${publicOrigin(req)}/.well-known/oauth-protected-resource/api/mcp`;
  return json({ error: "invalid_token", error_description: "Sign in to DARAK to connect this assistant." }, 401, { "WWW-Authenticate": `Bearer resource_metadata="${meta}", scope="darak.read"` });
}

async function handle(msg: Rpc, user: McpUser) {
  switch (msg.method) {
    case "initialize": {
      const asked = String(msg.params?.protocolVersion ?? "");
      return ok(msg.id, {
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "darak", title: "دارك", version: "1.0.0" },
        instructions: `${INSTRUCTIONS}\nOffice: ${user.organizationName}. Member: ${user.name}.`,
      });
    }
    case "ping":
      return ok(msg.id, {});
    case "tools/list":
      return ok(msg.id, {
        tools: toolsFor(user).map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: { title: t.title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } })),
      });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const tool = toolsFor(user).find((t) => t.name === name);
      if (!tool) return fail(msg.id, -32602, `Unknown tool: ${name}`);
      const args = (msg.params?.arguments && typeof msg.params.arguments === "object" ? msg.params.arguments : {}) as Record<string, unknown>;
      try {
        const data = await tool.run(user, args);
        const isError = Boolean(data && typeof data === "object" && "error" in data);
        logger.info("mcp.tool", { tool: name, org: user.organizationId, user: user.id, connection: user.connectionId, isError });
        return ok(msg.id, { content: [{ type: "text", text: JSON.stringify(data) }], ...(isError ? { isError: true } : {}) });
      } catch (e) {
        logger.warn("mcp.tool_failed", { tool: name, org: user.organizationId, error: String(e) });
        return ok(msg.id, { content: [{ type: "text", text: "تعذر قراءة البيانات الآن. حاول مرة أخرى بعد قليل." }], isError: true });
      }
    }
    case "resources/list":
      return ok(msg.id, { resources: [] });
    case "prompts/list":
      return ok(msg.id, { prompts: [] });
    default:
      return fail(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const token = /^Bearer\s+(.+)$/i.exec(auth)?.[1]?.trim();
  const user = token ? await userFromAccessToken(token) : null;
  if (!user) return unauthorized(req);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(fail(null, -32700, "Parse error"), 400);
  }
  const batch = Array.isArray(body);
  const messages = (batch ? body : [body]) as Rpc[];
  if (!messages.length || messages.length > 20) return json(fail(null, -32600, "Invalid Request"), 400);

  const replies = [];
  for (const m of messages) {
    if (!m || typeof m !== "object" || m.jsonrpc !== "2.0" || typeof m.method !== "string") {
      // A response or malformed message from the client: nothing to answer.
      if (m && typeof m === "object" && "id" in m && !("result" in m) && !("error" in m)) replies.push(fail(m.id, -32600, "Invalid Request"));
      continue;
    }
    // Notifications (no id) are acknowledged without a body.
    if (m.id === undefined || m.id === null) continue;
    replies.push(await handle(m, user));
  }
  if (!replies.length) return new Response(null, { status: 202, headers: CORS });
  return json(batch ? replies : replies[0]);
}

/** No server-initiated stream: this server only answers requests. */
export async function GET() {
  return new Response(null, { status: 405, headers: { ...CORS, Allow: "POST" } });
}

export async function DELETE() {
  return new Response(null, { status: 405, headers: { ...CORS, Allow: "POST" } });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
