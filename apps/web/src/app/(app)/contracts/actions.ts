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
import { buildSchedule, computeContractStatus, scheduleCount, contractMonths, annualRent, refreshInstallments } from "@/lib/engine";
import { notify, autoTask } from "@/lib/notify";
import { addDays, addMonths, daysFromToday, inputDate, r2, startOfDay, endOfDay } from "@/lib/format";
import { FREQUENCY_MONTHS, PAYMENT_FREQUENCY, RENEWAL_STATUS } from "@/lib/constants";
import type { FormState } from "@/components/ui";
import { normalizePhone, phoneVariants } from "@/lib/phone";

type StaffUser = SessionUser & { organizationId: string };

const OPEN_STATUSES = ["ACTIVE", "EXPIRING_SOON", "RENEWAL_PENDING"];
const EDITABLE_STATUSES = ["DRAFT", "PENDING_APPROVAL"];

const schema = z.object({
  propertyId: z.string().min(1, "العقار مطلوب"),
  unitId: z.string().min(1, "الوحدة مطلوبة"),
  tenantId: z.string().optional().nullable(),
  newTenantName: z.string().optional().nullable(),
  newTenantPhone: z.string().optional().nullable(),
  newTenantNationalId: z.string().optional().nullable(),
  ownerId: z.string().min(1, "المالك مطلوب"),
  startDate: z.string().min(1, "تاريخ البداية مطلوب"),
  months: z.coerce.number().int().min(1, "مدة العقد يجب أن تكون شهرًا واحدًا على الأقل").max(120).default(12),
  totalAmount: z.coerce.number().positive("قيمة العقد يجب أن تكون أكبر من صفر").transform(r2),
  managementFeePct: z.coerce.number().min(0).max(100).default(5),
  vatAmount: z.coerce.number().min(0).default(0).transform(r2),
  paymentFrequency: z.string().default("QUARTERLY"),
  installmentsCount: z.coerce.number().int().min(1).max(60).optional().nullable(),
  notes: z.string().optional().nullable(),
  leadId: z.string().optional().nullable(),
});

type Parsed = z.infer<typeof schema>;

function parse(formData: FormData) {
  const raw: Record<string, unknown> = {};
  formData.forEach((v, k) => {
    if (["id", "activate", "override", "endDate"].includes(k)) return;
    raw[k] = v === "" ? null : v;
  });
  if (raw.vatAmount === null) raw.vatAmount = 0;
  if (raw.managementFeePct === null) raw.managementFeePct = 5;
  if (raw.months === null) raw.months = 12;
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0].message } as const;
  const d = parsed.data;
  if (!PAYMENT_FREQUENCY[d.paymentFrequency]) return { error: "دورية السداد غير صالحة." } as const;
  if (d.paymentFrequency === "CUSTOM" && !d.installmentsCount) return { error: "حدد عدد الأقساط للدورية المخصصة." } as const;
  const startDate = new Date(d.startDate);
  if (Number.isNaN(startDate.getTime())) return { error: "تاريخ البداية غير صالح." } as const;
  const startDay = startOfDay(startDate);
  startDate.setTime(startDay.getTime());
  const endDate = addDays(addMonths(startDate, d.months), -1);
  const installmentsCount = scheduleCount(d.months, d.paymentFrequency, d.installmentsCount);
  return { data: d, startDate, endDate, installmentsCount } as const;
}

/** Validates property/unit/tenant/owner belong to the org and the user's scope. */
async function loadParties(user: StaffUser, d: Parsed) {
  const org = user.organizationId;
  const [property, unit, owner] = await Promise.all([
    db.property.findFirst({ where: { id: d.propertyId, organizationId: org, ...propertyScope(user) }, select: { id: true, name: true } }),
    db.unit.findFirst({ where: { id: d.unitId, organizationId: org, propertyId: d.propertyId }, select: { id: true, number: true, status: true } }),
    db.owner.findFirst({ where: { id: d.ownerId, organizationId: org }, select: { id: true, name: true } }),
  ]);
  if (!property) throw new Error("العقار غير موجود ضمن نطاقك.");
  if (!unit) throw new Error("الوحدة غير تابعة لهذا العقار.");
  if (unit.status === "ARCHIVED") throw new Error("لا يمكن التعاقد على وحدة مؤرشفة.");
  if (!owner) throw new Error("المالك غير موجود.");
  return { property, unit, owner };
}

