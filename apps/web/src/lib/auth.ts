import { cookies, headers } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { redirect } from "next/navigation";
import { db } from "./db";
import { authSecret } from "./secrets";
import type { Role } from "./constants";
import { can, normalizePermissions, type Permission } from "./permissions";
import { routePermission } from "./nav";
import { isTestPhone } from "./test-accounts";
import { cache } from "react";

const COOKIE = "darak_session";
const secret = () => new TextEncoder().encode(authSecret());
const SESSION_DAYS = 7;

export interface SessionUser {
  id: string;
  name: string;
  /** Normalized 9665XXXXXXXX — the login identity. */
  phone: string;
  email: string | null;
  role: Role;
  organizationId: string | null;
  organizationName: string | null;
  branchId: string | null;
  ownerId: string | null;
  tenantId: string | null;
  assignedPropertyIds: string[];
  /** EMPLOYEE: the permissions an account owner granted (normalized). Empty for every other role — see can(). */
  permissions: Permission[];
  /** EMPLOYEE: false = limited to assignedPropertyIds. Always true for other roles. */
  allProperties: boolean;
  /** Platform support impersonation flag — logged in Audit Log */
  supportAccess?: boolean;
  /** Platform admin acting through this support session (Session.supportAdminId); null for normal sessions. */
  supportAdminId?: string | null;
  supportAdminName?: string | null;
  /** When the current session row expires — drives the support-session countdown banner. */
  sessionExpiresAt?: Date | null;
  /** Session row behind the current request (marks "this device" in session lists). */
  sessionId?: string | null;
}

/** Hard cap for time-boxed sessions (support access). Normal sessions last SESSION_DAYS. */
export const SESSION_MAX_MINUTES = 240;

export async function createSession(userId: string, opts?: { supportAccess?: boolean; supportAdminId?: string; minutes?: number }) {
  const h = await headers();
  const minutes = opts?.minutes && Number.isFinite(opts.minutes) ? Math.min(SESSION_MAX_MINUTES, Math.max(1, Math.floor(opts.minutes))) : null;
  const expiresAt = new Date(Date.now() + (minutes ? minutes * 60_000 : SESSION_DAYS * 86400 * 1000));
  const session = await db.session.create({
    data: {
      userId,
      device: h.get("user-agent")?.slice(0, 200) ?? null,
      ip: h.get("x-forwarded-for") ?? "local",
      expiresAt,
      supportAdminId: opts?.supportAdminId ?? null,
    },
  });
  const token = await new SignJWT({ sid: session.id, uid: userId, sa: opts?.supportAccess ?? false })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(secret());
  const c = await cookies();
  c.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // Set COOKIE_SECURE=false when serving production over plain http (e.g. LAN IP without TLS).
    secure: process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false",
    expires: expiresAt,
    path: "/",
  });
  return session.id;
}

export async function destroySession() {
  const c = await cookies();
  const token = c.get(COOKIE)?.value;
  if (token) {
    try {
      const { payload } = await jwtVerify(token, secret());
      if (payload.sid) {
        await db.session.updateMany({ where: { id: String(payload.sid) }, data: { revokedAt: new Date() } });
      }
    } catch {}
  }
  c.delete(COOKIE);
}

/** Trial organizations whose renewal date has passed are treated like SUSPENDED (except for platform admins). */
export function trialExpired(org: { status: string; renewalDate: Date | null } | null | undefined) {
  return Boolean(org && org.status === "TRIAL" && org.renewalDate && org.renewalDate.getTime() < Date.now());
}

/**
 * Optional sign-in allowlist (LOGIN_ALLOWED_PHONES, comma-separated Saudi mobiles). While set, only these numbers can
 * receive a login code or be chosen as a login number — used during the closed stakeholder test. Empty = no restriction.
 */
export function loginAllowedPhones(): string[] | null {
  const list = (process.env.LOGIN_ALLOWED_PHONES ?? "")
    .split(",")
    .map((p) => p.replace(/[^\d+]/g, ""))
    .filter(Boolean)
    .map((p) => (p.startsWith("+") ? p.slice(1) : p))
    .map((p) => (p.startsWith("966") ? p : p.startsWith("0") ? `966${p.slice(1)}` : p.startsWith("5") ? `966${p}` : p))
    .filter((p) => /^9665\d{8}$/.test(p));
  return list.length ? list : null;
}

/** True when the (normalized 9665…) number may sign in under the current allowlist. */
export function loginAllowed(phone: string): boolean {
  const list = loginAllowedPhones();
  return !list || list.includes(phone) || isTestPhone(phone);
}

