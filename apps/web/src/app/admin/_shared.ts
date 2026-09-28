// Shared helpers for the platform admin area.
import { db } from "@/lib/db";
import { safeJson } from "@/lib/format";

export const FEATURE_FLAGS: Record<string, string> = {
  aiAssistant: "المساعد",
  ownerPortal: "بوابة المالك",
  tenantPortal: "بوابة المستأجر",
};

export type FeatureFlags = Record<keyof typeof FEATURE_FLAGS, boolean>;

export const DEFAULT_FLAGS: Record<string, boolean> = { aiAssistant: false, ownerPortal: true, tenantPortal: true };

export function readFlags(settings: string): Record<string, boolean> {
  const s = safeJson<{ featureFlags?: Record<string, boolean> }>(settings, {});
  return { ...DEFAULT_FLAGS, ...(s.featureFlags ?? {}) };
}

export const DEFAULT_RULES = [
  { name: "تنبيه انتهاء عقد — 90 يوم", event: "CONTRACT_EXPIRING", daysBefore: 90, channels: "IN_APP", targetRoles: "PROPERTY_MANAGER", createTask: false },
  { name: "مهمة متابعة تجديد — 60 يوم", event: "CONTRACT_EXPIRING", daysBefore: 60, channels: "IN_APP,EMAIL", targetRoles: "LEASING", createTask: true },
  { name: "تصعيد انتهاء عقد — 30 يوم", event: "CONTRACT_EXPIRING", daysBefore: 30, channels: "IN_APP,EMAIL", targetRoles: "OFFICE_MANAGER", createTask: false },
  { name: "تذكير المستأجر قبل الاستحقاق", event: "INSTALLMENT_DUE", daysBefore: 7, channels: "SMS,WHATSAPP", targetRoles: "TENANT", createTask: false },
  { name: "فتح مطالبة عند التأخر", event: "INSTALLMENT_OVERDUE", daysBefore: 0, channels: "IN_APP", targetRoles: "COLLECTOR", createTask: true },
  { name: "وعد سداد مكسور", event: "BROKEN_PROMISE", daysBefore: 0, channels: "IN_APP", targetRoles: "COLLECTOR,OFFICE_MANAGER", createTask: true },
  { name: "انتهاء مستند", event: "DOCUMENT_EXPIRING", daysBefore: 30, channels: "IN_APP", targetRoles: "OFFICE_MANAGER", createTask: true },
  { name: "فشل مزامنة تكامل", event: "SYNC_FAILED", daysBefore: 0, channels: "IN_APP,EMAIL", targetRoles: "OFFICE_MANAGER", createTask: false },
  { name: "طلب اعتماد مصروف", event: "EXPENSE_APPROVAL", daysBefore: 0, channels: "IN_APP", targetRoles: "OFFICE_MANAGER,ACCOUNTANT", createTask: false },
];

/** Real DB ping used by the overview and health pages. */
export async function dbPing() {
  const started = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - started };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - started, error: String(e) };
  }
}

export function slugify(name: string) {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9؀-ۿ]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || `org-${Date.now().toString(36)}`;
}
