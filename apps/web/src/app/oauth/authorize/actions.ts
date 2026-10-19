"use server";

import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { issueCode } from "@/lib/mcp/oauth";
import { parseAuthorize, withParams } from "./request";

export type ConsentState = { to?: string; error?: string } | null;

/** Approve or deny an assistant. Returns the client's redirect URL; the form navigates there (an external origin). */
export async function decideConnection(_prev: ConsentState, formData: FormData): Promise<ConsentState> {
  const sp = Object.fromEntries([...formData.entries()].filter(([k]) => !k.startsWith("$")).map(([k, v]) => [k, String(v)]));
  const req = await parseAuthorize(sp);
  if ("fatal" in req) return { error: req.fatal };
  if ("redirectError" in req) return { to: withParams(req.redirectUri, { error: req.redirectError, state: req.state }) };
  const { ok } = req;

  if (sp.decision !== "allow") return { to: withParams(ok.redirectUri, { error: "access_denied", state: ok.state }) };

  const user = await getCurrentUser();
  if (!user || !user.organizationId || (user.role !== "ACCOUNT_OWNER" && user.role !== "EMPLOYEE") || user.supportAccess) {
    return { error: "ربط المساعد الذكي متاح لصاحب الحساب وموظفي المكتب فقط." };
  }
  const conn = await db.aiConnection.create({
    data: { organizationId: user.organizationId, userId: user.id, clientName: ok.client.name, redirectHost: new URL(ok.redirectUri).host },
  });
  await audit({ user, action: "CREATE", entityType: "AI_CONNECTION", entityId: conn.id, entityLabel: ok.client.name, newValue: { client: ok.client.name, redirectHost: conn.redirectHost, access: "read-only" } });
  const code = await issueCode({ connectionId: conn.id, clientId: ok.clientId, redirectUri: ok.redirectUri, codeChallenge: ok.codeChallenge });
  return { to: withParams(ok.redirectUri, { code, state: ok.state }) };
}
