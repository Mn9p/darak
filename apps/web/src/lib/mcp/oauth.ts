// OAuth 2.1 for the MCP server (/api/mcp), as Claude, ChatGPT and Gemini expect from a remote MCP connector:
// discovery metadata, dynamic client registration, authorization code + PKCE (S256), refresh tokens.
// Everything is a signed JWT (same AUTH_SECRET as sessions, but its own `t` type and audience) so no token table is
// needed: the client id carries its name and redirect URIs, the code carries the PKCE challenge, and access/refresh
// tokens name an AiConnection row — revoking that row ends the connection at the assistant's next request.
import { SignJWT, jwtVerify } from "jose";
import { createHash } from "node:crypto";
import { db } from "../db";
import { authSecret } from "../secrets";
import { normalizePermissions } from "../permissions";
import { trialExpired, type SessionUser } from "../auth";
import type { Role } from "../constants";

const AUDIENCE = "darak-mcp";
const secret = () => new TextEncoder().encode(authSecret());

export const SCOPE = "darak.read";
export const ACCESS_TTL_S = 60 * 60;
const REFRESH_TTL_S = 30 * 86400;
const CODE_TTL_S = 5 * 60;

type Kind = "client" | "code" | "access" | "refresh";

async function sign(kind: Kind, claims: Record<string, unknown>, ttlS?: number) {
  const jwt = new SignJWT({ ...claims, t: kind }).setProtectedHeader({ alg: "HS256" }).setAudience(AUDIENCE).setIssuedAt();
  if (ttlS) jwt.setExpirationTime(Math.floor(Date.now() / 1000) + ttlS);
  return jwt.sign(secret());
}

async function verify<T>(kind: Kind, token: string): Promise<T | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { audience: AUDIENCE });
    return payload.t === kind ? (payload as T) : null;
  } catch {
    return null;
  }
}

/** Public origin of this deployment, as the assistant reached it (Vercel and Caddy set the forwarded headers). */
export function publicOrigin(req: Request) {
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim() ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export function authServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/mcp/token`,
    registration_endpoint: `${origin}/api/mcp/register`,
    revocation_endpoint: `${origin}/api/mcp/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [SCOPE],
  };
}

export function resourceMetadata(origin: string) {
  return { resource: `${origin}/api/mcp`, authorization_servers: [origin], scopes_supported: [SCOPE], bearer_methods_supported: ["header"], resource_name: "دارك" };
}

/* ───────────── Clients (dynamic registration, stateless) ───────────── */

export interface Client {
  name: string;
  redirectUris: string[];
}

/** https anywhere, or http on the loopback (desktop and CLI clients such as Claude Code and Gemini CLI). */
export function validRedirectUri(uri: string) {
  try {
    const u = new URL(uri);
    if (u.hash || uri.length > 500) return false;
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  } catch {
    return false;
  }
}

export async function registerClient(name: string, redirectUris: string[]) {
  return sign("client", { n: name.slice(0, 80), r: redirectUris.slice(0, 5) });
}

export async function readClient(clientId: string): Promise<Client | null> {
  const p = await verify<{ n: string; r: string[] }>("client", clientId);
  return p && Array.isArray(p.r) ? { name: String(p.n || "مساعد ذكي"), redirectUris: p.r.map(String) } : null;
}

/* ───────────── Authorization codes ───────────── */

export async function issueCode(input: { connectionId: string; clientId: string; redirectUri: string; codeChallenge: string }) {
  return sign("code", { cid: input.connectionId, ch: createHash("sha256").update(input.clientId).digest("base64url"), ru: input.redirectUri, cc: input.codeChallenge }, CODE_TTL_S);
}

const s256 = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