/** Returns an existing tenant or creates one inline (name + phone + nationalId). */
async function resolveTenant(user: StaffUser, d: Parsed) {
  const org = user.organizationId;
  if (d.tenantId) {
    const t = await db.tenant.findFirst({ where: { id: d.tenantId, organizationId: org }, select: { id: true, name: true } });
    if (!t) throw new Error("المستأجر غير موجود.");
    return { tenant: t, created: false };
  }
  const name = (d.newTenantName ?? "").trim();
  if (name.length < 2) throw new Error("اختر مستأجرًا أو أدخل اسم المستأجر الجديد.");
  assertCan(user, "tenants.manage");
  // The phone is the tenant's portal login: store it normalized (9665…) or not at all.
  const rawPhone = (d.newTenantPhone ?? "").trim();
  const phone = rawPhone ? normalizePhone(rawPhone) : null;
  if (rawPhone && !phone) throw new Error("رقم جوال المستأجر غير صحيح (مثال: 05XXXXXXXX).");
  const nationalId = d.newTenantNationalId?.trim() || null;
  if (phone || nationalId) {
    const dup = await db.tenant.findFirst({
      where: { organizationId: org, status: { not: "ARCHIVED" }, OR: [...(phone ? [{ phone: { in: phoneVariants(phone) } }] : []), ...(nationalId ? [{ nationalId }] : [])] },
      select: { name: true },
    });
    if (dup) throw new Error(`يوجد مستأجر مسجل بنفس الجوال أو الهوية (${dup.name}). اختره من «مستأجر مسجل».`);
  }
  const code = await nextCode(org, "tenant");
  const t = await db.tenant.create({
    data: { organizationId: org, code, name, phone, nationalId },
    select: { id: true, name: true },
  });
  await audit({ user, action: "CREATE", entityType: "TENANT", entityId: t.id, entityLabel: t.name, newValue: { name, phone, nationalId, via: "contract" } });
  return { tenant: t, created: true };
}

/** BR-001: a unit cannot have two overlapping open contracts. */
async function findOverlap(org: string, unitId: string, startDate: Date, endDate: Date, excludeId?: string) {
  return db.contract.findFirst({
    where: {
      organizationId: org,
      unitId,
      status: { in: OPEN_STATUSES },
      startDate: { lte: endDate },
      endDate: { gte: startDate },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, code: true, endDate: true },
  });
}

/** Activation side-effects: schedule, unit status, lead conversion, tasks. Idempotent for installments. */
async function activateInternal(user: StaffUser, contractId: string) {
  const org = user.organizationId;
  const c = await db.contract.findFirst({ where: { id: contractId, organizationId: org }, include: { unit: { select: { id: true, number: true, status: true } }, tenant: { select: { id: true, name: true } } } });
  if (!c) throw new Error("العقد غير موجود.");
  if (c.unit.status === "ARCHIVED") throw new Error("الوحدة مؤرشفة. استعد الوحدة أولًا ثم فعّل العقد.");
  const status = computeContractStatus({ startDate: c.startDate, endDate: c.endDate, status: "ACTIVE", renewalStatus: c.renewalStatus });
  const months = contractMonths(c.startDate, c.endDate);
  await db.$transaction(async (tx) => {
    await tx.contract.update({ where: { id: c.id }, data: { status } });
    // One schedule per contract: the count is read inside the transaction and (contractId, seq) is unique, so a second
    // concurrent activation fails instead of billing the rent twice. VAT is billed with the rent (spread over the installments).
    if ((await tx.installment.count({ where: { contractId: c.id } })) === 0) {
      const rows = buildSchedule({ startDate: c.startDate, totalAmount: r2(c.totalAmount + (c.vatAmount || 0)), frequency: c.paymentFrequency, installmentsCount: c.installmentsCount, months });
      await tx.installment.createMany({
        data: rows.map((r) => ({ organizationId: org, contractId: c.id, tenantId: c.tenantId, seq: r.seq, dueDate: r.dueDate, amount: r.amount, status: "UPCOMING" })),
      });
    }
    await tx.unit.update({ where: { id: c.unitId }, data: { status: "RENTED", currentRent: annualRent(c.totalAmount, months) } });
    await tx.lead.updateMany({ where: { organizationId: org, unitId: c.unitId, stage: { in: ["APPROVED", "CONTRACTING"] } }, data: { stage: "RENTED" } });
    if (c.renewedFromId) {
      // Only a contract that is still open (or just expired) becomes RENEWED — never one terminated or cancelled meanwhile.
      await tx.contract.updateMany({ where: { id: c.renewedFromId, organizationId: org, status: { in: [...OPEN_STATUSES, "EXPIRED"] } }, data: { status: "RENEWED", renewalStatus: "APPROVED" } });
    }
  });
  // Real statuses right away (a contract starting today has its first installment due now, not "upcoming").
  const ids = (await db.installment.findMany({ where: { contractId: c.id }, select: { id: true } })).map((i) => i.id);
  await refreshInstallments(org, ids);
  await notify({
    organizationId: org,
    audience: ["payments.manage", "collections.manage"],
    title: `عقد جديد نشط: ${c.code} — ${c.tenant.name}`,
    body: `الوحدة ${c.unit.number} · ${Math.round(c.totalAmount)} ر.س · ${PAYMENT_FREQUENCY[c.paymentFrequency] ?? c.paymentFrequency}`,
    severity: "SUCCESS",
    entityType: "CONTRACT",
    entityId: c.id,
    href: `/contracts/${c.id}`,
  });
  return status;
}

