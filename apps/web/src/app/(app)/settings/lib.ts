// Settings helpers (server-only, NOT a server-action module).
import { db } from "@/lib/db";
import { DEFAULT_ORG_SETTINGS } from "@/lib/constants";
import { safeJson } from "@/lib/format";

export type CustomFieldEntity = "PROPERTY" | "UNIT" | "TENANT" | "OWNER";
export interface ExtSettings {
  graceDays: number;
  statutoryGrace: boolean;
  dueSoonDays: number;
  autoApproveLimit: number;
  managerApprovalLimit: number;
  contractExpiryAlerts: number[];
  documentExpiryAlerts: number[];
  vatRate: number;
  currency: string;
  customFields: Record<CustomFieldEntity, string[]>;
  tags: string[];
  /** Office collection account shown to tenants in their portal («كيف أسدد؟»). */
  bank?: { bankName?: string | null; iban?: string | null; accountName?: string | null };
}

export async function readSettings(orgId: string): Promise<ExtSettings> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { settings: true } });
  const s = safeJson<Partial<ExtSettings>>(org?.settings, {});
  return {
    ...DEFAULT_ORG_SETTINGS,
    ...s,
    customFields: { PROPERTY: [], UNIT: [], TENANT: [], OWNER: [], ...(s.customFields ?? {}) },
    tags: s.tags ?? [],
  };
}

export async function writeSettings(orgId: string, next: ExtSettings) {
  await db.organization.update({ where: { id: orgId }, data: { settings: JSON.stringify(next) } });
}
