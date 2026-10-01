-- Office team roles: the account owner (ACCOUNT_OWNER, full access) and employees (EMPLOYEE) whose permissions and
-- property reach are set per person by an owner. Replaces the fixed job roles OFFICE_MANAGER, PROPERTY_MANAGER,
-- LEASING, COLLECTOR, ACCOUNTANT and AUDITOR; each former role becomes an employee with the matching permission preset
-- (apps/web/src/lib/permissions.ts PRESETS), so nobody gains or loses access in the move.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "permissions" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "User" ADD COLUMN "allProperties" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "NotificationRule" ALTER COLUMN "targetRoles" SET DEFAULT 'ACCOUNT_OWNER';

-- Data: staff roles
UPDATE "User" SET "role" = 'ACCOUNT_OWNER' WHERE "role" = 'OFFICE_MANAGER';
UPDATE "User" SET "role" = 'EMPLOYEE', "permissions" = '["dashboard.view","properties.view","properties.manage","units.view","units.manage","owners.view","tenants.view","tenants.manage","leasing.view","leasing.manage","contracts.view","contracts.manage","installments.view","collections.view","payments.view","expenses.view","expenses.manage","tasks.view","tasks.manage","reports.view","documents.view","documents.manage"]', "allProperties" = false WHERE "role" = 'PROPERTY_MANAGER';
UPDATE "User" SET "role" = 'EMPLOYEE', "permissions" = '["dashboard.view","properties.view","units.view","units.manage","tenants.view","tenants.manage","leasing.view","leasing.manage","contracts.view","contracts.manage","installments.view","tasks.view","tasks.manage","documents.view","documents.manage"]', "allProperties" = true WHERE "role" = 'LEASING';
UPDATE "User" SET "role" = 'EMPLOYEE', "permissions" = '["dashboard.view","properties.view","units.view","tenants.view","contracts.view","installments.view","collections.view","collections.manage","payments.view","payments.manage","tasks.view","tasks.manage","documents.view"]', "allProperties" = true WHERE "role" = 'COLLECTOR';
UPDATE "User" SET "role" = 'EMPLOYEE', "permissions" = '["dashboard.view","properties.view","units.view","owners.view","owners.financial","tenants.view","contracts.view","installments.view","installments.waive","collections.view","payments.view","payments.manage","payments.approve","expenses.view","expenses.manage","expenses.approve","statements.view","statements.manage","statements.approve","tasks.view","tasks.manage","reports.view","reports.financial","reports.export","documents.view","documents.manage","audit.view"]', "allProperties" = true WHERE "role" = 'ACCOUNTANT';
UPDATE "User" SET "role" = 'EMPLOYEE', "permissions" = '["dashboard.view","properties.view","units.view","owners.view","owners.financial","tenants.view","leasing.view","contracts.view","installments.view","collections.view","payments.view","expenses.view","statements.view","tasks.view","employees.view","reports.view","reports.financial","documents.view","audit.view"]', "allProperties" = true WHERE "role" = 'AUDITOR';

-- Data: notification rule audiences (owner / employees / tenant)
UPDATE "NotificationRule" SET "targetRoles" = REPLACE("targetRoles", 'OFFICE_MANAGER', 'ACCOUNT_OWNER');
UPDATE "NotificationRule" SET "targetRoles" = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE("targetRoles", 'PROPERTY_MANAGER', 'EMPLOYEE'), 'LEASING', 'EMPLOYEE'), 'COLLECTOR', 'EMPLOYEE'), 'ACCOUNTANT', 'EMPLOYEE'), 'AUDITOR', 'EMPLOYEE');