function contractData(d: Parsed, startDate: Date, endDate: Date, installmentsCount: number, tenantId: string) {
  return {
    propertyId: d.propertyId,
    unitId: d.unitId,
    tenantId,
    ownerId: d.ownerId,
    startDate,
    endDate,
    totalAmount: d.totalAmount,
    managementFeePct: d.managementFeePct,
    vatAmount: d.vatAmount,
    paymentFrequency: d.paymentFrequency,
    installmentsCount,
    notes: d.notes ?? null,
  };
}

export async function createContract(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await requireStaff();
    assertCan(user, "contracts.manage");
    const org = user.organizationId;
    const parsed = parse(formData);
    if ("error" in parsed) return { error: parsed.error };
    const { data: d, startDate, endDate, installmentsCount } = parsed;
    const activate = formData.get("activate") === "on";
    const override = formData.get("override") === "on";
    const canApprove = can(user, "contracts.approve");

    try {
      await loadParties(user, d);
      // BR-001 overlap
      const overlap = await findOverlap(org, d.unitId, startDate, endDate);
      if (overlap) {
        if (!(override && canApprove)) return { error: `الوحدة مرتبطة بعقد نشط (${overlap.code}) ينتهي في ${inputDate(overlap.endDate)}. لا يمكن إنشاء عقد متداخل (BR-001).` };
      }
      const { tenant } = await resolveTenant(user, d);
      const code = await nextCode(org, "contract");
      const status = activate ? (canApprove ? "ACTIVE" : "PENDING_APPROVAL") : "DRAFT";
      const c = await db.contract.create({
        data: { ...contractData(d, startDate, endDate, installmentsCount, tenant.id), organizationId: org, code, status, createdById: user.id },
      });
      await audit({ user, action: "CREATE", entityType: "CONTRACT", entityId: c.id, entityLabel: c.code, newValue: { ...d, startDate, endDate, status } });
      if (overlap) {
        await audit({ user, action: "APPROVE", entityType: "CONTRACT", entityId: c.id, entityLabel: c.code, oldValue: { overlapWith: overlap.code }, newValue: { override: "BR-001", reason: "تجاوز التحقق من التداخل بصلاحية الاعتماد" } });
      }
      if (d.leadId) {
        await db.lead.updateMany({ where: { id: d.leadId, organizationId: org, stage: { notIn: ["RENTED", "LOST"] } }, data: { stage: status === "ACTIVE" ? "RENTED" : "CONTRACTING", unitId: d.unitId } });
      }
      if (status === "ACTIVE") {
        await activateInternal(user, c.id);
      } else if (status === "PENDING_APPROVAL") {
        await db.unit.updateMany({ where: { id: d.unitId, status: { in: ["VACANT", "AVAILABLE"] } }, data: { status: "RESERVED" } });
        await notify({
          organizationId: org,
          owners: true,
          title: `عقد بانتظار الاعتماد: ${c.code} — ${tenant.name}`,
          body: `${Math.round(d.totalAmount)} ر.س · أنشأه ${user.name}`,
          severity: "WARNING",
          entityType: "CONTRACT",
          entityId: c.id,
          href: `/contracts/${c.id}`,
        });
      }
      revalidatePath("/contracts");
      revalidatePath("/leasing");
      redirect(`/contracts/${c.id}?toast=created`);
    } catch (e) {
      if (isRedirect(e)) throw e;
      return { error: userMessage(e, "تعذر حفظ العقد حاليًا. لم يتم إنشاء أي عقد.") };
    }
  } catch (e) {
    return actionFailure(e);
  }
}

