"use server";


import { actionFailure, failFromError, userMessage } from "@/lib/action-error";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireStaff, type SessionUser } from "@/lib/auth";
import { assertCan, can, propertyIdScope, propertyScope } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { nextCode } from "@/lib/codes";
import { getOrgSettings } from "@/lib/engine";
import { autoTask, notify } from "@/lib/notify";
import { money, r2 } from "@/lib/format";
import { putFile } from "@/lib/storage";
import type { FormState } from "@/components/ui";

const schema = z.object({
  propertyId: z.string().min(1, "العقار مطلوب"),
  unitId: z.string().optional().nullable(),
  ownerId: z.string().optional().nullable(),
  payee: z.string().max(120).optional().nullable(),
  category: z.string().min(1, "فئة المصروف مطلوبة"),
  description: z.string().min(2, "وصف المصروف مطلوب"),
  amount: z.coerce.number().positive("المبلغ يجب أن يكون أكبر من صفر").transform(r2),
  vatAmount: z.coerce.number().min(0, "قيمة الضريبة غير صحيحة").default(0).transform(r2),
  date: z.string().min(1, "تاريخ المصروف مطلوب"),
  invoiceNumber: z.string().optional().nullable(),
  method: z.string().default("BANK_TRANSFER"),
  notes: z.string().optional().nullable(),
});

const AUTO_NOTE = "اعتماد تلقائي حسب السياسة";
const MANAGER_NOTE = "يتطلب اعتماد مدير المكتب (تجاوز حد الاعتماد)";

function parse(formData: FormData) {
  const raw: Record<string, unknown> = {};
  formData.forEach((v, k) => {
    if (k === "id" || k === "applyVat" || k === "invoice") return;
    raw[k] = v === "" ? null : v;
  });
  if (raw.vatAmount === null || raw.vatAmount === undefined) raw.vatAmount = 0;
  if (!raw.method) raw.method = "BANK_TRANSFER";
  return schema.safeParse(raw);
}

type Staff = SessionUser & { organizationId: string };
type UploadedInvoice = { url: string; name: string; size: number; contentType: string };

/** Optional invoice file → private storage. Returns null when no file was chosen; throws with an Arabic message on validation failure. */
async function uploadInvoice(user: Staff, formData: FormData): Promise<UploadedInvoice | null> {
  const f = formData.get("invoice");
  if (!(f instanceof File) || f.size === 0) return null;
  const stored = await putFile({ organizationId: user.organizationId, entity: "EXPENSE", file: f, uploadedById: user.id });
  return { url: stored.url, name: stored.name, size: stored.sizeBytes, contentType: stored.contentType };
}

/** Links the uploaded invoice to the expense as a Document (type INVOICE, entityType EXPENSE). */
async function attachInvoiceDocument(user: Staff, exp: { id: string; code: string; date: Date; invoiceNumber: string | null }, up: UploadedInvoice) {
  const existing = await db.document.count({ where: { organizationId: user.organizationId, entityType: "EXPENSE", entityId: exp.id, type: "INVOICE" } });
  const doc = await db.document.create({
    data: {
      organizationId: user.organizationId,
      name: `فاتورة ${exp.code}${exp.invoiceNumber ? ` — ${exp.invoiceNumber}` : ""}`,
      type: "INVOICE",
      entityType: "EXPENSE",
      entityId: exp.id,
      entityLabel: exp.code,
      issueDate: exp.date,
      visibility: "INTERNAL",
      tags: `ملف: ${up.name}`,
      uploadedById: user.id,
      url: up.url,
      sizeKb: Math.max(1, Math.round(up.size / 1024)),
      version: existing + 1,
    },
  });
  await audit({ user, action: "CREATE", entityType: "DOCUMENT", entityId: doc.id, entityLabel: doc.name, newValue: { type: "INVOICE", entityType: "EXPENSE", entityId: exp.id, file: up.name, size: up.size, contentType: up.contentType } });
  return doc;
}

/** Validates related records belong to the org / scope. Returns an error message or null. */
async function validateRefs(user: SessionUser & { organizationId: string }, d: z.infer<typeof schema>) {
  const org = user.organizationId;
  const property = await db.property.findFirst({ where: { id: d.propertyId, organizationId: org, ...propertyScope(user) }, select: { id: true } });
  if (!property) return "العقار غير موجود أو خارج نطاق صلاحياتك.";
  if (d.unitId) {
    const unit = await db.unit.findFirst({ where: { id: d.unitId, propertyId: d.propertyId, organizationId: org }, select: { id: true } });
    if (!unit) return "الوحدة المختارة لا تتبع هذا العقار.";
  }
  if (d.ownerId) {
    const owner = await db.owner.findFirst({ where: { id: d.ownerId, organizationId: org }, select: { id: true } });
    if (!owner) return "المالك غير موجود.";
  }
  const dt = new Date(d.date);
  if (Number.isNaN(dt.getTime())) return "تاريخ المصروف غير صحيح.";
  return null;
}

