"use server";


import { actionFailure, failFromError, userMessage } from "@/lib/action-error";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { assertCan } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { putFile, deleteFile } from "@/lib/storage";
import { DOCUMENT_TYPES, DOCUMENT_VISIBILITY, ENTITY_TYPES } from "@/lib/constants";
import type { FormState } from "@/components/ui";

const schema = z.object({
  name: z.string().min(2, "اسم المستند مطلوب"),
  type: z.string().refine((v) => v in DOCUMENT_TYPES, "نوع المستند غير صالح"),
  entityType: z.string().optional().nullable(),
  entityId: z.string().optional().nullable(),
  entityLabel: z.string().optional().nullable(),
  issueDate: z.coerce.date().optional().nullable(),
  expiryDate: z.coerce.date().optional().nullable(),
  visibility: z.string().refine((v) => v in DOCUMENT_VISIBILITY, "مستوى الظهور غير صالح"),
  tags: z.string().optional().default(""),
});

function parse(fd: FormData) {
  const get = (k: string) => {
    const v = fd.get(k);
    return v === null || v === "" || typeof v !== "string" ? null : v;
  };
  const entityType = get("entityType");
  return schema.safeParse({
    name: get("name") ?? "",
    type: get("type") ?? "OTHER",
    entityType: entityType && entityType in ENTITY_TYPES ? entityType : null,
    entityId: get("entityId"),
    entityLabel: get("entityLabel"),
    issueDate: get("issueDate"),
    expiryDate: get("expiryDate"),
    visibility: get("visibility") ?? "INTERNAL",
    tags: get("tags") ?? "",
  });
}

/** A linked record must exist inside the caller's organization. Other entity types (lead, task, ...) are not linkable from the document form. */
async function entityInOrg(organizationId: string, entityType: string | null | undefined, entityId: string | null | undefined) {
  if (!entityType || !entityId) return true;
  const where = { id: entityId, organizationId };
  switch (entityType) {
    case "PROPERTY":
      return Boolean(await db.property.findFirst({ where, select: { id: true } }));
    case "UNIT":
      return Boolean(await db.unit.findFirst({ where, select: { id: true } }));
    case "OWNER":
      return Boolean(await db.owner.findFirst({ where, select: { id: true } }));
    case "TENANT":
      return Boolean(await db.tenant.findFirst({ where, select: { id: true } }));
    case "CONTRACT":
      return Boolean(await db.contract.findFirst({ where, select: { id: true } }));
    default:
      return false;
  }
}

const ENTITY_MISSING = "السجل المرتبط غير موجود.";

/** Returns the uploaded File for a field, or null when nothing was chosen. */
function pickFile(fd: FormData, name: string): File | null {
  const f = fd.get(name);
  return f instanceof File && f.size > 0 ? f : null;
}

/** Stores the file privately; returns the stored info or an Arabic error message (from storage.ts). */
async function storeFile(organizationId: string, file: File, uploadedById: string) {
  try {
    const stored = await putFile({ organizationId, entity: "DOCUMENT", file, uploadedById });
    return { ok: true as const, stored, sizeKb: Math.max(1, Math.round(stored.sizeBytes / 1024)) };
  } catch (e) {
    return { ok: false as const, error: userMessage(e, "تعذر رفع الملف حاليًا. لم يتم حفظ المستند.") };
  }
}

/** Keeps a "ملف: <name>" tag so the original file name stays visible in lists. */
function withFileTag(tags: string, fileName: string) {
  const base = tags
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t && !t.startsWith("ملف:"))
    .join(", ");
  return [base, fileName ? `ملف: ${fileName}` : ""].filter(Boolean).join(", ");
}

function fileNameFromTags(tags: string) {
  return (tags.match(/ملف: ([^,]+)/)?.[1] ?? "").trim();
}