export async function updateContract(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await requireStaff();
    assertCan(user, "contracts.manage");
    const org = user.organizationId;
    const id = String(formData.get("id"));
    const parsed = parse(formData);
    if ("error" in parsed) return { error: parsed.error };
    const { data: d, startDate, endDate, installmentsCount } = parsed;
    const override = formData.get("override") === "on";
    const canApprove = can(user, "contracts.approve");

    const old = await db.contract.findFirst({ where: { id, organizationId: org, ...propertyIdScope(user) } });
    if (!old) return { error: "العقد غير موجود." };
    if (!EDITABLE_STATUSES.includes(old.status)) return { error: "لا يمكن تعديل عقد بعد تفعيله. استخدم التجديد أو الإنهاء." };

    try {
      await loadParties(user, d);
      const overlap = await findOverlap(org, d.unitId, startDate, endDate, id);
      if (overlap && !(override && canApprove)) return { error: `الوحدة مرتبطة بعقد نشط (${overlap.code}). لا يمكن حفظ عقد متداخل (BR-001).` };
      const { tenant } = await resolveTenant(user, d);
      await db.contract.update({ where: { id }, data: contractData(d, startDate, endDate, installmentsCount, tenant.id) });
      await audit({
        user,
        action: "UPDATE",
        entityType: "CONTRACT",
        entityId: id,
        entityLabel: old.code,
        oldValue: { unitId: old.unitId, tenantId: old.tenantId, startDate: old.startDate, endDate: old.endDate, totalAmount: old.totalAmount, paymentFrequency: old.paymentFrequency },
        newValue: { ...d, startDate, endDate },
      });
      if (overlap) {
        await audit({ user, action: "APPROVE", entityType: "CONTRACT", entityId: id, entityLabel: old.code, oldValue: { overlapWith: overlap.code }, newValue: { override: "BR-001" } });
      }
      revalidatePath(`/contracts/${id}`);
      redirect(`/contracts/${id}?toast=updated`);
    } catch (e) {
      if (isRedirect(e)) throw e;
      return { error: userMessage(e, "تعذر حفظ التعديلات حاليًا.") };
    }
  } catch (e) {
    return actionFailure(e);
  }
}

/** DRAFT → ACTIVE (or PENDING_APPROVAL when the user cannot approve). */
export async function activateContract(formData: FormData) {
  try {
    const user = await requireStaff();
    assertCan(user, "contracts.manage");
    const org = user.organizationId;
    const id = String(formData.get("id"));
    const c = await db.contract.findFirst({ where: { id, organizationId: org, ...propertyIdScope(user) }, include: { tenant: { select: { name: true } } } });
    if (!c) throw new Error("العقد غير موجود.");
    if (c.status !== "DRAFT") throw new Error("هذا العقد ليس مسودة.");
    const overlap = await findOverlap(org, c.unitId, c.startDate, c.endDate, id);
    if (overlap) throw new Error(`الوحدة مرتبطة بعقد نشط (${overlap.code}). لا يمكن التفعيل (BR-001).`);
    if (can(user, "contracts.approve")) {
      const status = await activateInternal(user, id);
      await audit({ user, action: "APPROVE", entityType: "CONTRACT", entityId: id, entityLabel: c.code, oldValue: { status: c.status }, newValue: { status } });
    } else {
      await db.contract.update({ where: { id }, data: { status: "PENDING_APPROVAL" } });
      await db.unit.updateMany({ where: { id: c.unitId, status: { in: ["VACANT", "AVAILABLE"] } }, data: { status: "RESERVED" } });
      await audit({ user, action: "STATUS_CHANGE", entityType: "CONTRACT", entityId: id, entityLabel: c.code, oldValue: { status: c.status }, newValue: { status: "PENDING_APPROVAL" } });
      await notify({ organizationId: org, owners: true, title: `عقد بانتظار الاعتماد: ${c.code} — ${c.tenant.name}`, severity: "WARNING", entityType: "CONTRACT", entityId: id, href: `/contracts/${id}` });
    }
    revalidatePath(`/contracts/${id}`);
    revalidatePath("/contracts");
    redirect(`/contracts/${id}?toast=approved`);
  } catch (e) {
    await failFromError(e);
  }
}

