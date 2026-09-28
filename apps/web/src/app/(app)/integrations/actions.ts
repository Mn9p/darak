"use server";


import { actionFailure, failFromError } from "@/lib/action-error";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { assertCan } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { INTEGRATION_PROVIDERS } from "@/lib/constants";
import { safeJson } from "@/lib/format";
import type { FormState } from "@/components/ui";
import { PROVIDER_CONFIG_FIELDS } from "./providers";

/** Never persist secret-looking config values in logs/audit. */
function redact(config: Record<string, string>) {
  return Object.fromEntries(Object.entries(config).map(([k, v]) => [k, /secret|key|token|password/i.test(k) ? "••••" : v]));
}

async function getOrCreate(orgId: string, provider: string) {
  const meta = INTEGRATION_PROVIDERS[provider];
  if (!meta) throw new Error("مزود التكامل غير معروف.");
  return db.integration.upsert({
    where: { organizationId_provider: { organizationId: orgId, provider } },
    update: {},
    create: { organizationId: orgId, provider, name: meta.label, status: "DISCONNECTED", config: "{}" },
  });
}

async function log(integrationId: string, level: "INFO" | "WARN" | "ERROR", message: string, payload?: unknown) {
  await db.integrationLog.create({ data: { integrationId, level, message, payload: payload ? JSON.stringify(payload) : null } });
}

/** Connect (or update config of) a provider. */
export async function connectIntegration(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await requireStaff();
    assertCan(user, "integrations.manage");
    const provider = String(formData.get("provider") ?? "");
    const fields = PROVIDER_CONFIG_FIELDS[provider];
    if (!fields) return { error: "مزود التكامل غير معروف." };
    const config: Record<string, string> = {};
    for (const f of fields) {
      const v = String(formData.get(f.key) ?? "").trim();
      if (!v) return { error: `الحقل «${f.label}» مطلوب لإتمام الربط.` };
      config[f.key] = v;
    }
    const row = await getOrCreate(user.organizationId, provider);
    const old = { status: row.status, config: safeJson(row.config, {}) };
    await db.integration.update({ where: { id: row.id }, data: { status: "CONNECTED", lastError: null, config: JSON.stringify(config) } });
    await log(row.id, "INFO", "تم الربط وحفظ الإعدادات", redact(config));
    await audit({ user, action: "UPDATE", entityType: "INTEGRATION", entityId: row.id, entityLabel: row.name, oldValue: { ...old, config: redact(old.config as Record<string, string>) }, newValue: { status: "CONNECTED", config: redact(config) } });
    revalidatePath("/integrations");
    return { success: "تم الربط بنجاح." };
  } catch (e) {
    return actionFailure(e);
  }
}

export async function disconnectIntegration(formData: FormData) {
  try {
    const user = await requireStaff();
    assertCan(user, "integrations.manage");
    const id = String(formData.get("id"));
    const row = await db.integration.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!row) return;
    await db.integration.update({ where: { id }, data: { status: "DISCONNECTED", lastError: null } });
    await log(id, "WARN", "تم فصل التكامل بواسطة المستخدم");
    await audit({ user, action: "STATUS_CHANGE", entityType: "INTEGRATION", entityId: id, entityLabel: row.name, oldValue: { status: row.status }, newValue: { status: "DISCONNECTED" } });
    revalidatePath("/integrations");
  } catch (e) {
    await failFromError(e);
  }
}

export async function retryIntegration(formData: FormData) {
  try {
    const user = await requireStaff();
    assertCan(user, "integrations.manage");
    const id = String(formData.get("id"));
    const row = await db.integration.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!row) return;
    await db.integration.update({ where: { id }, data: { status: "CONNECTED", lastError: null } });
    await log(id, "INFO", "إعادة المحاولة — تم استعادة الاتصال", { previousError: row.lastError });
    await audit({ user, action: "STATUS_CHANGE", entityType: "INTEGRATION", entityId: id, entityLabel: row.name, oldValue: { status: row.status, lastError: row.lastError }, newValue: { status: "CONNECTED" } });
    revalidatePath("/integrations");
  } catch (e) {
    await failFromError(e);
  }
}

/** "مزامنة الآن" — runs the provider adapter simulation in isolation from core flows. */
export async function syncIntegration(formData: FormData) {
  try {
    const user = await requireStaff();
    assertCan(user, "integrations.manage");
    const id = String(formData.get("id"));
    const org = user.organizationId;
    const row = await db.integration.findFirst({ where: { id, organizationId: org } });
    if (!row) return;
    const config = safeJson<Record<string, string>>(row.config, {});
    const fields = PROVIDER_CONFIG_FIELDS[row.provider] ?? [];
    const missing = fields.filter((f) => !config[f.key]);

    await db.integration.update({ where: { id }, data: { status: "SYNCING" } });

    if (row.status === "DISCONNECTED" || missing.length) {
      const lastError = missing.length ? `إعدادات ناقصة: ${missing.map((f) => f.label).join("، ")}. أكمل الإعدادات ثم أعد المحاولة.` : "التكامل غير متصل. اربط الحساب أولًا.";
      await db.integration.update({ where: { id }, data: { status: "ERROR", lastError } });
      await log(id, "ERROR", lastError);
      await notify({ organizationId: org, roles: ["OFFICE_MANAGER"], title: `فشل المزامنة: ${row.name}`, body: lastError, severity: "DANGER", entityType: "INTEGRATION", entityId: id, href: "/integrations" });
      await audit({ user, action: "SYNC", entityType: "INTEGRATION", entityId: id, entityLabel: row.name, newValue: { result: "ERROR", lastError } });
      revalidatePath("/integrations");
      return;
    }

    let message = "مزامنة ناجحة";
    let payload: unknown = null;
    let warn: string | null = null;
    const now = new Date();

    try {
      switch (row.provider) {
        case "BANK": {
          const n = await db.bankTransaction.count({ where: { organizationId: org, createdAt: { gte: new Date(now.getTime() - 7 * 86400000) } } });
          message = `تم استيراد ${n} حركة بنكية من ${config.bank}`;
          payload = { imported: n };
          break;
        }
        case "WHATSAPP":
        case "SMS":
        case "EMAIL": {
          const ch = row.provider;
          const n = await db.notification.count({ where: { organizationId: org, channel: ch, createdAt: { gte: new Date(now.getTime() - 86400000) } } });
          message = `تم تسليم ${n} رسالة خلال 24 ساعة — القناة جاهزة`;
          payload = { delivered: n };
          break;
        }
      }
      await db.integration.update({ where: { id }, data: { status: "CONNECTED", lastSyncAt: now, lastError: null } });
      await log(id, "INFO", message, payload);
      if (warn) await log(id, "WARN", warn);
      await audit({ user, action: "SYNC", entityType: "INTEGRATION", entityId: id, entityLabel: row.name, newValue: { result: "OK", message, payload } });
    } catch (e) {
      const lastError = (e as Error).message?.slice(0, 200) || "خطأ غير متوقع أثناء المزامنة";
      await db.integration.update({ where: { id }, data: { status: "ERROR", lastError } });
      await log(id, "ERROR", lastError);
      await notify({ organizationId: org, roles: ["OFFICE_MANAGER"], title: `فشل المزامنة: ${row.name}`, body: lastError, severity: "DANGER", entityType: "INTEGRATION", entityId: id, href: "/integrations" });
      await audit({ user, action: "SYNC", entityType: "INTEGRATION", entityId: id, entityLabel: row.name, newValue: { result: "ERROR", lastError } });
    }
    revalidatePath("/integrations");
  } catch (e) {
    await failFromError(e);
  }
}