/** Code → first token pair. A code works once: it is only accepted while the connection has never been refreshed. */
export async function exchangeCode(code: string, clientId: string, redirectUri: string, verifier: string) {
  const p = await verify<{ cid: string; ch: string; ru: string; cc: string }>("code", code);
  if (!p || p.ru !== redirectUri || p.ch !== createHash("sha256").update(clientId).digest("base64url")) return null;
  if (!verifier || s256(verifier) !== p.cc) return null;
  const claimed = await db.aiConnection.updateMany({ where: { id: p.cid, revokedAt: null, refreshVersion: 0 }, data: { refreshVersion: 1 } });
  if (claimed.count !== 1) return null;
  return tokenPair(p.cid, 1);
}

/* ───────────── Access and refresh tokens ───────────── */

async function tokenPair(connectionId: string, version: number) {
  return {
    access_token: await sign("access", { cid: connectionId }, ACCESS_TTL_S),
    refresh_token: await sign("refresh", { cid: connectionId, v: version }, REFRESH_TTL_S),
    token_type: "Bearer",
    expires_in: ACCESS_TTL_S,
    scope: SCOPE,
  };
}

/** Rotating refresh: each refresh token works once. Replaying an old one revokes the connection (it was copied). */
export async function refresh(token: string) {
  const p = await verify<{ cid: string; v: number }>("refresh", token);
  if (!p) return null;
  const next = Number(p.v) + 1;
  const rotated = await db.aiConnection.updateMany({ where: { id: p.cid, revokedAt: null, refreshVersion: Number(p.v) }, data: { refreshVersion: next } });
  if (rotated.count !== 1) {
    await db.aiConnection.updateMany({ where: { id: p.cid, revokedAt: null, refreshVersion: { gt: Number(p.v) } }, data: { revokedAt: new Date() } });
    return null;
  }
  return tokenPair(p.cid, next);
}

/** RFC 7009: revoking either token ends the whole connection. */
export async function revokeToken(token: string) {
  const p = (await verify<{ cid: string }>("access", token)) ?? (await verify<{ cid: string }>("refresh", token));
  if (p) await db.aiConnection.updateMany({ where: { id: p.cid, revokedAt: null }, data: { revokedAt: new Date() } });
}

export type McpUser = SessionUser & { organizationId: string; connectionId: string; clientName: string };

/**
 * Bearer token → the staff member behind it, with the same checks a session gets (active user, office not suspended,
 * trial not over). Only office staff connect assistants; portal users and platform admins are refused.
 */
export async function userFromAccessToken(token: string): Promise<McpUser | null> {
  const p = await verify<{ cid: string }>("access", token);
  if (!p) return null;
  const conn = await db.aiConnection.findUnique({ where: { id: p.cid } });
  if (!conn || conn.revokedAt) return null;
  const user = await db.user.findUnique({
    where: { id: conn.userId },
    include: { organization: { select: { name: true, status: true, renewalDate: true } }, assignments: { select: { propertyId: true } } },
  });
  if (!user || user.status !== "ACTIVE" || user.organizationId !== conn.organizationId || !user.organization) return null;
  if (user.role !== "ACCOUNT_OWNER" && user.role !== "EMPLOYEE") return null;
  if (user.organization.status === "SUSPENDED" || trialExpired(user.organization)) return null;
  if (!conn.lastUsedAt || Date.now() - conn.lastUsedAt.getTime() > 5 * 60_000) {
    await db.aiConnection.update({ where: { id: conn.id }, data: { lastUsedAt: new Date() } });
  }
  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    email: user.email,
    role: user.role as Role,
    organizationId: conn.organizationId,
    organizationName: user.organization.name,
    branchId: user.branchId,
    ownerId: null,
    tenantId: null,
    assignedPropertyIds: user.assignments.map((a) => a.propertyId),
    permissions: user.role === "EMPLOYEE" ? normalizePermissions(user.permissions) : [],
    allProperties: user.role !== "EMPLOYEE" || user.allProperties,
    connectionId: conn.id,
    clientName: conn.clientName,
  };
}

/** CORS for the OAuth and MCP endpoints: browser-based MCP clients and inspectors call them cross-origin. */
export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
};

export function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS, ...extra } });
}