/** PENDING_APPROVAL → ACTIVE. Requires contracts.approve. */
export async function approveContract(formData: FormData) {
  try {
    const user = await requireStaff();
    assertCan(user, "contracts.approve");
    const org = user.organizationId;
    const id = String(formData.get("id"));
    const c = await db.contract.findFirst({ where: { id, organizationId: org, ...propertyIdScope(user) }, include: { tenant: { select: { name: true } } } });
    if (!c) throw new Error("العقد غير موجود.");
    if (c.status !== "PENDING_APPROVAL") throw new Error("العقد ليس بانتظار الاعتماد.");
    const overlap = await findOverlap(org, c.unitId, c.startDate, c.endDate, id);
    if (overlap && overlap.id !== c.renewedFromId) throw new Error(`الوحدة مرتبطة بعقد نشط (${overlap.code}). لا يمكن الاعتماد (BR-001).`);
    const status = await activateInternal(user, id);
    await audit({ user, action: "APPROVE", entityType: "CONTRACT", entityId: id, entityLabel: c.code, oldValue: { status: "PENDING_APPROVAL" }, newValue: { status } });
    if (c.createdById && c.createdById !== user.id) {
      await notify({ organizationId: org, userIds: [c.createdById], title: `تم اعتماد العقد ${c.code}`, severity: "SUCCESS", entityType: "CONTRACT", entityId: id, href: `/contracts/${id}` });
    }
    revalidatePath(`/contracts/${id}`);
    revalidatePath("/contracts");
    redirect(`/contracts/${id}?toast=approved`);
  } catch (e) {
    await failFromError(e);
  }
}

/** PENDING_APPROVAL → DRAFT with a reason. Requires contracts.approve. */
export async function rejectContract(formData: FormData) {
  try {
    const user = await requireStaff();
    assertCan(user, "contracts.approve");
    const org = user.organizationId;
    const id = String(formData.get("id"));
    const reason = String(formData.get("reason") ?? "").trim();
    const c = await db.contract.findFirst({ where: { id, organizationId: org, ...propertyIdScope(user) } });
    if (!c || c.status !== "PENDING_APPROVAL") throw new Error("العقد ليس بانتظار الاعتماد.");
    await db.contract.update({ where: { id }, data: { status: "DRAFT", notes: reason ? `${c.notes ? `${c.notes}\n` : ""}سبب الرفض: ${reason}` : c.notes } });
    await db.unit.updateMany({ where: { id: c.unitId, status: "RESERVED" }, data: { status: "VACANT" } });
    await audit({ user, action: "REJECT", entityType: "CONTRACT", entityId: id, entityLabel: c.code, oldValue: { status: "PENDING_APPROVAL" }, newValue: { status: "DRAFT", reason } });
    if (c.createdById) {
      await notify({ organizationId: org, userIds: [c.createdById], title: `تم رفض اعتماد العقد ${c.code}`, body: reason || undefined, severity: "DANGER", entityType: "CONTRACT", entityId: id, href: `/contracts/${id}` });
    }
    revalidatePath(`/contracts/${id}`);
    revalidatePath("/contracts");
    redirect(`/contracts/${id}?toast=updated`);
  } catch (e) {
    await failFromError(e);
  }
}

/** DRAFT / PENDING only → CANCELLED (no hard delete). */
export async function cancelContract(formData: FormData) {
  try {
    const user = await requireStaff();
    assertCan(user, "contracts.manage");
    const org = user.organizationId;
    const id = String(formData.get("id"));
    const c = await db.contract.findFirst({ where: { id, organizationId: org, ...propertyIdScope(user) } });
    if (!c) throw new Error("العقد غير موجود.");
    if (!EDITABLE_STATUSES.includes(c.status)) throw new Error("لا يمكن إلغاء عقد مفعّل. استخدم إنهاء العقد.");
    await db.contract.update({ where: { id }, data: { status: "CANCELLED" } });
    await db.unit.updateMany({ where: { id: c.unitId, status: "RESERVED" }, data: { status: "VACANT" } });
    await db.lead.updateMany({ where: { organizationId: org, unitId: c.unitId, stage: "CONTRACTING" }, data: { stage: "APPROVED" } });
    await audit({ user, action: "STATUS_CHANGE", entityType: "CONTRACT", entityId: id, entityLabel: c.code, oldValue: { status: c.status }, newValue: { status: "CANCELLED" } });
    revalidatePath(`/contracts/${id}`);
    revalidatePath("/contracts");
    redirect(`/contracts/${id}?toast=cancelled`);
  } catch (e) {
    await failFromError(e);
  }
}