export async function createDocument(_prev: FormState, fd: FormData): Promise<FormState> {
  try {
    const user = await requireStaff();
    assertCan(user, "documents.manage");
    const parsed = parse(fd);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;
    if (d.issueDate && d.expiryDate && d.expiryDate < d.issueDate) return { error: "تاريخ الانتهاء يجب أن يكون بعد تاريخ الإصدار." };
    if (!(await entityInOrg(user.organizationId, d.entityType, d.entityId))) return { error: ENTITY_MISSING };
    const file = pickFile(fd, "file");
    if (!file) return { error: "اختر ملف المستند قبل الحفظ." };

    const up = await storeFile(user.organizationId, file, user.id);
    if (!up.ok) return { error: up.error };

    let docId: string;
    try {
      const doc = await db.document.create({
        data: { organizationId: user.organizationId, name: d.name, type: d.type, entityType: d.entityType ?? null, entityId: d.entityId ?? null, entityLabel: d.entityLabel ?? null, issueDate: d.issueDate ?? null, expiryDate: d.expiryDate ?? null, visibility: d.visibility, tags: withFileTag(d.tags, up.stored.name), uploadedById: user.id, url: up.stored.url, sizeKb: up.sizeKb, version: 1 },
      });
      docId = doc.id;
      await audit({ user, action: "CREATE", entityType: "DOCUMENT", entityId: doc.id, entityLabel: doc.name, newValue: { ...d, file: { name: up.stored.name, size: up.stored.sizeBytes, contentType: up.stored.contentType } } });
    } catch (e) {
      console.error("createDocument failed", e);
      await deleteFile(up.stored.key).catch(() => {});
      return { error: "تعذر حفظ المستند حاليًا. لم يتم تسجيل أي بيانات." };
    }
    revalidatePath("/documents");
    redirect(`/documents/${docId}?toast=created`);
  } catch (e) {
    return actionFailure(e);
  }
}

export async function updateDocument(_prev: FormState, fd: FormData): Promise<FormState> {
  try {
    const user = await requireStaff();
    assertCan(user, "documents.manage");
    const id = String(fd.get("id"));
    const old = await db.document.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!old) return { error: "المستند غير موجود." };
    const parsed = parse(fd);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;
    if (d.issueDate && d.expiryDate && d.expiryDate < d.issueDate) return { error: "تاريخ الانتهاء يجب أن يكون بعد تاريخ الإصدار." };
    if (!(await entityInOrg(user.organizationId, d.entityType, d.entityId))) return { error: ENTITY_MISSING };
    const file = pickFile(fd, "file");

    const base = { name: d.name, type: d.type, entityType: d.entityType ?? null, entityId: d.entityId ?? null, entityLabel: d.entityLabel ?? null, issueDate: d.issueDate ?? null, expiryDate: d.expiryDate ?? null, visibility: d.visibility };
    await db.document.update({ where: { id }, data: { ...base, tags: withFileTag(d.tags, fileNameFromTags(old.tags)) } });
    await audit({ user, action: "UPDATE", entityType: "DOCUMENT", entityId: id, entityLabel: d.name, oldValue: { name: old.name, type: old.type, expiryDate: old.expiryDate, visibility: old.visibility, tags: old.tags }, newValue: d });

    // Optional new file on edit → new version row; the old row is kept for audit (same as uploadVersion).
    if (file) {
      const up = await storeFile(user.organizationId, file, user.id);
      if (!up.ok) return { error: `تم حفظ البيانات، لكن تعذر رفع النسخة الجديدة: ${up.error}` };
      const latest = await db.document.aggregate({ where: { organizationId: user.organizationId, name: d.name, entityType: base.entityType, entityId: base.entityId }, _max: { version: true } });
      const version = (latest._max.version ?? old.version) + 1;
      const doc = await db.document.create({
        data: { organizationId: user.organizationId, ...base, tags: withFileTag(d.tags, up.stored.name), uploadedById: user.id, url: up.stored.url, sizeKb: up.sizeKb, version },
      });
      await audit({ user, action: "CREATE", entityType: "DOCUMENT", entityId: doc.id, entityLabel: `${doc.name} (v${version})`, oldValue: { previousId: old.id, version: old.version }, newValue: { version, file: { name: up.stored.name, size: up.stored.sizeBytes, contentType: up.stored.contentType } } });
      revalidatePath("/documents");
      redirect(`/documents/${doc.id}?toast=updated`);
    }
    revalidatePath(`/documents/${id}`);
    redirect(`/documents/${id}?toast=updated`);
  } catch (e) {
    return actionFailure(e);
  }
}

