"use server";


import { actionFailure, failFromError, userMessage } from "@/lib/action-error";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireStaff, type SessionUser } from "@/lib/auth";
import { assertCan, contractScope } from "@/lib/permissions";
import { assignableMember } from "@/lib/team";
import { audit } from "@/lib/audit";
import { notify, autoTask } from "@/lib/notify";
import { sendMessage, type Channel } from "@/lib/channels";
import { addDays, date, money, daysOverdue, startOfDay } from "@/lib/format";
import { getOrgSettings, graceDaysFor, enforcementEligible, endOfDay } from "@/lib/engine";
import { reminderDraft } from "@/lib/ai";
import type { FormState } from "@/components/ui";
import { NOTIFICATION_CHANNELS } from "@/lib/constants";

type Staff = SessionUser & { organizationId: string };

/** Loads a case inside the user's organization and property scope, or null. */
async function getCase(user: Staff, id: string) {
  return db.collectionCase.findFirst({
    where: { id, organizationId: user.organizationId, installment: { ...contractScope(user) } },
    include: {
      installment: {
        include: {
          tenant: { select: { id: true, name: true, phone: true, email: true } },
          contract: { select: { id: true, code: true, paymentFrequency: true, propertyId: true, unit: { select: { number: true } }, property: { select: { name: true } } } },
        },
      },
    },
  });
}

type CaseRow = NonNullable<Awaited<ReturnType<typeof getCase>>>;

function label(k: CaseRow) {
  return `${k.installment.tenant.name} — ${k.installment.contract.code} / ${k.installment.seq}`;
}

const TERMINAL = ["PAID", "CLOSED"];

/** Derives the next follow-up status after a logged contact. Contacts keep the case OPEN; only a dispute changes it. */
function nextFollowUp(current: string, _type: string, outcome: string | null): string {
  if (TERMINAL.includes(current) || current === "ESCALATED") return current;
  if (outcome === "DISPUTED") return "DISPUTED";
  return current;
}

/** Replaces {{variable}} placeholders in a template body. */
export async function renderTemplate(body: string, vars: Record<string, string>) {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) => vars[key] ?? "");
}

const logSchema = z.object({
  caseId: z.string().min(1),
  type: z.enum(["SMS", "CALL", "WHATSAPP", "EMAIL", "VISIT", "NOTE"], { message: "نوع الإجراء غير صالح" }),
  outcome: z.enum(["NO_ANSWER", "ANSWERED", "PROMISED", "REFUSED", "DISPUTED", "PAID"]).nullable(),
  note: z.string().max(1000).nullable(),
});