export async function setRenewalStatus(formData: FormData) {
  try {
    const user = await requireStaff();
    assertCan(user, "contracts.manage");
    const org = user.organizationId;
    const id = String(formData.get("id"));
    const renewalStatus = String(formData.get("renewalStatus") ?? "");
    if (!RENEWAL_STATUS[renewalStatus]) throw new Error("حالة التجديد غير صالحة.");
    const c = await db.contract.findFirst({ where: { id, organizationId: org, ...propertyIdScope(user) } });
    if (!c) throw new Error("العقد غير موجود.");
    if (!OPEN_STATUSES.includes(c.status)) throw new Error("حالة التجديد متاحة للعقود النشطة فقط.");
    const status = computeContractStatus({ startDate: c.startDate, endDate: c.endDate, status: c.status, renewalStatus });
    await db.contract.update({ where: { id }, data: { renewalStatus, status } });
    await audit({ user, action: "STATUS_CHANGE", entityType: "CONTRACT", entityId: id, entityLabel: c.code, oldValue: { renewalStatus: c.renewalStatus, status: c.status }, newValue: { renewalStatus, status } });
    if (renewalStatus === "NO_RENEWAL") {
      await autoTask({
        organizationId: org,
        title: `تجهيز الوحدة للتأجير بعد انتهاء العقد ${c.code}`,
        description: `المستأجر لا يرغب بالتجديد. ينتهي العقد خلال ${daysFromToday(c.endDate)} يومًا.`,
        assignee: "leasing.manage",
        priority: "HIGH",
        dueDate: addDays(c.endDate, -14),
        entityType: "CONTRACT",
        entityId: id,
        entityLabel: c.code,
      });
    }
    revalidatePath(`/contracts/${id}`);
  } catch (e) {
    await failFromError(e);
  }
}

/** Creates a follow-on contract (12 months by default) and marks the current one RENEWED once active. */
export async function renewContract(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await requireStaff();
    assertCan(user, "contracts.manage");
    const org = user.organizationId;
    const id = String(formData.get("id"));
    const canApprove = can(user, "contracts.approve");
    const old = await db.contract.findFirst({ where: { id, organizationId: org, ...propertyIdScope(user) }, include: { tenant: { select: { name: true } } } });
    if (!old) return { error: "العقد غير موجود." };
    if (!OPEN_STATUSES.includes(old.status) && old.status !== "EXPIRED") return { error: "يمكن تجديد العقود النشطة أو المنتهية فقط." };
    const existing = await db.contract.findFirst({ where: { organizationId: org, renewedFromId: id, status: { notIn: ["CANCELLED"] } }, select: { code: true } });
    if (existing) return { error: `يوجد عقد تجديد مسجل بالفعل (${existing.code}).` };

    const months = Math.max(1, Math.min(120, Math.round(Number(formData.get("months") || 12))));
    // The form asks for the ANNUAL rent; the contract stores the total for the renewal term.
    const annualRaw = Number(formData.get("annualAmount") ?? formData.get("totalAmount"));
    const annual = annualRaw > 0 ? annualRaw : annualRent(old.totalAmount, contractMonths(old.startDate, old.endDate));
    const totalAmount = r2((annual * months) / 12);
    const frequency = String(formData.get("paymentFrequency") || old.paymentFrequency);
    if (!PAYMENT_FREQUENCY[frequency]) return { error: "دورية السداد غير صالحة." };
    const startRaw = String(formData.get("startDate") || "");
    const startDate = startRaw ? new Date(startRaw) : addDays(old.endDate, 1);
    if (Number.isNaN(startDate.getTime())) return { error: "تاريخ بداية التجديد غير صالح." };
    startDate.setTime(startOfDay(startDate).getTime());
    if (startDate <= old.endDate) return { error: `يبدأ عقد التجديد بعد انتهاء العقد الحالي (${inputDate(old.endDate)}). عدّل تاريخ البداية.` };
    const endDate = addDays(addMonths(startDate, months), -1);
    const installmentsCount = scheduleCount(months, frequency, Number(formData.get("installmentsCount") || old.installmentsCount));
    const overlap = await findOverlap(org, old.unitId, startDate, endDate, id);
    if (overlap) return { error: `الوحدة مرتبطة بعقد آخر (${overlap.code}) يتداخل مع فترة التجديد (BR-001).` };

    try {
      const code = await nextCode(org, "contract");
      const status = canApprove ? "ACTIVE" : "PENDING_APPROVAL";
      const c = await db.contract.create({
        data: {
          organizationId: org,
          code,
          propertyId: old.propertyId,
          unitId: old.unitId,
          tenantId: old.tenantId,
          ownerId: old.ownerId,
          startDate,
          endDate,
          totalAmount,
          managementFeePct: old.managementFeePct,
          vatAmount: Number(formData.get("vatAmount") || old.vatAmount) || 0,
          paymentFrequency: frequency,
          installmentsCount,
          status,
          renewedFromId: old.id,
          notes: `تجديد للعقد ${old.code}`,
          createdById: user.id,
        },
      });
      await audit({ user, action: "CREATE", entityType: "CONTRACT", entityId: c.id, entityLabel: c.code, newValue: { renewedFrom: old.code, startDate, endDate, totalAmount, frequency } });
      if (status === "ACTIVE") {
        await activateInternal(user, c.id);
        await audit({ user, action: "STATUS_CHANGE", entityType: "CONTRACT", entityId: old.id, entityLabel: old.code, oldValue: { status: old.status }, newValue: { status: "RENEWED", renewedBy: c.code } });
      } else {
        await db.contract.update({ where: { id: old.id }, data: { renewalStatus: "APPROVED", status: computeContractStatus({ ...old, renewalStatus: "APPROVED" }) } });
        await notify({ organizationId: org, owners: true, title: `تجديد بانتظار الاعتماد: ${c.code} — ${old.tenant.name}`, body: `${Math.round(totalAmount)} ر.س · ${months} شهر`, severity: "WARNING", entityType: "CONTRACT", entityId: c.id, href: `/contracts/${c.id}` });
      }
      await db.task.updateMany({ where: { organizationId: org, entityType: "CONTRACT", entityId: old.id, isAutomated: true, status: { notIn: ["COMPLETED", "CANCELLED"] } }, data: { status: "COMPLETED", completedAt: new Date() } });
      revalidatePath("/contracts");
      redirect(`/contracts/${c.id}?toast=created`);
    } catch (e) {
      if (isRedirect(e)) throw e;
      return { error: userMessage(e, "تعذر إنشاء عقد التجديد حاليًا.") };
    }
  } catch (e) {
    return actionFailure(e);
  }
}