/** BR-007 approval workflow decision. */
function decideApproval(total: number, settings: { autoApproveLimit: number; managerApprovalLimit: number }) {
  if (total <= settings.autoApproveLimit) return { status: "APPROVED" as const, note: AUTO_NOTE, requiresManager: false };
  return { status: "PENDING" as const, note: total > settings.managerApprovalLimit ? MANAGER_NOTE : null, requiresManager: total > settings.managerApprovalLimit };
}

function appendNote(notes: string | null | undefined, note: string | null) {
  if (!note) return notes ?? null;
  const base = (notes ?? "").replace(AUTO_NOTE, "").replace(MANAGER_NOTE, "").trim();
  return base ? `${base}\n${note}` : note;
}

async function requestApproval(user: SessionUser & { organizationId: string }, exp: { id: string; code: string; description: string; amount: number; vatAmount: number; propertyName: string }, requiresManager: boolean) {
  const org = user.organizationId;
  const total = exp.amount + exp.vatAmount;
  await notify({
    organizationId: org,
    roles: requiresManager ? ["OFFICE_MANAGER"] : ["OFFICE_MANAGER", "ACCOUNTANT"],
    title: `طلب اعتماد مصروف ${exp.code} — ${money(total)} ر.س`,
    body: `${exp.description} · ${exp.propertyName} · سجّله ${user.name}`,
    severity: requiresManager ? "WARNING" : "INFO",
    entityType: "EXPENSE",
    entityId: exp.id,
    href: `/expenses/${exp.id}`,
  });
  await autoTask({
    organizationId: org,
    title: `اعتماد مصروف ${exp.code}`,
    description: `${exp.description} — ${money(total)} ر.س · ${exp.propertyName}${requiresManager ? " · يتطلب اعتماد مدير المكتب" : ""}`,
    role: requiresManager ? "OFFICE_MANAGER" : "ACCOUNTANT",
    priority: requiresManager ? "HIGH" : "MEDIUM",
    entityType: "EXPENSE",
    entityId: exp.id,
    entityLabel: exp.code,
  });
}

