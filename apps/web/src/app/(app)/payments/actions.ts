"use server";


import { actionFailure, failFromError, userMessage } from "@/lib/action-error";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import type { Prisma } from "@darak/db";
import { requireStaff, type SessionUser } from "@/lib/auth";
import { assertCan, can, contractScope } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { nextCode } from "@/lib/codes";
import { refreshInstallments, sendTenantEvent } from "@/lib/engine";
import { notify } from "@/lib/notify";
import { money, date, r2 } from "@/lib/format";
import { putFile } from "@/lib/storage";
import type { FormState } from "@/components/ui";

type Staff = SessionUser & { organizationId: string };

const paymentSchema = z.object({
  tenantId: z.string().min(1, "اختر المستأجر"),
  contractId: z.string().optional().nullable(),
  paidAt: z.coerce.date({ message: "أدخل تاريخ الدفع" }),
  amount: z.coerce.number().positive("أدخل مبلغ الدفعة").transform(r2),
  method: z.enum(["BANK_TRANSFER", "CARD", "CASH", "CHEQUE", "OTHER"], { message: "طريقة الدفع غير صالحة" }),
  reference: z.string().max(120).optional().nullable(),
  bank: z.string().max(120).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

/** Reads alloc_<installmentId>=amount pairs from the form. */
function parseAllocations(fd: FormData) {
  const rows: { installmentId: string; amount: number }[] = [];
  fd.forEach((v, k) => {
    if (!k.startsWith("alloc_")) return;
    const amount = Math.round(Number(v) * 100) / 100;
    if (amount > 0) rows.push({ installmentId: k.slice(6), amount });
  });
  return rows;
}

/** Thrown inside a transaction to abort it with a user-facing message (rolls back, no amount recorded). */
class AllocationError extends Error {}

type Client = Prisma.TransactionClient | typeof db;

/**
 * Row-locks rows for the rest of the transaction: the UPDATE takes the row lock, so a concurrent transaction on the same
 * installments / سند waits, then re-reads committed allocations (Postgres READ COMMITTED; SQLite has a single writer).
 * Two receipts saved at the same moment can therefore never both pass validation against the same remaining balance.
 */
async function lockRows(tx: Prisma.TransactionClient, installmentIds: string[], paymentId?: string) {
  if (paymentId) await tx.payment.updateMany({ where: { id: paymentId }, data: { updatedAt: new Date() } });
  for (const id of [...new Set(installmentIds)].sort()) await tx.installment.updateMany({ where: { id }, data: { updatedAt: new Date() } });
}

/**
 * Validates allocations against the tenant's installments (org + scope + remaining).
 * `remaining` is computed from the installment's live allocations (excluding reversed/returned payments) so a stale
 * `paidAmount` can never let an installment be over-allocated. Call it with the transaction client to make it authoritative.
 */
async function validateAllocations(client: Client, user: Staff, tenantId: string, rows: { installmentId: string; amount: number }[], available: number) {
  if (!rows.length) return { ok: true as const, installments: [] };
  const sum = rows.reduce((s, r) => s + r.amount, 0);
  if (sum > available + 0.01) return { ok: false as const, error: `المبلغ المخصص يتجاوز المتبقي على الدفعة. مجموع التخصيص ${money(sum)} والمتاح ${money(available)} ر.س.` };
  const installments = await client.installment.findMany({
    where: { id: { in: rows.map((r) => r.installmentId) }, organizationId: user.organizationId, tenantId, ...contractScope(user) },
    select: {
      id: true,
      seq: true,
      amount: true,
      paidAmount: true,
      openingPaid: true,
      status: true,
      contractId: true,
      collectionCase: { select: { id: true } },
      allocations: { select: { amount: true, payment: { select: { status: true } } } },
    },
  });
  if (installments.length !== rows.length) return { ok: false as const, error: "أحد الأقساط المختارة لا يخص هذا المستأجر." };
  for (const r of rows) {
    const inst = installments.find((i) => i.id === r.installmentId)!;
    if (inst.status === "WAIVED") return { ok: false as const, error: `القسط ${inst.seq} معفى ولا يمكن التخصيص عليه.` };
    const paid = inst.allocations.filter((a) => a.payment.status !== "REVERSED" && a.payment.status !== "RETURNED").reduce((s, a) => s + a.amount, 0);
    const remaining = r2(inst.amount - Math.max(inst.openingPaid + paid, inst.paidAmount));
    if (r.amount > remaining + 0.01) return { ok: false as const, error: `المبلغ المخصص للقسط ${inst.seq} (${money(r.amount)}) يتجاوز المتبقي (${money(remaining)}).` };
  }
  return { ok: true as const, installments };
}

async function logPaymentOnCases(user: Staff, caseIds: string[], note: string) {
  if (!caseIds.length) return;
  await db.collectionAction.createMany({ data: caseIds.map((caseId) => ({ caseId, type: "PAYMENT", outcome: "PAID", note, byUserId: user.id })) });
  await db.collectionCase.updateMany({ where: { id: { in: caseIds } }, data: { lastActionAt: new Date() } });
}

export async function createPayment(_prev: FormState, fd: FormData): Promise<FormState> {
  try {
    const user = await requireStaff();
    assertCan(user, "payments.manage");
    const parsed = paymentSchema.safeParse({
      tenantId: fd.get("tenantId"),
      contractId: fd.get("contractId") || null,
      paidAt: fd.get("paidAt") || undefined,
      amount: fd.get("amount"),
      method: fd.get("method"),
      reference: String(fd.get("reference") ?? "").trim() || null,
      bank: String(fd.get("bank") ?? "").trim() || null,
      notes: String(fd.get("notes") ?? "").trim() || null,
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;
    if (d.paidAt > new Date(Date.now() + 86400000)) return { error: "تاريخ الدفع لا يمكن أن يكون في المستقبل." };

    const tenant = await db.tenant.findFirst({ where: { id: d.tenantId, organizationId: user.organizationId }, select: { id: true, name: true, phone: true, email: true } });
    if (!tenant) return { error: "المستأجر غير موجود." };
    const rows = parseAllocations(fd);
    // Fast pre-check (before the upload) — the authoritative check runs again inside the transaction below.
    const pre = await validateAllocations(db, user, tenant.id, rows, d.amount);
    if (!pre.ok) return { error: pre.error };

    if (d.contractId) {
      const c = await db.contract.findFirst({ where: { id: d.contractId, organizationId: user.organizationId, tenantId: tenant.id }, select: { id: true } });
      if (!c) return { error: "العقد لا يخص هذا المستأجر." };
    }

    // Optional receipt / transfer proof → private storage, stored as Payment.attachmentUrl.
    const attachmentFile = fd.get("attachment");
    let attachment: { url: string; name: string; size: number } | null = null;
    if (attachmentFile instanceof File && attachmentFile.size > 0) {
      try {
        const stored = await putFile({ organizationId: user.organizationId, entity: "PAYMENT", file: attachmentFile, uploadedById: user.id });
        attachment = { url: stored.url, name: stored.name, size: stored.sizeBytes };
      } catch (e) {
        return { error: `${userMessage(e, "تعذر رفع المرفق.")} لم يتم تسجيل أي مبلغ.` };
      }
    }

    // The سند + its allocations are written atomically; validation re-reads the installments inside the same transaction.
    let p: { id: string; code: string; contractId: string | null };
    let caseIds: string[] = [];
    try {
      const code = await nextCode(user.organizationId, "payment");
      p = await db.$transaction(async (tx) => {
        await lockRows(tx, rows.map((r) => r.installmentId));
        const v = await validateAllocations(tx, user, tenant.id, rows, d.amount);
        if (!v.ok) throw new AllocationError(v.error);
        caseIds = v.installments.map((i) => i.collectionCase?.id).filter((x): x is string => Boolean(x));
        const contractId = d.contractId ?? (v.installments.length ? v.installments[0].contractId : null);
        const created = await tx.payment.create({
          data: {
            organizationId: user.organizationId,
            code,
            tenantId: tenant.id,
            contractId,
            paidAt: d.paidAt,
            amount: d.amount,
            method: d.method,
            reference: d.reference,
            bank: d.bank,
            notes: d.notes,
            attachmentUrl: attachment?.url ?? null,
            status: "RECORDED",
            reconciliationStatus: "UNMATCHED",
            recordedById: user.id,
          },
          select: { id: true, code: true, contractId: true },
        });
        if (rows.length) await tx.paymentAllocation.createMany({ data: rows.map((r) => ({ paymentId: created.id, installmentId: r.installmentId, amount: r.amount })) });
        return created;
      });
    } catch (e) {
      if (e instanceof AllocationError) return { error: e.message };
      console.error("createPayment failed", e);
      return { error: "تعذر حفظ سند القبض حاليًا. لم يتم تسجيل أي مبلغ." };
    }

    // Committed from here on: nothing below may turn the saved سند into a "nothing recorded" error.
    try {
      await refreshInstallments(user.organizationId, rows.map((r) => r.installmentId));
    } catch (e) {
      console.error("createPayment: refreshInstallments failed", p.code, e);
    }
    try {
      await audit({ user, action: "PAYMENT", entityType: "PAYMENT", entityId: p.id, entityLabel: p.code, newValue: { ...d, allocations: rows, attachment: attachment ? { file: attachment.name, size: attachment.size } : null } });
      await logPaymentOnCases(user, caseIds, `تم تسجيل الدفعة ${p.code} بقيمة ${money(d.amount)} ر.س (${date(d.paidAt)}).`);
    } catch (e) {
      console.error("createPayment: audit failed", p.code, e);
    }
    try {
      const portal = await db.user.findFirst({ where: { tenantId: tenant.id, status: "ACTIVE" }, select: { id: true } });
      if (portal) {
        await notify({
          organizationId: user.organizationId,
          userIds: [portal.id],
          title: "تم استلام دفعتكم",
          body: `تم تسجيل دفعة بقيمة ${money(d.amount)} ر.س بتاريخ ${date(d.paidAt)}. شكرًا لكم.`,
          severity: "SUCCESS",
          entityType: "PAYMENT",
          entityId: p.id,
          href: "/tenant/payments",
        });
      }
      // Template-driven confirmation (SMS/WhatsApp/Email) per NotificationRule PAYMENT_RECEIVED → TENANT. Never throws.
      const unit = p.contractId ? await db.contract.findUnique({ where: { id: p.contractId }, select: { code: true, unit: { select: { number: true } } } }) : null;
      await sendTenantEvent(user.organizationId, "PAYMENT_RECEIVED", tenant, {
        tenant_name: tenant.name,
        amount: money(d.amount),
        unit_number: unit?.unit.number ?? "",
        contract_code: unit?.code ?? "",
        payment_code: p.code,
        paid_at: date(d.paidAt),
      }, { entityType: "PAYMENT", entityId: p.id, dedupeDays: 1 });
    } catch (e) {
      console.error("createPayment: notify failed", p.code, e);
    }
    revalidatePath("/payments");
    revalidatePath("/collections");
    redirect(`/payments/${p.id}?toast=created`);
  } catch (e) {
    return actionFailure(e);
  }
}

/** Adds allocations to an existing payment's unallocated balance. */
export async function allocatePayment(_prev: FormState, fd: FormData): Promise<FormState> {
  try {
    const user = await requireStaff();
    assertCan(user, "payments.manage");
    const id = String(fd.get("id") ?? "");
    const p = await db.payment.findFirst({ where: { id, organizationId: user.organizationId, ...contractScope(user) }, include: { allocations: true } });
    if (!p) return { error: "الدفعة غير موجودة." };
    if (["REVERSED", "RETURNED"].includes(p.status)) return { error: "لا يمكن تخصيص دفعة معكوسة أو مرتجعة." };
    if (p.status === "APPROVED" && !can(user, "payments.approve")) return { error: "الدفعة معتمدة — تعديل التخصيص يتطلب صلاحية الاعتماد (BR-003)." };
    const requested = parseAllocations(fd);
    if (!requested.length) return { error: "أدخل مبلغًا لقسط واحد على الأقل." };

    // Re-read the payment's allocations inside the transaction so a concurrent allocation can never push the total past the سند amount
    // (the DB also enforces one allocation row per payment/installment pair).
    let rows: { installmentId: string; amount: number }[] = [];
    let caseIds: string[] = [];
    try {
      await db.$transaction(async (tx) => {
        await lockRows(tx, requested.map((r) => r.installmentId), p.id);
        const fresh = await tx.payment.findUniqueOrThrow({ where: { id: p.id }, select: { amount: true, contractId: true, allocations: { select: { installmentId: true, amount: true } } } });
        const allocated = fresh.allocations.reduce((s, a) => s + a.amount, 0);
        const available = r2(fresh.amount - allocated);
        rows = requested.filter((r) => !fresh.allocations.some((a) => a.installmentId === r.installmentId));
        if (!rows.length) throw new AllocationError("الأقساط المختارة مخصص لها مبلغ من هذه الدفعة بالفعل.");
        if (available <= 0) throw new AllocationError("المبلغ المخصص يتجاوز المتبقي على الدفعة.");
        const v = await validateAllocations(tx, user, p.tenantId, rows, available);
        if (!v.ok) throw new AllocationError(v.error);
        caseIds = v.installments.map((i) => i.collectionCase?.id).filter((x): x is string => Boolean(x));
        await tx.paymentAllocation.createMany({ data: rows.map((r) => ({ paymentId: p.id, installmentId: r.installmentId, amount: r.amount })) });
        if (!fresh.contractId && v.installments.length) await tx.payment.update({ where: { id: p.id }, data: { contractId: v.installments[0].contractId } });
      });
    } catch (e) {
      if (e instanceof AllocationError) return { error: e.message };
      console.error("allocatePayment failed", p.code, e);
      return { error: "تعذر حفظ التخصيص حاليًا. لم يتم تغيير أي مبلغ." };
    }

    try {
      await refreshInstallments(user.organizationId, rows.map((r) => r.installmentId));
    } catch (e) {
      console.error("allocatePayment: refreshInstallments failed", p.code, e);
    }
    try {
      await audit({ user, action: "UPDATE", entityType: "PAYMENT", entityId: p.id, entityLabel: p.code, oldValue: { allocations: p.allocations.map((a) => ({ installmentId: a.installmentId, amount: a.amount })) }, newValue: { added: rows } });
      await logPaymentOnCases(user, caseIds, `تم تخصيص ${money(rows.reduce((s, r) => s + r.amount, 0))} ر.س من الدفعة ${p.code}.`);
    } catch (e) {
      console.error("allocatePayment: audit failed", p.code, e);
    }
    revalidatePath(`/payments/${p.id}`);
    revalidatePath("/collections");
    return { success: "تم تخصيص المبلغ." };
  } catch (e) {
    return actionFailure(e);
  }
}

export async function approvePayment(fd: FormData) {
  try {
    const user = await requireStaff();
    assertCan(user, "payments.approve");
    const id = String(fd.get("id") ?? "");
    const p = await db.payment.findFirst({ where: { id, organizationId: user.organizationId, ...contractScope(user) } });
    if (!p) return;
    if (p.status !== "RECORDED") throw new Error("يمكن اعتماد سندات القبض المسجلة فقط.");
    const moved = await db.payment.updateMany({ where: { id, status: "RECORDED" }, data: { status: "APPROVED" } });
    if (moved.count !== 1) throw new Error("تغيرت حالة السند قبل الاعتماد. حدّث الصفحة.");
    await audit({ user, action: "APPROVE", entityType: "PAYMENT", entityId: id, entityLabel: p.code, oldValue: { status: p.status }, newValue: { status: "APPROVED" } });
    revalidatePath(`/payments/${id}`);
    revalidatePath("/payments");
    redirect(`/payments/${id}?toast=approved`);
  } catch (e) {
    await failFromError(e);
  }
}

/** BR-008: payments are never deleted — they are reversed with a reason. */
export async function reversePayment(fd: FormData) {
  try {
    const user = await requireStaff();
    assertCan(user, "payments.approve");
    const id = String(fd.get("id") ?? "");
    const reason = String(fd.get("reason") ?? "").trim();
    if (!reason) throw new Error("سبب العكس مطلوب.");
    const p = await db.payment.findFirst({ where: { id, organizationId: user.organizationId, ...contractScope(user) }, include: { allocations: { include: { installment: { select: { collectionCase: { select: { id: true } } } } } }, bankTxn: true } });
    if (!p) return;
    if (["REVERSED", "RETURNED"].includes(p.status)) throw new Error("السند معكوس بالفعل.");
    const stamp = `[عكس ${date(new Date())} — ${user.name}] ${reason}`;
    await db.$transaction(async (tx) => {
      const moved = await tx.payment.updateMany({ where: { id, status: { notIn: ["REVERSED", "RETURNED"] } }, data: { status: "REVERSED", reconciliationStatus: p.bankTxn ? "NEEDS_REVIEW" : p.reconciliationStatus, notes: p.notes ? `${p.notes}\n${stamp}` : stamp } });
      if (moved.count !== 1) throw new Error("السند معكوس بالفعل.");
      if (p.bankTxn) await tx.bankTransaction.update({ where: { id: p.bankTxn.id }, data: { status: "NEEDS_REVIEW" } });
    });
    await refreshAfterReversal(user, p.code, p.allocations.map((a) => a.installmentId));
    await audit({ user, action: "STATUS_CHANGE", entityType: "PAYMENT", entityId: id, entityLabel: p.code, oldValue: { status: p.status }, newValue: { status: "REVERSED", reason } });
    const caseIds = p.allocations.map((a) => a.installment.collectionCase?.id).filter((x): x is string => Boolean(x));
    if (caseIds.length) {
      await db.collectionAction.createMany({ data: caseIds.map((caseId) => ({ caseId, type: "SYSTEM", note: `تم عكس السند ${p.code} (${money(p.amount)} ر.س): ${reason}`, byUserId: user.id })) });
    }
    revalidatePath(`/payments/${id}`);
    revalidatePath("/payments");
    revalidatePath("/collections");
    redirect(`/payments/${id}?toast=reversed`);
  } catch (e) {
    await failFromError(e);
  }
}

export async function markReturnedCheque(fd: FormData) {
  try {
    const user = await requireStaff();
    assertCan(user, "payments.approve");
    const id = String(fd.get("id") ?? "");
    const reason = String(fd.get("reason") ?? "").trim() || "شيك مرتجع من البنك";
    const p = await db.payment.findFirst({
      where: { id, organizationId: user.organizationId, ...contractScope(user) },
      include: { tenant: { select: { name: true } }, bankTxn: true, allocations: { include: { installment: { select: { collectionCase: { select: { id: true } } } } } } },
    });
    if (!p) return;
    if (p.method !== "CHEQUE") throw new Error("هذا الإجراء مخصص لدفعات الشيكات فقط.");
    if (["REVERSED", "RETURNED"].includes(p.status)) throw new Error("الدفعة معكوسة أو مرتجعة بالفعل.");
    const stamp = `[شيك مرتجع ${date(new Date())} — ${user.name}] ${reason}`;
    await db.$transaction(async (tx) => {
      const moved = await tx.payment.updateMany({ where: { id, status: { notIn: ["REVERSED", "RETURNED"] } }, data: { status: "RETURNED", reconciliationStatus: p.bankTxn ? "NEEDS_REVIEW" : p.reconciliationStatus, notes: p.notes ? `${p.notes}\n${stamp}` : stamp } });
      if (moved.count !== 1) throw new Error("السند معكوس أو مرتجع بالفعل.");
      // The bank line no longer matches a standing receipt: back to review, like a reversal.
      if (p.bankTxn) await tx.bankTransaction.update({ where: { id: p.bankTxn.id }, data: { status: "NEEDS_REVIEW" } });
    });
    await refreshAfterReversal(user, p.code, p.allocations.map((a) => a.installmentId));
    await audit({ user, action: "STATUS_CHANGE", entityType: "PAYMENT", entityId: id, entityLabel: p.code, oldValue: { status: p.status }, newValue: { status: "RETURNED", reason } });
    const caseIds = p.allocations.map((a) => a.installment.collectionCase?.id).filter((x): x is string => Boolean(x));
    if (caseIds.length) {
      await db.collectionAction.createMany({ data: caseIds.map((caseId) => ({ caseId, type: "SYSTEM", outcome: "REFUSED", note: `شيك مرتجع — الدفعة ${p.code} (${money(p.amount)} ر.س): ${reason}`, byUserId: user.id })) });
    }
    await notify({
      organizationId: user.organizationId,
      owners: true,
      audience: ["collections.manage"],
      title: `شيك مرتجع — ${p.tenant.name}`,
      body: `الدفعة ${p.code} بقيمة ${money(p.amount)} ر.س`,
      severity: "DANGER",
      entityType: "PAYMENT",
      entityId: id,
      href: `/payments/${id}`,
    });
    revalidatePath(`/payments/${id}`);
    revalidatePath("/payments");
    revalidatePath("/collections");
    redirect(`/payments/${id}?toast=${encodeURIComponent("تم تسجيل الشيك كمرتجع وأُعيد فتح الأقساط المرتبطة.")}`);
  } catch (e) {
    await failFromError(e);
  }
}

/**
 * After a reversal / returned cheque the installments must re-open. The status change is already committed, so a failed
 * refresh is retried once and then escalated to the office manager (installments would otherwise stay "paid").
 */
async function refreshAfterReversal(user: Staff, code: string, installmentIds: string[]) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await refreshInstallments(user.organizationId, installmentIds);
      return;
    } catch (e) {
      console.error("refreshAfterReversal failed", code, attempt, e);
    }
  }
  await notify({
    organizationId: user.organizationId,
    owners: true,
    title: `تعذر تحديث الأقساط بعد عكس السند ${code}`,
    body: "افتح السند وأعد المحاولة، أو تواصل مع فريق دارك.",
    severity: "DANGER",
    entityType: "PAYMENT",
  }).catch(() => {});
}