/** BR-002: termination is blocked while installments due to date are unpaid, unless overridden by contracts.approve with a reason. */
export async function terminateContract(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await requireStaff();
    assertCan(user, "contracts.manage");
    const org = user.organizationId;
    const id = String(formData.get("id"));
    const reason = String(formData.get("reason") ?? "").trim();
    const finalSettlement = String(formData.get("finalSettlement") ?? "").trim() || null;
    const override = formData.get("override") === "on";
    const overrideReason = String(formData.get("overrideReason") ?? "").trim();
    const dateRaw = String(formData.get("terminationDate") || "");
    const terminationDate = dateRaw ? new Date(dateRaw) : new Date();
    if (Number.isNaN(terminationDate.getTime())) return { error: "تاريخ الإنهاء غير صالح." };
    terminationDate.setTime(endOfDay(terminationDate).getTime());
    if (!reason) return { error: "سبب الإنهاء مطلوب." };

    const c = await db.contract.findFirst({ where: { id, organizationId: org, ...propertyIdScope(user) }, include: { installments: { include: { collectionCase: { select: { id: true } } } }, tenant: { select: { name: true } }, unit: { select: { number: true } } } });
    if (!c) return { error: "العقد غير موجود." };
    if (!OPEN_STATUSES.includes(c.status) && c.status !== "EXPIRED" && c.status !== "RENEWED") return { error: "يمكن إنهاء العقود النشطة فقط." };
    // A renewal that already started is the running contract now; a renewal not yet active is cancelled with this termination.
    const renewal = await db.contract.findFirst({ where: { organizationId: org, renewedFromId: id, status: { notIn: ["CANCELLED", "TERMINATED"] } }, select: { id: true, code: true, status: true } });
    if (renewal && !["DRAFT", "PENDING_APPROVAL"].includes(renewal.status)) return { error: `هذا العقد مجدد بالعقد ${renewal.code}. أنهِ عقد التجديد بدلًا منه.` };

    const unpaid = c.installments.filter((i) => i.status !== "PAID" && i.status !== "WAIVED" && i.amount - i.paidAmount > 0.01);
    const blocking = unpaid.filter((i) => i.dueDate <= terminationDate);
    const blockedAmount = blocking.reduce((s, i) => s + i.amount - i.paidAmount, 0);
    if (blocking.length > 0) {
      if (!override) return { error: `يوجد ${blocking.length} قسط غير مسدد بقيمة ${Math.round(blockedAmount)} ر.س. لا يمكن إنهاء العقد قبل السداد (BR-002).` };
      if (!can(user, "contracts.approve")) return { error: "تجاوز قاعدة BR-002 يتطلب صلاحية اعتماد العقود." };
      if (!overrideReason) return { error: "أدخل سبب تجاوز الأقساط غير المسددة." };
    }

    // Only installments falling after the termination date are waived. Amounts due on/before it (the BR-002 override case)
    // remain claimable: their status and open collection cases are untouched.
    const toWaive = unpaid.filter((i) => i.dueDate > terminationDate);
    const waivedAmount = r2(toWaive.reduce((s, i) => s + i.amount - i.paidAmount, 0));

    await db.$transaction(async (tx) => {
      await tx.contract.update({ where: { id }, data: { status: "TERMINATED", terminationDate, terminationReason: reason, finalSettlement } });
      if (toWaive.length) {
        // amount drops to what was paid; the forgiven part is kept in waivedAmount.
        for (const i of toWaive) {
          await tx.installment.update({ where: { id: i.id }, data: { status: "WAIVED", amount: i.paidAmount, waivedAmount: r2(i.waivedAmount + i.amount - i.paidAmount), waivedReason: "إنهاء العقد", waivedById: user.id } });
        }
        const caseIds = toWaive.map((i) => i.collectionCase?.id).filter((x): x is string => Boolean(x));
        if (caseIds.length) await tx.collectionCase.updateMany({ where: { id: { in: caseIds } }, data: { followUpStatus: "CLOSED", priority: 0 } });
        await tx.task.updateMany({ where: { organizationId: org, entityType: "INSTALLMENT", entityId: { in: toWaive.map((i) => i.id) }, status: { notIn: ["COMPLETED", "CANCELLED"] } }, data: { status: "CANCELLED" } });
      }
      if (renewal) await tx.contract.update({ where: { id: renewal.id }, data: { status: "CANCELLED", notes: `أُلغي مع إنهاء العقد ${c.code}` } });
      await tx.unit.update({ where: { id: c.unitId }, data: { status: "VACANT", currentRent: null } });
      await tx.task.updateMany({ where: { organizationId: org, entityType: "CONTRACT", entityId: id, isAutomated: true, status: { notIn: ["COMPLETED", "CANCELLED"] } }, data: { status: "CANCELLED" } });
    });
    await audit({
      user,
      action: "STATUS_CHANGE",
      entityType: "CONTRACT",
      entityId: id,
      entityLabel: c.code,
      oldValue: { status: c.status },
      newValue: { status: "TERMINATED", terminationDate, reason, finalSettlement, waivedInstallments: toWaive.length, waivedAmount, keptUnpaidInstallments: blocking.length, keptUnpaidAmount: r2(blockedAmount) },
    });
    if (blocking.length > 0) {
      await audit({ user, action: "APPROVE", entityType: "CONTRACT", entityId: id, entityLabel: c.code, oldValue: { unpaidInstallments: blocking.length, unpaidAmount: blockedAmount }, newValue: { override: "BR-002", reason: overrideReason } });
    }
    await autoTask({
      organizationId: org,
      title: `وحدة شاغرة بعد إنهاء العقد — ${c.unit.number}`,
      description: `أُنهي العقد ${c.code} للمستأجر ${c.tenant.name}. السبب: ${reason}`,
      assignee: "leasing.manage",
      priority: "HIGH",
      entityType: "UNIT",
      entityId: c.unitId,
      entityLabel: c.unit.number,
    });
    await notify({ organizationId: org, owners: true, audience: ["statements.manage"], title: `تم إنهاء العقد ${c.code} — ${c.tenant.name}`, body: reason, severity: "WARNING", entityType: "CONTRACT", entityId: id, href: `/contracts/${id}` });
    revalidatePath(`/contracts/${id}`);
    revalidatePath("/contracts");
    redirect(`/contracts/${id}?toast=updated`);
  } catch (e) {
    return actionFailure(e);
  }
}

function isRedirect(e: unknown) {
  return typeof e === "object" && e !== null && "digest" in e && String((e as { digest?: string }).digest).startsWith("NEXT_REDIRECT");
}