/** Creates a new Document row (version + 1) linked to the same entity. Older versions are kept for audit. */
export async function uploadVersion(formData: FormData): Promise<void> {
  try {
    const user = await requireStaff();
    assertCan(user, "documents.manage");
    const id = String(formData.get("id"));
    const old = await db.document.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!old) return;
    const file = pickFile(formData, "file");
    if (!file) throw new Error("اختر ملفًا لرفع نسخة جديدة.");
    const up = await storeFile(user.organizationId, file, user.id);
    if (!up.ok) throw new Error(up.error);
    const latest = await db.document.aggregate({ where: { organizationId: user.organizationId, name: old.name, entityType: old.entityType, entityId: old.entityId }, _max: { version: true } });
    const version = (latest._max.version ?? old.version) + 1;
    const expiry = formData.get("expiryDate") ? new Date(String(formData.get("expiryDate"))) : old.expiryDate;
    const doc = await db.document.create({
      data: { organizationId: user.organizationId, name: old.name, type: old.type, entityType: old.entityType, entityId: old.entityId, entityLabel: old.entityLabel, issueDate: formData.get("issueDate") ? new Date(String(formData.get("issueDate"))) : old.issueDate, expiryDate: expiry, visibility: old.visibility, tags: withFileTag(old.tags, up.stored.name), uploadedById: user.id, url: up.stored.url, sizeKb: up.sizeKb, version },
    });
    await audit({ user, action: "CREATE", entityType: "DOCUMENT", entityId: doc.id, entityLabel: `${doc.name} (v${version})`, oldValue: { previousId: old.id, version: old.version }, newValue: { version, file: { name: up.stored.name, size: up.stored.sizeBytes, contentType: up.stored.contentType } } });
    revalidatePath("/documents");
    redirect(`/documents/${doc.id}?toast=updated`);
  } catch (e) {
    await failFromError(e);
  }
}

/** Soft archive: no hard delete. Visibility becomes INTERNAL and the name gets an [مؤرشف] prefix. */
export async function archiveDocument(formData: FormData): Promise<void> {
  try {
    const user = await requireStaff();
    assertCan(user, "documents.manage");
    const id = String(formData.get("id"));
    const old = await db.document.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!old || old.name.startsWith("[مؤرشف]")) return;
    const tags = [old.tags, "archived"].filter(Boolean).join(", ");
    await db.document.update({ where: { id }, data: { name: `[مؤرشف] ${old.name}`, visibility: "INTERNAL", tags } });
    await audit({ user, action: "ARCHIVE", entityType: "DOCUMENT", entityId: id, entityLabel: old.name, oldValue: { name: old.name, visibility: old.visibility }, newValue: { name: `[مؤرشف] ${old.name}`, visibility: "INTERNAL" } });
    revalidatePath("/documents");
    redirect("/documents?toast=archived");
  } catch (e) {
    await failFromError(e);
  }
}

export async function restoreDocument(formData: FormData): Promise<void> {
  try {
    const user = await requireStaff();
    assertCan(user, "documents.manage");
    const id = String(formData.get("id"));
    const old = await db.document.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!old || !old.name.startsWith("[مؤرشف]")) return;
    const name = old.name.replace(/^\[مؤرشف\]\s*/, "");
    const tags = old.tags.split(",").map((t) => t.trim()).filter((t) => t && t !== "archived").join(", ");
    await db.document.update({ where: { id }, data: { name, tags } });
    await audit({ user, action: "UPDATE", entityType: "DOCUMENT", entityId: id, entityLabel: name, oldValue: { name: old.name }, newValue: { name } });
    revalidatePath(`/documents/${id}`);
  } catch (e) {
    await failFromError(e);
  }
}
