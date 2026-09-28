import { describe, it, expect } from "vitest";
import { can, propertyScope, propertyIdScope, contractScope, ROLE_PERMISSIONS } from "@/lib/permissions";
import { ROLES, type Role } from "@/lib/constants";
import type { SessionUser } from "@/lib/auth";

const user = (role: Role, assigned: string[] = []): SessionUser => ({
  id: "u",
  name: "n",
  phone: "966500000000",
  email: null,
  role,
  organizationId: "org",
  organizationName: "o",
  branchId: null,
  ownerId: null,
  tenantId: null,
  assignedPropertyIds: assigned,
});

describe("RBAC", () => {
  it("every role in ROLES has a permission set", () => {
    for (const r of Object.keys(ROLES) as Role[]) expect(ROLE_PERMISSIONS[r]).toBeDefined();
  });
  it("collector cannot see owner financials or settings", () => {
    expect(can(user("COLLECTOR"), "collections.manage")).toBe(true);
    expect(can(user("COLLECTOR"), "owners.financial")).toBe(false);
    expect(can(user("COLLECTOR"), "settings.manage")).toBe(false);
  });
  it("auditor is read-only", () => {
    const perms = ROLE_PERMISSIONS.AUDITOR;
    expect(perms.some((p) => p.endsWith(".manage") || p.endsWith(".approve"))).toBe(false);
    expect(perms).toContain("audit.view");
  });
  it("portal roles have no office permissions", () => {
    expect(ROLE_PERMISSIONS.OWNER).toHaveLength(0);
    expect(ROLE_PERMISSIONS.TENANT).toHaveLength(0);
  });
});

describe("Data scope", () => {
  it("property manager with assignments is scoped", () => {
    const u = user("PROPERTY_MANAGER", ["p1", "p2"]);
    expect(propertyScope(u)).toEqual({ id: { in: ["p1", "p2"] } });
    expect(propertyIdScope(u)).toEqual({ propertyId: { in: ["p1", "p2"] } });
    expect(contractScope(u)).toEqual({ contract: { propertyId: { in: ["p1", "p2"] } } });
  });
  it("office manager is never scoped", () => {
    const u = user("OFFICE_MANAGER", ["p1"]);
    expect(propertyScope(u)).toEqual({});
    expect(contractScope(u)).toEqual({});
  });
});
