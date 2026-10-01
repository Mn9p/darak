import { describe, it, expect } from "vitest";
import {
  can,
  isScoped,
  propertyScope,
  propertyIdScope,
  contractScope,
  normalizePermissions,
  effectivePermissions,
  matchPreset,
  ALL_PERMISSIONS,
  GRANTABLE,
  OWNER_ONLY,
  PRESETS,
  PERMISSION_GROUPS,
  type Permission,
} from "@/lib/permissions";
import type { Role } from "@/lib/constants";
import type { SessionUser } from "@/lib/auth";

const user = (role: Role, opts: { permissions?: Permission[]; allProperties?: boolean; assigned?: string[] } = {}): SessionUser => ({
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
  assignedPropertyIds: opts.assigned ?? [],
  permissions: opts.permissions ?? [],
  allProperties: opts.allProperties ?? true,
});

describe("Account owner", () => {
  it("holds every permission, including the owner-only ones", () => {
    const u = user("ACCOUNT_OWNER");
    for (const p of ALL_PERMISSIONS) expect(can(u, p)).toBe(true);
    expect(effectivePermissions(u)).toEqual(ALL_PERMISSIONS);
  });
  it("is never scoped to assigned properties", () => {
    const u = user("ACCOUNT_OWNER", { allProperties: false, assigned: ["p1"] });
    expect(isScoped(u)).toBe(false);
    expect(propertyScope(u)).toEqual({});
  });
});

describe("Employee", () => {
  it("can only what was granted", () => {
    const u = user("EMPLOYEE", { permissions: normalizePermissions(["collections.manage", "payments.manage"]) });
    expect(can(u, "collections.manage")).toBe(true);
    expect(can(u, "collections.view")).toBe(true);
    expect(can(u, "payments.view")).toBe(true);
    expect(can(u, "contracts.view")).toBe(false);
    expect(can(u, "owners.financial")).toBe(false);
  });
  it("never holds owner-only permissions, even if stored", () => {
    const u = user("EMPLOYEE", { permissions: [...OWNER_ONLY] as Permission[] });
    for (const p of OWNER_ONLY) expect(can(u, p)).toBe(false);
    expect(normalizePermissions(OWNER_ONLY)).toEqual(["dashboard.view"]);
  });
  it("scoped employee sees only assigned properties (none when nothing is assigned)", () => {
    const u = user("EMPLOYEE", { allProperties: false, assigned: ["p1", "p2"] });
    expect(propertyScope(u)).toEqual({ id: { in: ["p1", "p2"] } });
    expect(propertyIdScope(u)).toEqual({ propertyId: { in: ["p1", "p2"] } });
    expect(contractScope(u)).toEqual({ contract: { propertyId: { in: ["p1", "p2"] } } });
    expect(propertyScope(user("EMPLOYEE", { allProperties: false }))).toEqual({ id: { in: [] } });
  });
});

describe("normalizePermissions", () => {
  it("adds the module view and the dashboard, drops unknown keys, keeps catalogue order", () => {
    expect(normalizePermissions(["contracts.manage", "nope", 3])).toEqual(["dashboard.view", "contracts.view", "contracts.manage"]);
  });
  it("approving statements brings preparing and viewing them", () => {
    const p = normalizePermissions(["statements.approve"]);
    expect(p).toEqual(expect.arrayContaining(["statements.view", "statements.manage", "statements.approve"]));
  });
  it("reads the stored JSON string and survives bad input", () => {
    expect(normalizePermissions('["tasks.manage"]')).toEqual(["dashboard.view", "tasks.view", "tasks.manage"]);
    expect(normalizePermissions("{bad")).toEqual(["dashboard.view"]);
    expect(normalizePermissions(null)).toEqual(["dashboard.view"]);
  });
  it("is idempotent", () => {
    for (const preset of PRESETS) expect(normalizePermissions(preset.permissions)).toEqual(preset.permissions);
  });
});

describe("Catalogue and presets", () => {
  it("the checklist covers every grantable permission except the implicit dashboard, once", () => {
    const listed = PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.key));
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual(GRANTABLE.filter((p) => p !== "dashboard.view").sort());
  });
  it("read-only preset has no manage/approve rights", () => {
    const ro = PRESETS.find((p) => p.key === "READONLY")!;
    expect(ro.permissions.some((p) => /\.(manage|approve|waive|export)$/.test(p))).toBe(false);
    expect(ro.permissions).toContain("audit.view");
  });
  it("matchPreset recognises a preset regardless of order", () => {
    const col = PRESETS.find((p) => p.key === "COLLECTION")!;
    expect(matchPreset([...col.permissions].reverse(), true)?.key).toBe("COLLECTION");
    expect(matchPreset(col.permissions, false)).toBeNull();
  });
});

describe("Portal users", () => {
  it("property owners and tenants hold no office permissions", () => {
    for (const role of ["OWNER", "TENANT"] as Role[]) {
      expect(effectivePermissions(user(role, { permissions: ["dashboard.view"] }))).toEqual([]);
    }
  });
});
