"use server";


import { actionFailure, failFromError } from "@/lib/action-error";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { assertCan } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { nextCode } from "@/lib/codes";
import { computeOwnerStatement, freezeStatement, unfreezeStatement } from "@/lib/engine";
import { notify } from "@/lib/notify";
import { sendMessage } from "@/lib/channels";
import { money, endOfMonth, monthLabel, ksaDate } from "@/lib/format";
import type { FormState } from "@/components/ui";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** "2026-09" → [periodStart, periodEnd] */
function parsePeriod(period: string | null | undefined): [Date, Date] | null {
  const m = /^(\d{4})-(\d{2})$/.exec(period ?? "");
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  if (mo < 0 || mo > 11) return null;
  const start = ksaDate(y, mo, 1);
  return [start, endOfMonth(start)];
}

async function loadStatement(id: string, org: string) {
  return db.ownerStatement.findFirst({ where: { id, organizationId: org }, include: { owner: { select: { id: true, name: true, email: true } } } });
}

export async function generateStatement(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await requireStaff();
    assertCan(user, "statements.manage");
    const org = user.organizationId;
    const ownerId = String(formData.get("ownerId") ?? "");
    const propertyId = String(formData.get("propertyId") ?? "") || null;
    const period = parsePeriod(String(formData.get("period") ?? ""));
    if (!ownerId) return { error: "اختر المالك أولًا." };
    if (!period) return { error: "حدد شهر الفترة." };
    const [periodStart, periodEnd] = period;

    const owner = await db.owner.findFirst({ where: { id: ownerId, organizationId: org }, select: { id: true, name: true } });
    if (!owner) return { error: "المالك غير موجود." };
    if (propertyId) {
      const p = await db.property.findFirst({ where: { id: propertyId, organizationId: org }, select: { id: true } });
      if (!p) return { error: "العقار غير موجود." };
    }

    const existing = await db.ownerStatement.findFirst({ where: { organizationId: org, ownerId, propertyId, periodStart, periodEnd } });
    if (existing && existing.status !== "DRAFT") {
      return { error: `يوجد كشف حساب ${existing.code} لنفس المالك والفترة وقد ثُبّت. افتحه من القائمة بدلًا من إنشاء نسخة جديدة.` };
    }
    // Another statement (any status) that already covers this property for the period: an all-properties statement covers every
    // per-property one, and an all-properties request is covered by any per-property statement. (The ledger would pay nothing
    // twice anyway; refusing keeps one statement per owner, property and month.)
    const overlapping = await db.ownerStatement.findFirst({
      where: {
        organizationId: org,
        ownerId,
        periodStart,
        periodEnd,
        ...(existing ? { id: { not: existing.id } } : {}),
        ...(propertyId ? { OR: [{ propertyId: null }, { propertyId }] } : {}),
      },
      select: { code: true },
    });
    if (overlapping) return { error: `يوجد كشف حساب آخر لهذه الفترة يشمل هذا العقار (${overlapping.code}). افتحه من القائمة بدلًا من إنشاء كشف جديد.` };

    let id: string;
    try {
      // Ledger mode: period lines plus late entries and corrections of earlier locked statements.
      const figures = await computeOwnerStatement(org, ownerId, periodStart, periodEnd, propertyId, { carry: true, excludeStatementId: existing?.id });
      if (figures.properties.length === 0) return { error: "لا توجد ملكية لهذا المالك خلال الفترة المحددة." };
      // Statement figures may only rest on approved سندات قبض: any recorded-but-unapproved payment in the period must be approved or excluded first.
      const unapproved = await db.paymentAllocation.count({
        where: {
          payment: { organizationId: org, paidAt: { gte: periodStart, lte: periodEnd }, status: { notIn: ["APPROVED", "REVERSED", "RETURNED"] } },
          installment: { contract: { propertyId: { in: figures.properties.map((p) => p.id) } } },
        },
      });
      if (unapproved > 0) return { error: `يوجد ${unapproved} ${unapproved === 1 ? "سند قبض غير معتمد" : "سندات قبض غير معتمدة"} في هذه الفترة. اعتمدها من «سندات القبض» (تصفية: مسجلة) ثم أنشئ كشف الحساب.` };
      if (existing) {
        const netDue = r2(figures.collectedRent - figures.managementFees - figures.expenses - existing.otherDeductions);
        await db.ownerStatement.update({
          where: { id: existing.id },
          data: { collectedRent: figures.collectedRent, managementFees: figures.managementFees, expenses: figures.expenses, netDue },
        });
        id = existing.id;
        await audit({
          user,
          action: "UPDATE",
          entityType: "STATEMENT",
          entityId: existing.id,
          entityLabel: existing.code,
          oldValue: { collectedRent: existing.collectedRent, managementFees: existing.managementFees, expenses: existing.expenses, netDue: existing.netDue },
          newValue: { collectedRent: figures.collectedRent, managementFees: figures.managementFees, expenses: figures.expenses, netDue, regenerated: true },
        });
      } else {
        const code = await nextCode(org, "ownerStatement");
        const netDue = r2(figures.collectedRent - figures.managementFees - figures.expenses);
        const s = await db.ownerStatement.create({
          data: {
            organizationId: org,
            code,
            ownerId,
            propertyId,
            periodStart,
            periodEnd,
            collectedRent: figures.collectedRent,
            managementFees: figures.managementFees,
            expenses: figures.expenses,
            otherDeductions: 0,
            netDue,
            status: "DRAFT",
          },
        });
        id = s.id;
        await audit({ user, action: "CREATE", entityType: "STATEMENT", entityId: s.id, entityLabel: s.code, newValue: { ownerId, propertyId, period: monthLabel(periodStart), collectedRent: figures.collectedRent, managementFees: figures.managementFees, expenses: figures.expenses, netDue } });
      }
    } catch (err) {
      console.error(err);
      return { error: "تعذر إنشاء كشف الحساب حاليًا. لم يتم حفظ أي بيانات." };
    }
    revalidatePath("/statements");
    redirect(`/statements/${id}?toast=${existing ? "updated" : "created"}`);
  } catch (e) {
    return actionFailure(e);
  }
}