export async function logAction(_prev: FormState, fd: FormData): Promise<FormState> {
  try {
    const user = await requireStaff();
    assertCan(user, "collections.manage");
    const parsed = logSchema.safeParse({
      caseId: fd.get("caseId"),
      type: fd.get("type"),
      outcome: fd.get("outcome") || null,
      note: String(fd.get("note") ?? "").trim() || null,
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const k = await getCase(user, parsed.data.caseId);
    if (!k) return { error: "المطالبة غير موجودة." };
    if (parsed.data.type === "NOTE" && !parsed.data.note) return { error: "اكتب نص الملاحظة." };

    const now = new Date();
    const follow = nextFollowUp(k.followUpStatus, parsed.data.type, parsed.data.outcome);
    await db.$transaction([
      db.collectionAction.create({ data: { caseId: k.id, type: parsed.data.type, outcome: parsed.data.outcome, note: parsed.data.note, byUserId: user.id } }),
      db.collectionCase.update({ where: { id: k.id }, data: { followUpStatus: follow, lastActionAt: now } }),
    ]);
    await audit({
      user,
      action: "UPDATE",
      entityType: "COLLECTION",
      entityId: k.id,
      entityLabel: label(k),
      oldValue: { followUpStatus: k.followUpStatus },
      newValue: { followUpStatus: follow, action: parsed.data.type, outcome: parsed.data.outcome, note: parsed.data.note },
    });
    revalidatePath(`/collections/${k.id}`);
    return { success: "تم تسجيل الإجراء." };
  } catch (e) {
    return actionFailure(e);
  }
}

const promiseSchema = z.object({
  caseId: z.string().min(1),
  amount: z.coerce.number().positive("أدخل مبلغ الوعد"),
  promiseDate: z.coerce.date({ message: "أدخل تاريخ الوعد" }),
  note: z.string().max(1000).nullable(),
});

export async function recordPromise(_prev: FormState, fd: FormData): Promise<FormState> {
  try {
    const user = await requireStaff();
    assertCan(user, "collections.manage");
    const parsed = promiseSchema.safeParse({
      caseId: fd.get("caseId"),
      amount: fd.get("amount"),
      promiseDate: fd.get("promiseDate") || undefined,
      note: String(fd.get("note") ?? "").trim() || null,
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const k = await getCase(user, parsed.data.caseId);
    if (!k) return { error: "المطالبة غير موجودة." };
    if (TERMINAL.includes(k.followUpStatus)) return { error: "لا يمكن تسجيل وعد على مطالبة مغلقة." };
    // The form posts a calendar day (yyyy-mm-dd). Store the END of that day so a promise "for today" is only
    // broken once the day is over (the engine compares promiseDate against now).
    const promiseDate = endOfDay(String(fd.get("promiseDate") ?? "").trim() || parsed.data.promiseDate);
    const today = startOfDay();
    if (promiseDate < today) return { error: "تاريخ الوعد يجب أن يكون اليوم أو بعده." };

    const now = new Date();
    const note = `وعد بسداد ${money(parsed.data.amount)} ر.س بتاريخ ${date(promiseDate)}${parsed.data.note ? ` — ${parsed.data.note}` : ""}`;
    await db.$transaction([
      db.collectionAction.create({ data: { caseId: k.id, type: "PROMISE", outcome: "PROMISED", note, byUserId: user.id } }),
      db.collectionCase.update({
        where: { id: k.id },
        data: {
          followUpStatus: "PROMISE_TO_PAY",
          promiseAmount: parsed.data.amount,
          promiseDate,
          lastActionAt: now,
          nextAction: "متابعة وعد السداد",
          nextActionDate: promiseDate,
        },
      }),
    ]);
    await audit({
      user,
      action: "UPDATE",
      entityType: "COLLECTION",
      entityId: k.id,
      entityLabel: label(k),
      oldValue: { followUpStatus: k.followUpStatus, promiseDate: k.promiseDate, promiseAmount: k.promiseAmount },
      newValue: { followUpStatus: "PROMISE_TO_PAY", promiseAmount: parsed.data.amount, promiseDate },
    });
    revalidatePath(`/collections/${k.id}`);
    return { success: "تم تسجيل وعد السداد." };
  } catch (e) {
    return actionFailure(e);
  }
}

export async function requestExtension(_prev: FormState, fd: FormData): Promise<FormState> {
  try {
    const user = await requireStaff();
    assertCan(user, "collections.manage");
    const caseId = String(fd.get("caseId") ?? "");
    const reason = String(fd.get("note") ?? "").trim();
    const untilRaw = String(fd.get("until") ?? "").trim();
    // Extension runs to the END of the chosen day (same rule as promises).
    const until = untilRaw ? endOfDay(untilRaw) : null;
    if (!until || Number.isNaN(until.getTime())) return { error: "حدد تاريخ التمديد." };
    if (!reason) return { error: "اكتب سبب طلب التمديد." };
    const k = await getCase(user, caseId);
    if (!k) return { error: "المطالبة غير موجودة." };
    if (TERMINAL.includes(k.followUpStatus)) return { error: "المطالبة مغلقة." };

    const now = new Date();
    await db.$transaction([
      db.collectionAction.create({ data: { caseId: k.id, type: "PROMISE", outcome: "PROMISED", note: `تمديد حتى ${date(until)}: ${reason}`, byUserId: user.id } }),
      db.collectionCase.update({
        where: { id: k.id },
        data: { followUpStatus: "PROMISE_TO_PAY", promiseAmount: k.installment.amount - k.installment.paidAmount, promiseDate: until, lastActionAt: now, nextAction: "متابعة السداد بعد التمديد", nextActionDate: until },
      }),
    ]);
    await notify({
      organizationId: user.organizationId,
      owners: true,
      title: `طلب تمديد سداد — ${k.installment.tenant.name}`,
      body: `${k.installment.contract.code} / قسط ${k.installment.seq} · ${reason}`,
      severity: "WARNING",
      entityType: "COLLECTION",
      entityId: k.id,
      href: `/collections/${k.id}`,
    });
    await audit({
      user,
      action: "STATUS_CHANGE",
      entityType: "COLLECTION",
      entityId: k.id,
      entityLabel: label(k),
      oldValue: { followUpStatus: k.followUpStatus },
      newValue: { followUpStatus: "PROMISE_TO_PAY", until, reason },
    });
    revalidatePath(`/collections/${k.id}`);
    return { success: "تم تسجيل طلب التمديد وإشعار صاحب الحساب." };
  } catch (e) {
    return actionFailure(e);
  }
}

export async function markDisputed(_prev: FormState, fd: FormData): Promise<FormState> {
  try {
    const user = await requireStaff();
    assertCan(user, "collections.manage");
    const caseId = String(fd.get("caseId") ?? "");
    const reason = String(fd.get("note") ?? "").trim();
    if (!reason) return { error: "اكتب سبب الاعتراض." };
    const k = await getCase(user, caseId);
    if (!k) return { error: "المطالبة غير موجودة." };
    if (TERMINAL.includes(k.followUpStatus)) return { error: "المطالبة مغلقة." };
    const now = new Date();
    await db.$transaction([
      db.collectionAction.create({ data: { caseId: k.id, type: "NOTE", outcome: "DISPUTED", note: `اعتراض المستأجر: ${reason}`, byUserId: user.id } }),
      db.collectionCase.update({ where: { id: k.id }, data: { followUpStatus: "DISPUTED", lastActionAt: now, nextAction: "مراجعة الاعتراض", nextActionDate: addDays(now, 3) } }),
    ]);
    await audit({
      user,
      action: "STATUS_CHANGE",
      entityType: "COLLECTION",
      entityId: k.id,
      entityLabel: label(k),
      oldValue: { followUpStatus: k.followUpStatus },
      newValue: { followUpStatus: "DISPUTED", reason },
    });
    revalidatePath(`/collections/${k.id}`);
    return { success: "تم تسجيل الاعتراض." };
  } catch (e) {
    return actionFailure(e);
  }
}

export async function escalateCase(_prev: FormState, fd: FormData): Promise<FormState> {
  try {
    const user = await requireStaff();
    assertCan(user, "collections.manage");
    const caseId = String(fd.get("caseId") ?? "");
    const reason = String(fd.get("note") ?? "").trim();
    const najiz = String(fd.get("kind") ?? "INTERNAL") === "NAJIZ";
    const k = await getCase(user, caseId);
    if (!k) return { error: "المطالبة غير موجودة." };
    if (TERMINAL.includes(k.followUpStatus)) return { error: "المطالبة مغلقة." };
    if (k.followUpStatus === "ESCALATED") return { error: "المطالبة مصعّدة بالفعل." };
    if (najiz) {
      const settings = await getOrgSettings(user.organizationId);
      if (!enforcementEligible(k.installment, k.installment.contract, settings)) {
        return { error: `لا يمكن طلب التنفيذ عبر ناجز قبل انقضاء مهلة السداد النظامية (${graceDaysFor(k.installment.contract.paymentFrequency, settings)} يومًا بعد الاستحقاق). صعّد المطالبة داخليًا بدلًا من ذلك.` };
      }
    }
    const now = new Date();
    const remaining = k.installment.amount - k.installment.paidAmount;
    const note = najiz ? `طلب تنفيذ مالي عبر ناجز — بانتظار موافقة صاحب الحساب.${reason ? ` ${reason}` : ""}` : reason || "تصعيد يدوي إلى صاحب الحساب.";
    await db.$transaction([
      db.collectionAction.create({ data: { caseId: k.id, type: "ESCALATION", note, byUserId: user.id } }),
      db.collectionCase.update({
        where: { id: k.id },
        data: { followUpStatus: "ESCALATED", escalatedAt: now, lastActionAt: now, nextAction: najiz ? "تقديم طلب التنفيذ عبر ناجز" : "قرار صاحب الحساب", nextActionDate: addDays(now, 2) },
      }),
    ]);
    await notify({
      organizationId: user.organizationId,
      owners: true,
      title: `${najiz ? "طلب تنفيذ عبر ناجز" : "تصعيد مطالبة"} — ${k.installment.tenant.name}`,
      body: `الوحدة ${k.installment.contract.unit.number} · المتبقي ${money(remaining)} ر.س${reason ? ` · ${reason}` : ""}`,
      severity: "DANGER",
      entityType: "COLLECTION",
      entityId: k.id,
      href: `/collections/${k.id}`,
    });
    await autoTask({
      organizationId: user.organizationId,
      title: `${najiz ? "طلب تنفيذ عبر ناجز" : "مطالبة مصعّدة"}: ${k.installment.tenant.name} — الوحدة ${k.installment.contract.unit.number}`,
      description: `صعّد ${user.name} المطالبة. المتبقي ${money(remaining)} ر.س.${reason ? ` السبب: ${reason}` : ""}`,
      assignee: "OWNER",
      priority: "URGENT",
      dueDate: addDays(now, 2),
      entityType: "INSTALLMENT",
      entityId: k.installmentId,
      entityLabel: `${k.installment.contract.code} / ${k.installment.seq}`,
    });
    await audit({
      user,
      action: "STATUS_CHANGE",
      entityType: "COLLECTION",
      entityId: k.id,
      entityLabel: label(k),
      oldValue: { followUpStatus: k.followUpStatus },
      newValue: { followUpStatus: "ESCALATED", reason, najiz },
    });
    revalidatePath(`/collections/${k.id}`);
    return { success: najiz ? "تم تسجيل طلب التنفيذ وإشعار صاحب الحساب." : "تم التصعيد وإشعار صاحب الحساب." };
  } catch (e) {
    return actionFailure(e);
  }
}

export async function assignCollector(_prev: FormState, fd: FormData): Promise<FormState> {
  try {
    const user = await requireStaff();
    assertCan(user, "collections.manage");
    const caseId = String(fd.get("caseId") ?? "");
    const collectorId = String(fd.get("collectorId") ?? "");
    const k = await getCase(user, caseId);
    if (!k) return { error: "المطالبة غير موجودة." };
    const collector = collectorId ? await assignableMember(user.organizationId, collectorId, "collections.manage") : null;
    if (collectorId && !collector) return { error: "الموظف المحدد لا يملك صلاحية متابعة المطالبات." };
    if (collector && !collector.reaches(k.installment.contract.propertyId)) return { error: `${collector.name} لا يملك صلاحية الوصول إلى هذا العقار.` };
    await db.$transaction([
      db.collectionCase.update({ where: { id: k.id }, data: { collectorId: collector?.id ?? null } }),
      db.collectionAction.create({
        data: { caseId: k.id, type: "SYSTEM", note: collector ? `تم إسناد المطالبة إلى ${collector.name}.` : "تم إلغاء إسناد المطالبة.", byUserId: user.id },
      }),
    ]);
    if (collector && collector.id !== user.id) {
      await notify({
        organizationId: user.organizationId,
        userIds: [collector.id],
        title: `مطالبة مسندة إليك — ${k.installment.tenant.name}`,
        body: `الوحدة ${k.installment.contract.unit.number}`,
        entityType: "COLLECTION",
        entityId: k.id,
        href: `/collections/${k.id}`,
      });
    }
    await audit({ user, action: "UPDATE", entityType: "COLLECTION", entityId: k.id, entityLabel: label(k), oldValue: { collectorId: k.collectorId }, newValue: { collectorId: collector?.id ?? null } });
    revalidatePath(`/collections/${k.id}`);
    return { success: "تم تحديث المحصل." };
  } catch (e) {
    return actionFailure(e);
  }
}

export async function setNextAction(_prev: FormState, fd: FormData): Promise<FormState> {
  try {
    const user = await requireStaff();
    assertCan(user, "collections.manage");
    const caseId = String(fd.get("caseId") ?? "");
    const nextAction = String(fd.get("nextAction") ?? "").trim();
    const raw = String(fd.get("nextActionDate") ?? "").trim();
    if (!nextAction) return { error: "اكتب الإجراء التالي." };
    const k = await getCase(user, caseId);
    if (!k) return { error: "المطالبة غير موجودة." };
    // A follow-up planned "for today" stays due all day (end of the chosen day), not "late" at 00:00.
    const nextActionDate = raw ? endOfDay(raw) : null;
    if (nextActionDate && Number.isNaN(nextActionDate.getTime())) return { error: "تاريخ الإجراء غير صالح." };
    await db.collectionCase.update({ where: { id: k.id }, data: { nextAction, nextActionDate } });
    await audit({
      user,
      action: "UPDATE",
      entityType: "COLLECTION",
      entityId: k.id,
      entityLabel: label(k),
      oldValue: { nextAction: k.nextAction, nextActionDate: k.nextActionDate },
      newValue: { nextAction, nextActionDate },
    });
    revalidatePath(`/collections/${k.id}`);
    return { success: "تم حفظ الإجراء التالي." };
  } catch (e) {
    return actionFailure(e);
  }
}

export async function closeCase(_prev: FormState, fd: FormData): Promise<FormState> {
  try {
    const user = await requireStaff();
    assertCan(user, "collections.manage");
    const caseId = String(fd.get("caseId") ?? "");
    const k = await getCase(user, caseId);
    if (!k) return { error: "المطالبة غير موجودة." };
    if (!["PAID", "WAIVED"].includes(k.installment.status)) return { error: "لا يمكن إغلاق المطالبة قبل سداد القسط أو إعفائه." };
    const now = new Date();
    await db.$transaction([
      db.collectionAction.create({ data: { caseId: k.id, type: "SYSTEM", note: "تم إغلاق المطالبة.", byUserId: user.id } }),
      db.collectionCase.update({ where: { id: k.id }, data: { followUpStatus: "CLOSED", priority: 0, lastActionAt: now, nextAction: null, nextActionDate: null } }),
    ]);
    await audit({ user, action: "STATUS_CHANGE", entityType: "COLLECTION", entityId: k.id, entityLabel: label(k), oldValue: { followUpStatus: k.followUpStatus }, newValue: { followUpStatus: "CLOSED" } });
    revalidatePath(`/collections/${k.id}`);
    return { success: "تم إغلاق المطالبة." };
  } catch (e) {
    return actionFailure(e);
  }
}

/** Bulk assign selected cases to a collector (list page). */
export async function bulkAssign(fd: FormData) {
  try {
    const user = await requireStaff();
    assertCan(user, "collections.manage");
    const ids = fd.getAll("ids").map(String).filter(Boolean);
    const collectorId = String(fd.get("collectorId") ?? "");
    const rawBack = String(fd.get("back") ?? "");
    // Same-module relative paths only (no scheme, no protocol-relative //, no backslash).
    const back = /^\/collections(?:[/?][^\\]*)?$/.test(rawBack) && !rawBack.startsWith("//") ? rawBack : "/collections";
    if (!ids.length || !collectorId) redirect(back);
    const collector = await assignableMember(user.organizationId, collectorId, "collections.manage");
    if (!collector) throw new Error("الموظف المحدد لا يملك صلاحية متابعة المطالبات.");
    const cases = (
      await db.collectionCase.findMany({
        where: { id: { in: ids }, organizationId: user.organizationId, installment: { ...contractScope(user) } },
        select: { id: true, collectorId: true, installment: { select: { contract: { select: { propertyId: true } } } } },
      })
    ).filter((c) => collector.reaches(c.installment.contract.propertyId));
    if (ids.length && !cases.length) throw new Error(`${collector.name} لا يملك صلاحية الوصول إلى عقارات هذه المطالبات.`);
    if (cases.length) {
      await db.$transaction([
        db.collectionCase.updateMany({ where: { id: { in: cases.map((c) => c.id) } }, data: { collectorId: collector.id } }),
        db.collectionAction.createMany({ data: cases.map((c) => ({ caseId: c.id, type: "SYSTEM", note: `إسناد جماعي إلى ${collector.name}.`, byUserId: user.id })) }),
      ]);
      if (collector.id !== user.id) {
        await notify({ organizationId: user.organizationId, userIds: [collector.id], title: `تم إسناد ${cases.length} مطالبة إليك`, entityType: "COLLECTION", href: "/collections?view=list&mine=1" });
      }
      await audit({ user, action: "UPDATE", entityType: "COLLECTION", entityLabel: `إسناد جماعي (${cases.length})`, oldValue: cases.map((c) => ({ id: c.id, collectorId: c.collectorId })), newValue: { collectorId: collector.id, ids: cases.map((c) => c.id) } });
    }
    revalidatePath("/collections");
    redirect(back);
  } catch (e) {
    await failFromError(e);
  }
}

/** Saves the current query as a named view for the collections module. */
export async function saveView(fd: FormData) {
  try {
    const user = await requireStaff();
    assertCan(user, "collections.view");
    const name = String(fd.get("name") ?? "").trim();
    const query = String(fd.get("query") ?? "").replace(/^\?/, "");
    const isShared = fd.get("isShared") === "1";
    if (!name) throw new Error("اسم العرض مطلوب.");
    const v = await db.savedView.create({ data: { organizationId: user.organizationId, userId: user.id, module: "collections", name, query, isShared } });
    await audit({ user, action: "CREATE", entityType: "SAVED_VIEW", entityId: v.id, entityLabel: name, newValue: { module: "collections", query, isShared } });
    revalidatePath("/collections");
    redirect(`/collections${query ? `?${query}` : ""}`);
  } catch (e) {
    await failFromError(e);
  }
}

export async function deleteView(fd: FormData) {
  try {
    const user = await requireStaff();
    const id = String(fd.get("id") ?? "");
    const v = await db.savedView.findFirst({ where: { id, organizationId: user.organizationId, userId: user.id } });
    if (!v) return;
    await db.savedView.delete({ where: { id } });
    await audit({ user, action: "DELETE", entityType: "SAVED_VIEW", entityId: id, entityLabel: v.name });
    revalidatePath("/collections");
  } catch (e) {
    await failFromError(e);
  }
}

/** Delivers one message to the tenant through a channel, logs it on the case, notifies the tenant portal and audits. Throws on delivery failure after logging. */
async function deliverToTenant(user: Staff, k: CaseRow, type: Channel, text: string, label_: string) {
  const to = (type === "EMAIL" ? k.installment.tenant.email : k.installment.tenant.phone)?.trim() ?? "";
  if (!to) throw new Error(type === "EMAIL" ? "لا يوجد بريد إلكتروني مسجل للمستأجر." : "لا يوجد رقم جوال مسجل للمستأجر.");

  // Real delivery (simulated + logged when the provider keys are missing). sendMessage never throws.
  const result = await sendMessage({ organizationId: user.organizationId, channel: type, to, body: text, subject: label_, entityType: "INSTALLMENT", entityId: k.installmentId });
  const outcomeNote = result.ok
    ? result.simulated
      ? "الإرسال: محاكاة (لم يُضبط مزود القناة)"
      : `الإرسال: تم عبر ${result.provider}${result.providerMessageId ? ` · معرف الرسالة ${result.providerMessageId}` : ""}`
    : `الإرسال: فشل${result.error ? ` — ${result.error}` : ""}`;

  const now = new Date();
  const follow = result.ok ? nextFollowUp(k.followUpStatus, type, null) : k.followUpStatus;
  await db.$transaction([
    db.collectionAction.create({ data: { caseId: k.id, type, note: `[${label_}] ${text}\n${outcomeNote}`, byUserId: user.id } }),
    db.collectionCase.update({ where: { id: k.id }, data: { followUpStatus: follow, lastActionAt: now } }),
  ]);
  const portal = await db.user.findFirst({ where: { tenantId: k.installment.tenant.id, status: "ACTIVE" }, select: { id: true } });
  if (portal) {
    await notify({
      organizationId: user.organizationId,
      userIds: [portal.id],
      title: label_,
      body: text,
      channel: type,
      severity: "WARNING",
      entityType: "INSTALLMENT",
      entityId: k.installmentId,
      href: "/tenant/payments",
    });
  }
  await audit({
    user,
    action: "UPDATE",
    entityType: "COLLECTION",
    entityId: k.id,
    entityLabel: label(k),
    oldValue: { followUpStatus: k.followUpStatus },
    newValue: { sentTemplate: label_, channel: type, to, text, followUpStatus: follow, delivery: { ok: result.ok, simulated: result.simulated, provider: result.provider, providerMessageId: result.providerMessageId ?? null, error: result.error ?? null } },
  });
  revalidatePath(`/collections/${k.id}`);
  return result;
}

/** Sends a notification template to the tenant through the real channel (SMS / WhatsApp / Email), logs the result on the case and audits it. */
export async function sendTemplate(fd: FormData) {
  try {
    const user = await requireStaff();
    assertCan(user, "collections.manage");
    const caseId = String(fd.get("caseId") ?? "");
    const templateId = String(fd.get("templateId") ?? "");
    const k = await getCase(user, caseId);
    if (!k) throw new Error("المطالبة غير موجودة.");
    const t = await db.notificationTemplate.findFirst({ where: { id: templateId, organizationId: user.organizationId, isActive: true } });
    if (!t) throw new Error("القالب غير موجود.");
    const remaining = k.installment.amount - k.installment.paidAmount;
    const text = await renderTemplate(t.body, {
      tenant_name: k.installment.tenant.name,
      unit_number: k.installment.contract.unit.number,
      amount: money(remaining),
      due_date: date(k.installment.dueDate),
      contract_code: k.installment.contract.code,
    });
    const type: Channel = t.channel === "WHATSAPP" ? "WHATSAPP" : t.channel === "EMAIL" ? "EMAIL" : "SMS";
    const result = await deliverToTenant(user, k, type, text, t.name);
    if (!result.ok) throw new Error(`تعذر إرسال الرسالة عبر ${NOTIFICATION_CHANNELS[type] ?? type}. تم تسجيل المحاولة على المطالبة.`);
  } catch (e) {
    await failFromError(e);
  }
}

const draftSchema = z.object({
  caseId: z.string().min(1),
  channel: z.enum(["SMS", "WHATSAPP", "EMAIL"]),
  tone: z.enum(["soft", "firm"]).default("soft"),
});

/** Asks the assistant for a reminder draft. Returns the text in `success`; the user edits and sends it separately. */
export async function draftReminder(_prev: FormState, fd: FormData): Promise<FormState> {
  try {
    const user = await requireStaff();
    assertCan(user, "collections.manage");
    const parsed = draftSchema.safeParse({ caseId: fd.get("caseId"), channel: fd.get("channel"), tone: fd.get("tone") || "soft" });
    if (!parsed.success) return { error: "اختر القناة والنبرة." };
    const k = await getCase(user, parsed.data.caseId);
    if (!k) return { error: "المطالبة غير موجودة." };
    const settings = await getOrgSettings(user.organizationId);
    const inst = k.installment;
    const late = daysOverdue(inst.dueDate);
    const { text } = await reminderDraft({
      tenantName: inst.tenant.name,
      unitNumber: inst.contract.unit.number,
      propertyName: inst.contract.property.name,
      amount: inst.amount - inst.paidAmount,
      dueDate: date(inst.dueDate),
      daysLate: late,
      graceDays: graceDaysFor(inst.contract.paymentFrequency, settings),
      pastGrace: enforcementEligible(inst, inst.contract, settings) || late > graceDaysFor(inst.contract.paymentFrequency, settings),
      officeName: user.organizationName ?? "المكتب",
      channel: parsed.data.channel,
      tone: parsed.data.tone,
    });
    return { success: text };
  } catch (e) {
    return actionFailure(e);
  }
}

const customSchema = z.object({
  caseId: z.string().min(1),
  channel: z.enum(["SMS", "WHATSAPP", "EMAIL"]),
  body: z.string().trim().min(10, "نص الرسالة قصير جدًا.").max(1500, "نص الرسالة طويل جدًا."),
});

/** Sends a message the user wrote or edited (e.g. an assistant draft) to the tenant. */
export async function sendCustomMessage(_prev: FormState, fd: FormData): Promise<FormState> {
  try {
    const user = await requireStaff();
    assertCan(user, "collections.manage");
    const parsed = customSchema.safeParse({ caseId: fd.get("caseId"), channel: fd.get("channel"), body: fd.get("body") });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const k = await getCase(user, parsed.data.caseId);
    if (!k) return { error: "المطالبة غير موجودة." };
    if (TERMINAL.includes(k.followUpStatus)) return { error: "المطالبة مغلقة." };
    try {
      const result = await deliverToTenant(user, k, parsed.data.channel, parsed.data.body, "رسالة تذكير");
      if (!result.ok) return { error: `تعذر إرسال الرسالة عبر ${NOTIFICATION_CHANNELS[parsed.data.channel] ?? parsed.data.channel}. تم تسجيل المحاولة على المطالبة.` };
    } catch (e) {
      return { error: userMessage(e) };
    }
    return { success: "تم إرسال الرسالة وتسجيلها على المطالبة." };
  } catch (e) {
    return actionFailure(e);
  }
}