type Denied = "TRIAL_EXPIRED" | null;

/** Resolves the session once per request; `denied` explains a null user when the reason should be surfaced. */
const resolveSession = cache(async (): Promise<{ user: SessionUser | null; denied: Denied }> => {
  const c = await cookies();
  const token = c.get(COOKIE)?.value;
  if (!token) return { user: null, denied: null };
  try {
    const { payload } = await jwtVerify(token, secret());
    const session = await db.session.findUnique({ where: { id: String(payload.sid) } });
    if (!session || session.revokedAt || session.expiresAt < new Date()) return { user: null, denied: null };
    const user = await db.user.findUnique({
      where: { id: session.userId },
      include: { organization: { select: { name: true, status: true, renewalDate: true } }, assignments: { select: { propertyId: true } } },
    });
    if (!user || user.status !== "ACTIVE") return { user: null, denied: null };
    const supportAdminId = session.supportAdminId ?? null;
    const supportAccess = Boolean(payload.sa) || Boolean(supportAdminId);
    if (user.organization && user.role !== "SUPER_ADMIN") {
      // A suspended office still needs to be reachable by platform support; every other rule stays as is.
      if (user.organization.status === "SUSPENDED" && !supportAdminId) return { user: null, denied: null };
      if (trialExpired(user.organization)) return { user: null, denied: "TRIAL_EXPIRED" };
    }
    const admin = supportAdminId ? await db.user.findUnique({ where: { id: supportAdminId }, select: { name: true } }) : null;
    return {
      denied: null,
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        email: user.email,
        role: user.role as Role,
        organizationId: user.organizationId,
        organizationName: user.organization?.name ?? null,
        branchId: user.branchId,
        ownerId: user.ownerId,
        tenantId: user.tenantId,
        assignedPropertyIds: user.assignments.map((a) => a.propertyId),
        permissions: user.role === "EMPLOYEE" ? normalizePermissions(user.permissions) : [],
        allProperties: user.role !== "EMPLOYEE" || user.allProperties,
        supportAccess,
        supportAdminId,
        supportAdminName: admin?.name ?? null,
        sessionExpiresAt: session.expiresAt,
        sessionId: session.id,
      },
    };
  } catch {
    return { user: null, denied: null };
  }
});

/** Returns the current user or null. Cached per request. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => (await resolveSession()).user);

/** Require an authenticated user; redirects to /login otherwise (with ?expired=1 when the trial has ended). */
export async function requireUser(): Promise<SessionUser> {
  const { user, denied } = await resolveSession();
  if (!user) redirect(denied === "TRIAL_EXPIRED" ? "/login?expired=1" : "/login");
  return user;
}

/** Require a staff user with an organization (office operating system). */
export async function requireStaff(): Promise<SessionUser & { organizationId: string }> {
  const user = await requireUser();
  if (user.role === "OWNER") redirect("/owner");
  if (user.role === "TENANT") redirect("/tenant");
  if (user.role === "SUPER_ADMIN" && !user.organizationId) redirect("/admin");
  if (!user.organizationId) redirect("/login");
  // Route guard (BR-005): the module permission of the requested path. Middleware sets x-pathname on every request.
  const pathname = (await headers()).get("x-pathname") ?? "";
  const needed = pathname ? routePermission(pathname) : null;
  if (needed && !can(user, needed)) redirect("/forbidden");
  return user as SessionUser & { organizationId: string };
}

/** Staff page that needs a specific permission beyond the module view (e.g. a /new or /edit form). */
export async function requirePermission(permission: Permission): Promise<SessionUser & { organizationId: string }> {
  const user = await requireStaff();
  if (!can(user, permission)) redirect("/forbidden");
  return user;
}

export async function requireSuperAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "SUPER_ADMIN") redirect("/forbidden");
  return user;
}

export async function requireOwner(): Promise<SessionUser & { ownerId: string; organizationId: string }> {
  const user = await requireUser();
  if (user.role !== "OWNER" || !user.ownerId || !user.organizationId) redirect("/login");
  return user as SessionUser & { ownerId: string; organizationId: string };
}

export async function requireTenant(): Promise<SessionUser & { tenantId: string; organizationId: string }> {
  const user = await requireUser();
  if (user.role !== "TENANT" || !user.tenantId || !user.organizationId) redirect("/login");
  return user as SessionUser & { tenantId: string; organizationId: string };
}

export function homeForRole(role: Role, hasOrg: boolean) {
  if (role === "OWNER") return "/owner";
  if (role === "TENANT") return "/tenant";
  if (role === "SUPER_ADMIN" && !hasOrg) return "/admin";
  return "/dashboard";
}