export async function updateDeductions(formData: FormData) {
  try {
    const user = await requireStaff();
    assertCan(user, "statements.manage");
    const org = user.organizationId;
    const id = String(formData.get("id"));
    const otherDeductions = Math.max(0, Number(formData.get("otherDeductions") ?? 0) || 0);
    const notes = String(formData.get("notes") ?? "").trim() || null;
    const s = await loadStatement(id, org);
    if (!s) return;
    if (s.status !== "DRAFT") throw new Error("لا يمكن تعديل الخصومات إلا وكشف الحساب مسودة.");
    const netDue = r2(s.collectedRent - s.managementFees - s.expenses - otherDeductions);
    await db.ownerStatement.update({ where: { id }, data: { otherDeductions, netDue, notes } });
    await audit({ user, action: "UPDATE", entityType: "STATEMENT", entityId: id, entityLabel: s.code, oldValue: { otherDeductions: s.otherDeductions, netDue: s.netDue, notes: s.notes }, newValue: { otherDeductions, netDue, notes } });
    revalidatePath(`/statements/${id}`);
    revalidatePath("/statements");
  } catch (e) {
    await failFromError(e);
  }
}

async function transition(id: string, from: string[], to: string, extra?: { paidAt?: Date; reference?: string }) {
  const user = await requireStaff();
  assertCan(user, "statements.manage");
  const org = user.organizationId;
  const s = await loadStatement(id, org);
  if (!s) return null;
  if (!from.includes(s.status)) throw new Error("لا يمكن تنفيذ هذا الانتقال من الحالة الحالية لكشف الحساب.");
  if (to === "APPROVED" && !["OFFICE_MANAGER", "ACCOUNTANT", "SUPER_ADMIN"].includes(user.role)) {
    throw new Error("اعتماد كشف الحساب متاح لمدير المكتب أو المحاسب فقط.");
  }
  if (s.status === "DRAFT" && to !== "DRAFT") {
    // Leaving DRAFT locks the statement: freeze its lines and totals as computed now (ledger).
    try {
      await freezeStatement(id);
    } catch (e) {
      console.error(e);
      throw new Error("تعذر تثبيت كشف الحساب لأن كشفًا آخر للمالك يُثبَّت في اللحظة نفسها. حاول مجددًا.");
    }
  }
  if (to === "DRAFT") {
    // Back to draft releases its money for later statements — only while no later statement of the owner was locked on top of it.
    const mine = await db.ownerStatementLine.findFirst({ where: { statementId: id }, orderBy: { createdAt: "asc" }, select: { createdAt: true } });
    if (mine) {
      const later = await db.ownerStatementLine.findFirst({ where: { ownerId: s.ownerId, statementId: { not: id }, createdAt: { gt: mine.createdAt } }, select: { id: true } });
      if (later) throw new Error("لا يمكن إعادة كشف الحساب إلى مسودة بعد تثبيت كشف لاحق للمالك نفسه.");
    }
    await unfreezeStatement(id);
  }
  await db.ownerStatement.update({ where: { id }, data: { status: to, ...(extra?.paidAt ? { paidAt: extra.paidAt } : {}) } });
  const fresh = await loadStatement(id, org);
  await audit({
    user,
    action: to === "APPROVED" ? "APPROVE" : to === "PAID" ? "PAYMENT" : "STATUS_CHANGE",
    entityType: "STATEMENT",
    entityId: id,
    entityLabel: s.code,
    oldValue: { status: s.status },
    newValue: { status: to, ...(extra ?? {}) },
  });
  revalidatePath(`/statements/${id}`);
  revalidatePath("/statements");
  return { user, s: fresh ?? s };
}

