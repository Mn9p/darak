"use server";


import { failFromError } from "@/lib/action-error";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { assertCan } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { addDays } from "@/lib/format";

const MATCH_WINDOW_DAYS = 5;

/** Finds an unmatched payment with the same amount within ±5 days of the transaction date. */
async function suggestPayment(organizationId: string, amount: number, date: Date) {
  return db.payment.findFirst({
    where: {
      organizationId,
      amount: { gte: amount - 0.009, lte: amount + 0.009 },
      paidAt: { gte: addDays(date, -MATCH_WINDOW_DAYS), lte: addDays(date, MATCH_WINDOW_DAYS) },
      status: { in: ["RECORDED", "APPROVED"] },
      reconciliationStatus: { not: "MATCHED" },
      bankTxn: null,
    },
    orderBy: { paidAt: "desc" },
    select: { id: true },
  });
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if ((ch === "," || ch === ";" || ch === "\t") && !quoted) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function parseDate(s: string): Date | null {
  const t = s.trim();
  let m = t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = t.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Pastes a CSV (date,amount,reference,description) and creates bank transactions with duplicate detection + auto-suggestions. */
export async function importBankStatement(fd: FormData) {
  try {
    const user = await requireStaff();
    assertCan(user, "payments.approve");
    const org = user.organizationId;
    const csv = String(fd.get("csv") ?? "");
    const bank = String(fd.get("bank") ?? "").trim() || null;
    const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) throw new Error("الصق محتوى كشف الحساب أولًا.");

    let created = 0;
    let duplicates = 0;
    let suggested = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const [idx, line] of lines.entries()) {
      const cols = parseCsvLine(line);
      if (cols.length < 2) {
        skipped++;
        continue;
      }
      const d = parseDate(cols[0]);
      const amount = Number(String(cols[1]).replace(/[^\d.-]/g, ""));
      if (!d || !Number.isFinite(amount) || amount === 0) {
        // Header row or malformed line.
        if (idx === 0) continue;
        skipped++;
        errors.push(`سطر ${idx + 1}: تاريخ أو مبلغ غير صالح`);
        continue;
      }
      const reference = cols[2] || null;
      const description = cols.slice(3).join(", ") || null;

      const dup = reference
        ? await db.bankTransaction.findFirst({ where: { organizationId: org, reference, amount: { gte: amount - 0.009, lte: amount + 0.009 } }, select: { id: true } })
        : await db.bankTransaction.findFirst({ where: { organizationId: org, reference: null, date: d, amount: { gte: amount - 0.009, lte: amount + 0.009 }, description }, select: { id: true } });

      let status = "UNMATCHED";
      if (dup) {
        status = "DUPLICATE";
        duplicates++;
      } else if (amount > 0) {
        const s = await suggestPayment(org, amount, d);
        if (s) {
          status = "SUGGESTED";
          suggested++;
        }
      } else {
        status = "NEEDS_REVIEW"; // outgoing / negative amounts are not tenant receipts
      }
      await db.bankTransaction.create({ data: { organizationId: org, date: d, amount, reference, description, bank, status } });
      created++;
    }

    await audit({
      user,
      action: "CREATE",
      entityType: "BANK_TRANSACTION",
      entityLabel: `استيراد كشف حساب${bank ? ` — ${bank}` : ""}`,
      newValue: { lines: lines.length, created, duplicates, suggested, skipped, errors: errors.slice(0, 20) },
    });
    revalidatePath("/reconciliation");
    const qs = new URLSearchParams({ tab: suggested ? "SUGGESTED" : "UNMATCHED", imported: String(created), dup: String(duplicates), sug: String(suggested), skipped: String(skipped) });
    redirect(`/reconciliation?${qs.toString()}`);
  } catch (e) {
    await failFromError(e);
  }
}

async function getTxn(orgId: string, id: string) {
  return db.bankTransaction.findFirst({ where: { id, organizationId: orgId }, include: { payment: { select: { id: true, code: true } } } });
}

function back(fd: FormData, fallback: string) {
  const b = String(fd.get("back") ?? "");
  return b.startsWith("/reconciliation") ? b : fallback;
}

