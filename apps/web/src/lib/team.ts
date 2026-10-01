// Who in the office can do what — for pickers ("assign to"), notifications and automatic task assignment.
// Account owners can do everything; employees only what they were granted (User.permissions).
import { db } from "./db";
import { can, normalizePermissions, type Permission } from "./permissions";

export type TeamMember = { id: string; name: string; role: string; permissions: Permission[] };

/** Active team members of an organization (owners first, then employees, by name). */
export async function activeTeam(organizationId: string): Promise<TeamMember[]> {
  const rows = await db.user.findMany({
    where: { organizationId, role: { in: ["ACCOUNT_OWNER", "EMPLOYEE"] }, status: "ACTIVE" },
    select: { id: true, name: true, role: true, permissions: true, createdAt: true },
    orderBy: [{ createdAt: "asc" }],
  });
  return rows
    .map((u) => ({ id: u.id, name: u.name, role: u.role, permissions: u.role === "EMPLOYEE" ? normalizePermissions(u.permissions) : [] }))
    .sort((a, b) => (a.role === b.role ? 0 : a.role === "ACCOUNT_OWNER" ? -1 : 1));
}

/** Active team members holding a permission — for "assign to" pickers. Sorted by name. */
export async function teamWith(organizationId: string, permission: Permission): Promise<{ id: string; name: string }[]> {
  return (await activeTeam(organizationId))
    .filter((u) => can(u, permission))
    .map(({ id, name }) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "ar"));
}

/** Active account owners. */
export async function accountOwnerIds(organizationId: string): Promise<string[]> {
  return (await activeTeam(organizationId)).filter((u) => u.role === "ACCOUNT_OWNER").map((u) => u.id);
}

/**
 * Default assignee for automatic work: the longest-serving active employee holding the permission, otherwise the
 * first account owner (unless fallbackToOwner is false). Null when nobody qualifies.
 */
export async function defaultAssignee(organizationId: string, permission?: Permission, opts: { fallbackToOwner?: boolean } = {}): Promise<string | null> {
  const team = await activeTeam(organizationId);
  if (permission) {
    const employee = team.find((u) => u.role === "EMPLOYEE" && can(u, permission));
    if (employee) return employee.id;
  }
  if (opts.fallbackToOwner === false) return null;
  return team.find((u) => u.role === "ACCOUNT_OWNER")?.id ?? null;
}

/**
 * An active team member who holds `permission`, with their property reach — for validating "assign to" choices
 * (a case or lead must not go to someone who cannot open it). Null when the user does not qualify.
 */
export async function assignableMember(organizationId: string, userId: string, permission: Permission) {
  const u = await db.user.findFirst({
    where: { id: userId, organizationId, status: "ACTIVE", role: { in: ["ACCOUNT_OWNER", "EMPLOYEE"] } },
    select: { id: true, name: true, role: true, permissions: true, allProperties: true, assignments: { select: { propertyId: true } } },
  });
  if (!u) return null;
  const member = { role: u.role, permissions: u.role === "EMPLOYEE" ? normalizePermissions(u.permissions) : [] };
  if (!can(member, permission)) return null;
  const allProperties = u.role !== "EMPLOYEE" || u.allProperties;
  const propertyIds = u.assignments.map((a) => a.propertyId);
  return { id: u.id, name: u.name, reaches: (propertyId: string | null | undefined) => allProperties || (!!propertyId && propertyIds.includes(propertyId)) };
}
