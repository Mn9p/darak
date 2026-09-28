"use server";


import { userMessage } from "@/lib/action-error";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { assertCan } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { IMPORT_ENTITIES, type ImportEntity, type RowResult, type ImportReport } from "./spec";
import { validateRows, insertRow, toRowResults, type RawRow } from "./lib";

const MAX_ROWS = 2000;

function assertEntity(entity: string): ImportEntity {
  if (!(entity in IMPORT_ENTITIES)) throw new Error("نوع البيانات غير مدعوم.");
  return entity as ImportEntity;
}

/** Validates mapped rows against the organization's data WITHOUT saving anything. */
export async function validateImport(entityType: string, rows: RawRow[]): Promise<{ results: RowResult[]; error?: string }> {
  const user = await requireStaff();
  assertCan(user, "import.manage");
  const entity = assertEntity(entityType);
  if (!rows.length) return { results: [], error: "لا توجد صفوف للتحقق منها." };
  if (rows.length > MAX_ROWS) return { results: [], error: `الحد الأقصى ${MAX_ROWS} صف في العملية الواحدة.` };
  const { parsed } = await validateRows(user.organizationId, entity, rows);
  return { results: toRowResults(parsed) };
}

/** Re-validates then imports valid rows only. Errored rows are reported and stored in ImportJob.errors. */
export async function runImport(entityType: string, fileName: string, rows: RawRow[]): Promise<{ report?: ImportReport; error?: string }> {
  const user = await requireStaff();
  assertCan(user, "import.manage");
  const entity = assertEntity(entityType);
  if (!rows.length) return { error: "لا توجد صفوف للاستيراد." };
  if (rows.length > MAX_ROWS) return { error: `الحد الأقصى ${MAX_ROWS} صف في العملية الواحدة.` };

  const { parsed, ctx } = await validateRows(user.organizationId, entity, rows);
  const errors: { row: number; message: string }[] = [];
  const created: string[] = [];

  for (const r of parsed) {
    if (!r.ok) {
      errors.push({ row: r.row, message: r.errors.join(" · ") });
      continue;
    }
    try {
      created.push(await insertRow(entity, r.data, ctx, user.id));
    } catch (e) {
      errors.push({ row: r.row, message: `تعذر الحفظ: ${userMessage(e, "خطأ غير متوقع").slice(0, 200)}` });
    }
  }

  const job = await db.importJob.create({
    data: {
      organizationId: user.organizationId,
      userId: user.id,
      entityType: entity,
      fileName: fileName.slice(0, 120) || "paste.csv",
      totalRows: parsed.length,
      successRows: created.length,
      failedRows: errors.length,
      errors: JSON.stringify(errors),
      status: created.length === 0 && errors.length > 0 ? "FAILED" : "COMPLETED",
    },
  });
  await audit({
    user,
    action: "CREATE",
    entityType: "IMPORT",
    entityId: job.id,
    entityLabel: `${IMPORT_ENTITIES[entity].label} — ${job.fileName}`,
    newValue: { entityType: entity, total: parsed.length, success: created.length, failed: errors.length },
  });
  revalidatePath("/import");
  return { report: { jobId: job.id, total: parsed.length, success: created.length, failed: errors.length, errors, created } };
}