export async function confirmMatch(fd: FormData) {
  try {
    const user = await requireStaff();
    assertCan(user, "payments.approve");
    const org = user.organizationId;
    const id = String(fd.get("id") ?? "");
    const paymentId = String(fd.get("paymentId") ?? "");
    const txn = await getTxn(org, id);
    if (!txn) throw new Error("الحركة البنكية غير موجودة.");
    if (!paymentId) throw new Error("اختر الدفعة المطابقة.");
    const p = await db.payment.findFirst({ where: { id: paymentId, organizationId: org, status: { in: ["RECORDED", "APPROVED"] } }, include: { bankTxn: { select: { id: true } } } });
    if (!p) throw new Error("الدفعة غير موجودة أو غير سارية.");
    if (p.bankTxn && p.bankTxn.id !== txn.id) throw new Error("هذه الدفعة مرتبطة بحركة بنكية أخرى.");
    if (Math.abs(p.amount - txn.amount) > 0.009) throw new Error("مبلغ الدفعة لا يساوي مبلغ الحركة البنكية.");

    // Re-matching an already MATCHED transaction to a different سند: release the previous one in the same transaction so it is not left "MATCHED" with no bank line.
    const previous = txn.status === "MATCHED" && txn.paymentId && txn.paymentId !== p.id ? txn.payment : null;
    await db.$transaction([
      ...(previous ? [db.payment.update({ where: { id: previous.id }, data: { reconciliationStatus: "UNMATCHED" } })] : []),
      db.bankTransaction.update({ where: { id: txn.id }, data: { status: "MATCHED", paymentId: p.id } }),
      db.payment.update({ where: { id: p.id }, data: { reconciliationStatus: "MATCHED" } }),
    ]);
    await audit({ user, action: "APPROVE", entityType: "BANK_TRANSACTION", entityId: txn.id, entityLabel: txn.reference ?? txn.id, oldValue: { status: txn.status, paymentId: txn.paymentId }, newValue: { status: "MATCHED", paymentId: p.id, paymentCode: p.code, releasedPaymentId: previous?.id ?? null } });
    if (previous) {
      await audit({ user, action: "UPDATE", entityType: "PAYMENT", entityId: previous.id, entityLabel: previous.code, oldValue: { reconciliationStatus: "MATCHED", bankTransactionId: txn.id }, newValue: { reconciliationStatus: "UNMATCHED", bankTransactionId: null, reason: "أُعيدت مطابقة الحركة البنكية لدفعة أخرى" } });
    }
    await audit({ user, action: "UPDATE", entityType: "PAYMENT", entityId: p.id, entityLabel: p.code, oldValue: { reconciliationStatus: p.reconciliationStatus }, newValue: { reconciliationStatus: "MATCHED", bankTransactionId: txn.id } });
    revalidatePath("/reconciliation");
    revalidatePath(`/payments/${p.id}`);
    if (previous) revalidatePath(`/payments/${previous.id}`);
    redirect(back(fd, "/reconciliation?tab=MATCHED"));
  } catch (e) {
    await failFromError(e);
  }
}

export async function unmatch(fd: FormData) {
  try {
    const user = await requireStaff();
    assertCan(user, "payments.approve");
    const org = user.organizationId;
    const id = String(fd.get("id") ?? "");
    const txn = await getTxn(org, id);
    if (!txn) throw new Error("الحركة البنكية غير موجودة.");
    await db.$transaction([
      db.bankTransaction.update({ where: { id: txn.id }, data: { status: "UNMATCHED", paymentId: null } }),
      ...(txn.paymentId ? [db.payment.update({ where: { id: txn.paymentId }, data: { reconciliationStatus: "UNMATCHED" } })] : []),
    ]);
    await audit({ user, action: "UPDATE", entityType: "BANK_TRANSACTION", entityId: txn.id, entityLabel: txn.reference ?? txn.id, oldValue: { status: txn.status, paymentId: txn.paymentId }, newValue: { status: "UNMATCHED", paymentId: null } });
    revalidatePath("/reconciliation");
    if (txn.paymentId) revalidatePath(`/payments/${txn.paymentId}`);
    redirect(back(fd, "/reconciliation?tab=UNMATCHED"));
  } catch (e) {
    await failFromError(e);
  }
}

/** Flags a transaction for manual review (or clears the flag back to UNMATCHED when already under review). */
export async function markReviewed(fd: FormData) {
  try {
    const user = await requireStaff();
    assertCan(user, "payments.approve");
    const org = user.organizationId;
    const id = String(fd.get("id") ?? "");
    const txn = await getTxn(org, id);
    if (!txn) throw new Error("الحركة البنكية غير موجودة.");
    if (txn.status === "MATCHED") throw new Error("ألغِ المطابقة أولًا.");
    const next = txn.status === "NEEDS_REVIEW" ? "UNMATCHED" : "NEEDS_REVIEW";
    await db.bankTransaction.update({ where: { id: txn.id }, data: { status: next, paymentId: null } });
    await audit({ user, action: "STATUS_CHANGE", entityType: "BANK_TRANSACTION", entityId: txn.id, entityLabel: txn.reference ?? txn.id, oldValue: { status: txn.status }, newValue: { status: next } });
    revalidatePath("/reconciliation");
    redirect(back(fd, `/reconciliation?tab=${next}`));
  } catch (e) {
    await failFromError(e);
  }
}

export async function markDuplicate(fd: FormData) {
  try {
    const user = await requireStaff();
    assertCan(user, "payments.approve");
    const org = user.organizationId;
    const id = String(fd.get("id") ?? "");
    const txn = await getTxn(org, id);
    if (!txn) throw new Error("الحركة البنكية غير موجودة.");
    if (txn.status === "MATCHED") throw new Error("ألغِ المطابقة أولًا.");
    await db.bankTransaction.update({ where: { id: txn.id }, data: { status: "DUPLICATE", paymentId: null } });
    await audit({ user, action: "STATUS_CHANGE", entityType: "BANK_TRANSACTION", entityId: txn.id, entityLabel: txn.reference ?? txn.id, oldValue: { status: txn.status }, newValue: { status: "DUPLICATE" } });
    revalidatePath("/reconciliation");
    redirect(back(fd, "/reconciliation?tab=DUPLICATE"));
  } catch (e) {
    await failFromError(e);
  }
}