async function completeApprovalTasks(org: string, expenseId: string) {
  await db.task.updateMany({
    where: { organizationId: org, entityType: "EXPENSE", entityId: expenseId, status: { notIn: ["COMPLETED", "CANCELLED"] } },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
}

export async function createExpense(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await requireStaff();
    assertCan(user, "expenses.manage");
    const parsed = parse(formData);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;
    const refError = await validateRefs(user, d);
    if (refError) return { error: refError };

    const org = user.organizationId;
    const settings = await getOrgSettings(org);
    const total = d.amount + d.vatAmount;
    const decision = decideApproval(total, settings);

    let invoice: UploadedInvoice | null = null;
    try {
      invoice = await uploadInvoice(user, formData);
    } catch (e) {
      return { error: `${userMessage(e, "تعذر رفع الفاتورة.")} لم يتم تسجيل أي مبلغ.` };
    }

    let createdId: string;
    try {
      const code = await nextCode(org, "expense");
      const e = await db.expense.create({
        data: {
          organizationId: org,
          code,
          propertyId: d.propertyId,
          unitId: d.unitId ?? null,
          ownerId: d.ownerId ?? null,
          payee: d.payee?.trim() || null,
          category: d.category,
          description: d.description,
          amount: d.amount,
          vatAmount: d.vatAmount,
          date: new Date(d.date),
          invoiceNumber: d.invoiceNumber ?? null,
          method: d.method,
          notes: appendNote(d.notes, decision.note),
          approvalStatus: decision.status,
          approvedById: decision.status === "APPROVED" ? user.id : null,
          approvedAt: decision.status === "APPROVED" ? new Date() : null,
          createdById: user.id,
        },
        include: { property: { select: { name: true } } },
      });
      await audit({ user, action: "CREATE", entityType: "EXPENSE", entityId: e.id, entityLabel: e.code, newValue: { ...d, approvalStatus: decision.status, autoApproved: decision.status === "APPROVED", invoiceFile: invoice ? { file: invoice.name, size: invoice.size } : null } });
      if (invoice) await attachInvoiceDocument(user, { id: e.id, code: e.code, date: e.date, invoiceNumber: e.invoiceNumber }, invoice);
      if (decision.status === "PENDING") {
        await requestApproval(user, { id: e.id, code: e.code, description: e.description, amount: e.amount, vatAmount: e.vatAmount, propertyName: e.property.name }, decision.requiresManager);
      }
      createdId = e.id;
    } catch (err) {
      console.error(err);
      return { error: "تعذر حفظ المصروف حاليًا. لم يتم تسجيل أي مبلغ." };
    }
    revalidatePath("/expenses");
    redirect(`/expenses/${createdId}?toast=created`);
  } catch (e) {
    return actionFailure(e);
  }
}

export async function updateExpense(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await requireStaff();
    assertCan(user, "expenses.manage");
    const id = String(formData.get("id"));
    const parsed = parse(formData);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;
    const org = user.organizationId;

    const old = await db.expense.findFirst({ where: { id, organizationId: org, ...propertyIdScope(user) } });
    if (!old) return { error: "المصروف غير موجود." };
    if (old.approvalStatus === "APPROVED" && !can(user, "expenses.approve")) {
      return { error: "لا يمكن تعديل مصروف معتمد إلا بصلاحية الاعتماد." };
    }
    const refError = await validateRefs(user, d);
    if (refError) return { error: refError };

    // Once the expense sits inside a locked (non-draft) owner statement period for its property, its financial fields are frozen:
    // corrections go through a new adjustment expense so the statement and the ledger keep agreeing.
    const newDate = new Date(d.date);
    const financialChange =
      Math.abs(old.amount - d.amount) > 0.001 ||
      Math.abs(old.vatAmount - d.vatAmount) > 0.001 ||
      old.date.getTime() !== newDate.getTime() ||
      old.propertyId !== d.propertyId ||
      (old.ownerId ?? null) !== (d.ownerId ?? null);
    if (financialChange) {
      const locked = await db.ownerStatement.findFirst({
        where: {
          organizationId: org,
          status: { notIn: ["DRAFT", "CANCELLED"] },
          periodStart: { lte: old.date },
          periodEnd: { gte: old.date },
          OR: [{ propertyId: old.propertyId }, { propertyId: null, owner: { ownerships: { some: { propertyId: old.propertyId } } } }],
        },
        select: { id: true },
      });
      if (locked) return { error: "المصروف مضمّن في كشف حساب معتمد. أنشئ مصروف تصحيح بدلًا من التعديل." };
    }

    const settings = await getOrgSettings(org);
    const total = d.amount + d.vatAmount;
    // Approved expenses edited by an approver stay approved — unless the new total is above what this editor may approve
    // (BR-007: above the manager limit only the office manager approves), then it goes back to the queue for the manager.
    // A rejected one goes back to the approval queue; otherwise re-run BR-007.
    const isManager = ["OFFICE_MANAGER", "SUPER_ADMIN"].includes(user.role);
    const decision =
      old.approvalStatus === "APPROVED"
        ? total > settings.managerApprovalLimit && !isManager && total > old.amount + old.vatAmount + 0.001
          ? { status: "PENDING" as const, note: MANAGER_NOTE, requiresManager: true }
          : { status: "APPROVED" as const, note: null, requiresManager: false }
        : old.approvalStatus === "REJECTED"
          ? { status: "PENDING" as const, note: total > settings.managerApprovalLimit ? MANAGER_NOTE : null, requiresManager: total > settings.managerApprovalLimit }
          : decideApproval(total, settings);

    let invoice: UploadedInvoice | null = null;
    try {
      invoice = await uploadInvoice(user, formData);
    } catch (e) {
      return { error: `${userMessage(e, "تعذر رفع الفاتورة.")} لم يتم تغيير أي بيانات.` };
    }

    try {
      const e = await db.expense.update({
        where: { id },
        data: {
          propertyId: d.propertyId,
          unitId: d.unitId ?? null,
          ownerId: d.ownerId ?? null,
          payee: d.payee?.trim() || null,
          category: d.category,
          description: d.description,
          amount: d.amount,
          vatAmount: d.vatAmount,
          date: new Date(d.date),
          invoiceNumber: d.invoiceNumber ?? null,
          method: d.method,
          notes: appendNote(d.notes, decision.note),
          approvalStatus: decision.status,
          ...(old.approvalStatus !== "APPROVED" || decision.status !== "APPROVED"
            ? {
                approvedById: decision.status === "APPROVED" ? user.id : null,
                approvedAt: decision.status === "APPROVED" ? new Date() : null,
              }
            : {}),
        },
        include: { property: { select: { name: true } } },
      });
      await audit({
        user,
        action: "UPDATE",
        entityType: "EXPENSE",
        entityId: id,
        entityLabel: old.code,
        oldValue: { amount: old.amount, vatAmount: old.vatAmount, category: old.category, description: old.description, approvalStatus: old.approvalStatus },
        newValue: { ...d, approvalStatus: decision.status, invoiceFile: invoice ? { file: invoice.name, size: invoice.size } : null },
      });
      if (invoice) await attachInvoiceDocument(user, { id: e.id, code: e.code, date: e.date, invoiceNumber: e.invoiceNumber }, invoice);
      if (decision.status === "PENDING") {
        await requestApproval(user, { id: e.id, code: e.code, description: e.description, amount: e.amount, vatAmount: e.vatAmount, propertyName: e.property.name }, decision.requiresManager);
      } else if (old.approvalStatus !== "APPROVED") {
        await completeApprovalTasks(org, id);
      }
    } catch (err) {
      console.error(err);
      return { error: "تعذر حفظ التعديلات حاليًا. لم يتم تغيير أي بيانات." };
    }
    revalidatePath("/expenses");
    revalidatePath(`/expenses/${id}`);
    redirect(`/expenses/${id}?toast=updated`);
  } catch (e) {
    return actionFailure(e);
  }
}