export async function submitStatement(formData: FormData) {
  try {
    const id = String(formData.get("id"));
    const r = await transition(id, ["DRAFT"], "UNDER_REVIEW");
    if (!r) return;
    await notify({
      organizationId: r.user.organizationId,
      roles: ["OFFICE_MANAGER", "ACCOUNTANT"],
      title: `كشف الحساب ${r.s.code} بانتظار المراجعة — ${r.s.owner.name}`,
      body: `صافي المستحق ${money(r.s.netDue)} ر.س`,
      entityType: "STATEMENT",
      entityId: id,
      href: `/statements/${id}`,
    });
  } catch (e) {
    await failFromError(e);
  }
}

export async function approveStatement(formData: FormData) {
  try {
    const id = String(formData.get("id"));
    await transition(id, ["UNDER_REVIEW", "DRAFT"], "APPROVED");
  } catch (e) {
    await failFromError(e);
  }
}

export async function markStatementPaid(formData: FormData) {
  try {
    const id = String(formData.get("id"));
    const reference = String(formData.get("reference") ?? "").trim();
    const paidAtRaw = String(formData.get("paidAt") ?? "");
    const paidAt = paidAtRaw ? new Date(paidAtRaw) : new Date();
    if (Number.isNaN(paidAt.getTime())) throw new Error("تاريخ التحويل غير صالح.");
    if (paidAt > new Date(Date.now() + 86400000)) throw new Error("تاريخ التحويل لا يمكن أن يكون في المستقبل.");
    const r = await transition(id, ["APPROVED"], "PAID", { paidAt, reference });
    if (!r) return;
    const org = r.user.organizationId;
    // keep any existing notes and append the transfer reference
    if (reference) {
      const base = (r.s.notes ?? "").trim();
      await db.ownerStatement.update({ where: { id }, data: { notes: base ? `${base}\nمرجع التحويل: ${reference}` : `مرجع التحويل: ${reference}` } });
    }
    const portal = await db.user.findFirst({ where: { ownerId: r.s.ownerId, organizationId: org }, select: { id: true } });
    if (portal) {
      await notify({
        organizationId: org,
        userIds: [portal.id],
        title: `تم تحويل مستحقاتك — كشف الحساب ${r.s.code}`,
        body: `المبلغ ${money(r.s.netDue)} ر.س${reference ? ` · مرجع ${reference}` : ""}`,
        severity: "SUCCESS",
        entityType: "STATEMENT",
        entityId: id,
        href: "/owner/statements",
      });
    }
    // Email the owner a short summary with a link to the statement (simulated + logged when no email provider). Never throws.
    const email = r.s.owner.email?.trim();
    if (email) {
      const link = `${process.env.APP_URL ?? ""}/owner/statements/${id}`;
      const body = [
        `الأستاذ/ة ${r.s.owner.name}،`,
        `تم تحويل مستحقاتكم عن الفترة ${monthLabel(r.s.periodStart)} — كشف الحساب ${r.s.code}.`,
        `صافي المستحق: ${money(r.s.netDue)} ر.س${reference ? ` · مرجع التحويل: ${reference}` : ""}.`,
        `الإيجار المحصل: ${money(r.s.collectedRent)} ر.س · أتعاب الإدارة: ${money(r.s.managementFees)} ر.س · المصروفات: ${money(r.s.expenses + r.s.otherDeductions)} ر.س.`,
        `لعرض كشف الحساب وتحميله: ${link}`,
      ].join("\n");
      const result = await sendMessage({ organizationId: org, channel: "EMAIL", to: email, subject: `تم تحويل مستحقاتك — كشف الحساب ${r.s.code}`, body, entityType: "STATEMENT", entityId: id });
      await audit({
        user: r.user,
        action: "UPDATE",
        entityType: "STATEMENT",
        entityId: id,
        entityLabel: r.s.code,
        newValue: { ownerEmail: { to: email, ok: result.ok, simulated: result.simulated, provider: result.provider, providerMessageId: result.providerMessageId ?? null, error: result.error ?? null } },
      });
    }
  } catch (e) {
    await failFromError(e);
  }
}

export async function closeStatement(formData: FormData) {
  try {
    const id = String(formData.get("id"));
    await transition(id, ["PAID", "APPROVED"], "CLOSED");
  } catch (e) {
    await failFromError(e);
  }
}

export async function backToDraft(formData: FormData) {
  try {
    const id = String(formData.get("id"));
    await transition(id, ["UNDER_REVIEW", "APPROVED"], "DRAFT");
  } catch (e) {
    await failFromError(e);
  }
}
