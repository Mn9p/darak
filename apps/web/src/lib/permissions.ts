// RBAC + Data Scope permissions.
// Each role has a set of permission keys; scope determines which records are visible.
import { redirect } from "next/navigation";
import type { Role } from "./constants";
import type { SessionUser } from "./auth";

export type Permission =
  | "dashboard.view"
  | "properties.view" | "properties.manage"
  | "units.view" | "units.manage"
  | "owners.view" | "owners.manage" | "owners.financial"
  | "tenants.view" | "tenants.manage"
  | "leasing.view" | "leasing.manage"
  | "contracts.view" | "contracts.manage" | "contracts.approve"
  | "installments.view" | "installments.waive"
  | "collections.view" | "collections.manage"
  | "payments.view" | "payments.manage" | "payments.approve"
  | "expenses.view" | "expenses.manage" | "expenses.approve"
  | "statements.view" | "statements.manage"
  | "tasks.view" | "tasks.manage"
  | "employees.view" | "employees.manage"
  | "reports.view" | "reports.financial" | "reports.export"
  | "documents.view" | "documents.manage"
  | "audit.view"
  | "integrations.manage"
  | "settings.manage"
  | "import.manage";

const ALL: Permission[] = [
  "dashboard.view",
  "properties.view", "properties.manage",
  "units.view", "units.manage",
  "owners.view", "owners.manage", "owners.financial",
  "tenants.view", "tenants.manage",
  "leasing.view", "leasing.manage",
  "contracts.view", "contracts.manage", "contracts.approve",
  "installments.view", "installments.waive",
  "collections.view", "collections.manage",
  "payments.view", "payments.manage", "payments.approve",
  "expenses.view", "expenses.manage", "expenses.approve",
  "statements.view", "statements.manage",
  "tasks.view", "tasks.manage",
  "employees.view", "employees.manage",
  "reports.view", "reports.financial", "reports.export",
  "documents.view", "documents.manage",
  "audit.view",
  "integrations.manage",
  "settings.manage",
  "import.manage",
];

const VIEW_ONLY = ALL.filter((p) => p.endsWith(".view") || p === "audit.view" || p === "reports.financial" || p === "owners.financial");

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  SUPER_ADMIN: ALL,
  OFFICE_MANAGER: ALL,
  AUDITOR: VIEW_ONLY,
  PROPERTY_MANAGER: [
    "dashboard.view",
    "properties.view", "properties.manage",
    "units.view", "units.manage",
    "owners.view",
    "tenants.view", "tenants.manage",
    "leasing.view", "leasing.manage",
    "contracts.view", "contracts.manage",
    "installments.view",
    "collections.view",
    "payments.view",
    "expenses.view", "expenses.manage",
    "tasks.view", "tasks.manage",
    "reports.view",
    "documents.view", "documents.manage",
  ],
  LEASING: [
    "dashboard.view",
    "properties.view",
    "units.view", "units.manage",
    "tenants.view", "tenants.manage",
    "leasing.view", "leasing.manage",
    "contracts.view", "contracts.manage",
    "installments.view",
    "tasks.view", "tasks.manage",
    "documents.view", "documents.manage",
  ],
  COLLECTOR: [
    "dashboard.view",
    "properties.view",
    "units.view",
    "tenants.view",
    "contracts.view",
    "installments.view",
    "collections.view", "collections.manage",
    "payments.view", "payments.manage",
    "tasks.view", "tasks.manage",
    "documents.view",
  ],
  ACCOUNTANT: [
    "dashboard.view",
    "properties.view",
    "units.view",
    "owners.view", "owners.financial",
    "tenants.view",
    "contracts.view",
    "installments.view", "installments.waive",
    "collections.view",
    "payments.view", "payments.manage", "payments.approve",
    "expenses.view", "expenses.manage", "expenses.approve",
    "statements.view", "statements.manage",
    "tasks.view", "tasks.manage",
    "reports.view", "reports.financial", "reports.export",
    "documents.view", "documents.manage",
    "audit.view",
  ],
  OWNER: [],
  TENANT: [],
};

export function can(user: Pick<SessionUser, "role">, permission: Permission): boolean {
  return ROLE_PERMISSIONS[user.role]?.includes(permission) ?? false;
}

export function canAny(user: Pick<SessionUser, "role">, permissions: Permission[]): boolean {
  return permissions.some((p) => can(user, p));
}

/** Roles whose visibility is limited to assigned properties (Data Scope: assigned_properties_only). */
export const SCOPED_ROLES: Role[] = ["PROPERTY_MANAGER"];

/** Scoped roles always see only their assigned properties — with no assignment they see none (never the whole office). */
export function isScoped(user: Pick<SessionUser, "role">) {
  return SCOPED_ROLES.includes(user.role);
}

/**
 * Prisma `where` fragment for property-scoped entities.
 * Usage: db.property.findMany({ where: { organizationId, ...propertyScope(user) } })
 */
export function propertyScope(user: SessionUser): { id?: { in: string[] } } {
  if (isScoped(user)) return { id: { in: user.assignedPropertyIds } };
  return {};
}

/** For entities with propertyId (units, contracts, expenses). */
export function propertyIdScope(user: SessionUser): { propertyId?: { in: string[] } } {
  if (isScoped(user)) return { propertyId: { in: user.assignedPropertyIds } };
  return {};
}

/** For entities reached through a contract (installments, payments). */
export function contractScope(user: SessionUser): { contract?: { propertyId: { in: string[] } } } {
  if (isScoped(user)) return { contract: { propertyId: { in: user.assignedPropertyIds } } };
  return {};
}

/** Server actions: stops with the Arabic "no permission" page (a thrown message would be replaced by English text in production). */
export function assertCan(user: SessionUser, permission: Permission) {
  if (!can(user, permission)) redirect("/forbidden");
}