export async function approveExpense(formData: FormData) {
  try {
    const user = await requireStaff();
    assertCan(user, "expenses.approve");
    const id = String(formData.get("id"));
    const org = user.organizationId;
    const e = await db.expense.findFirst({ where: { id, organizationId: org, ...propertyIdScope(user) }, include: { createdBy: { select: { id: true } } } });
    if (!e) return;
    if (e.approvalStatus !== "PENDING") throw new Error("هذا المصروف ليس بانتظار الاعتماد.");
    const settings = await getOrgSettings(org);
    const total = e.amount + e.vatAmount;
    if (total > settings.managerApprovalLimit && !["OFFICE_MANAGER", "SUPER_ADMIN"].includes(user.role)) {
      throw new Error(`هذا المصروف يتجاوز حد الاعتماد (${money(settings.managerApprovalLimit)} ر.س) ويتطلب اعتماد مدير المكتب.`);
    }
    const moved = await db.expense.updateMany({ where: { id, approvalStatus: "PENDING" }, data: { approvalStatus: "APPROVED", approvedById: user.id, approvedAt: new Date() } });
    if (moved.count !== 1) throw new Error("تغيرت حالة المصروف قبل الاعتماد. حدّث الصفحة.");
    await audit({ user, action: "APPROVE", entityType: "EXPENSE", entityId: id, entityLabel: e.code, oldValue: { approvalStatus: "PENDING" }, newValue: { approvalStatus: "APPROVED", total } });
    await completeApprovalTasks(org, id);
    if (e.createdBy && e.createdBy.id !== user.id) {
      await notify({ organizationId: org, userIds: [e.createdBy.id], title: `تم اعتماد المصروف ${e.code}`, body: `${e.description} — ${money(total)} ر.س`, severity: "SUCCESS", entityType: "EXPENSE", entityId: id, href: `/expenses/${id}` });
    }
    revalidatePath("/expenses");
    revalidatePath(`/expenses/${id}`);
    redirect(`/expenses/${id}?toast=approved`);
  } catch (e) {
    await failFromError(e);
  }
}

export async function rejectExpense(formData: FormData) {
  try {
    const user = await requireStaff();
    assertCan(user, "expenses.approve");
    const id = String(formData.get("id"));
    const reason = String(formData.get("reason") ?? "").trim();
    const org = user.organizationId;
    const e = await db.expense.findFirst({ where: { id, organizationId: org, ...propertyIdScope(user) }, include: { createdBy: { select: { id: true } } } });
    if (!e) return;
    if (e.approvalStatus !== "PENDING") throw new Error("هذا المصروف ليس بانتظار الاعتماد.");
    const rejectionNote = `سبب الرفض: ${reason || "غير محدد"}`;
    await db.expense.update({
      where: { id },
      data: { approvalStatus: "REJECTED", approvedById: user.id, approvedAt: new Date(), notes: appendNote(e.notes, rejectionNote) },
    });
    await audit({ user, action: "REJECT", entityType: "EXPENSE", entityId: id, entityLabel: e.code, oldValue: { approvalStatus: "PENDING" }, newValue: { approvalStatus: "REJECTED", reason } });
    await completeApprovalTasks(org, id);
    if (e.createdBy && e.createdBy.id !== user.id) {
      await notify({ organizationId: org, userIds: [e.createdBy.id], title: `تم رفض المصروف ${e.code}`, body: rejectionNote, severity: "WARNING", entityType: "EXPENSE", entityId: id, href: `/expenses/${id}` });
    }
    revalidatePath("/expenses");
    revalidatePath(`/expenses/${id}`);
    redirect(`/expenses/${id}?toast=updated`);
  } catch (e) {
    await failFromError(e);
  }
}
