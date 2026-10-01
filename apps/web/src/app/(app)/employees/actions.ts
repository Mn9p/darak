"use server";

import { actionFailure, failFromError } from "@/lib/action-error";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireStaff, type SessionUser } from "@/lib/auth";
import { assertCan, normalizePermissions, type Permission } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { STAFF_ROLES, USER_STATUS, ROLES } from "@/lib/constants";
import { normalizePhone } from "@/lib/phone";
import type { FormState } from "@/components/ui";

// Team management (فريق العمل). Only account owners hold employees.manage (an owner-only permission).

type StaffUser = SessionUser & { organizationId: string };

const PHONE_ERROR = "رقم الجوال غير صحيح (مثال: 05XXXXXXXX).";
const PHONE_TAKEN = "هذا الرقم مستخدم لحساب آخر.";
const LAST_OWNER = "يجب أن يبقى صاحب حساب واحد نشط على الأقل. أضف صاحب حساب آخر أولًا.";
const NO_PROPERTIES = "اختر عقارًا واحدًا على الأقل، أو امنحه الوصول إلى كل العقارات.";

const schema = z.object({
  name: z.string().trim().min(2, "اسم العضو مطلوب"),
  // Login identity: stored normalized (9665XXXXXXXX) so the OTP sign-in matches exactly.
  phone: z
    .string({ required_error: PHONE_ERROR, invalid_type_error: PHONE_ERROR })
    .transform((v, ctx) => {
      const n = normalizePhone(v);
      if (!n) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: PHONE_ERROR });
        return z.NEVER;
      }
      return n;
    }),
  email: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v, ctx) => {
      if (!v) return null;
      const e = v.toLowerCase();
      if (!z.string().email().safeParse(e).success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "البريد الإلكتروني غير صحيح" });
        return z.NEVER;
      }
      return e;
    }),
  role: z.string().refine((r) => (STAFF_ROLES as string[]).includes(r), "اختر الدور: صاحب الحساب أو موظف"),
  branchId: z.string().optional().nullable(),
  department: z.string().optional().nullable(),
  jobTitle: z.string().optional().nullable(),
  employeeCode: z.string().optional().nullable(),
  managerId: z.string().optional().nullable(),
  status: z.string().refine((s) => Boolean(USER_STATUS[s]), "الحالة غير صحيحة").default("ACTIVE"),
});

function parse(formData: FormData) {
  const raw: Record<string, unknown> = {};
  formData.forEach((v, k) => {
    if (["id", "propertyIds", "prefChannels", "prefEvents", "permissions", "access"].includes(k)) return;
    raw[k] = v === "" ? null : v;
  });
  raw.status = raw.status ?? "ACTIVE";
  return schema.safeParse(raw);
}

/**
 * Access from the form. Owners: everything, nothing stored. Employees: the checked permissions (normalized — implied
 * views added, owner-only ones dropped) and either all properties or only the checked ones.
 */
function parseAccess(role: string, formData: FormData): { permissions: Permission[]; allProperties: boolean } {
  if (role !== "EMPLOYEE") return { permissions: [], allProperties: true };
  return { permissions: normalizePermissions(formData.getAll("permissions").map(String)), allProperties: formData.get("access") !== "selected" };
}

function parsePreferences(formData: FormData) {
  const channels = formData.getAll("prefChannels").map(String);
  const events = formData.getAll("prefEvents").map(String);
  return JSON.stringify({ channels, events });
}

async function validPropertyIds(org: string, formData: FormData) {
  const ids = [...new Set(formData.getAll("propertyIds").map(String).filter(Boolean))];
  if (!ids.length) return [];
  const rows = await db.property.findMany({ where: { organizationId: org, id: { in: ids } }, select: { id: true } });
  return rows.map((r) => r.id);
}

async function validRefs(user: StaffUser, branchId: string | null | undefined, managerId: string | null | undefined, selfId?: string) {
  if (branchId) {
    const b = await db.branch.findFirst({ where: { id: branchId, organizationId: user.organizationId }, select: { id: true } });
    if (!b) return "الفرع المحدد غير موجود.";
  }
  if (managerId) {
    if (managerId === selfId) return "لا يمكن أن يكون العضو مديرًا لنفسه.";
    const m = await db.user.findFirst({ where: { id: managerId, organizationId: user.organizationId, role: { in: STAFF_ROLES } }, select: { id: true } });
    if (!m) return "المدير المباشر المحدد غير موجود.";
  }
  return null;
}

/** Active account owners other than `exceptId` — an office always keeps at least one. */
async function otherActiveOwners(org: string, exceptId: string) {
  return db.user.count({ where: { organizationId: org, role: "ACCOUNT_OWNER", status: "ACTIVE", id: { not: exceptId } } });
}

async function seatsLeft(org: string) {
  const [orgRow, staffCount] = await Promise.all([
    db.organization.findUnique({ where: { id: org }, select: { usersLimit: true } }),
    db.user.count({ where: { organizationId: org, role: { in: STAFF_ROLES }, status: { not: "INACTIVE" } } }),
  ]);
  return { limit: orgRow?.usersLimit ?? Infinity, full: Boolean(orgRow && staffCount >= orgRow.usersLimit) };
}

async function loadMember(user: StaffUser, id: string) {
  return db.user.findFirst({ where: { id, organizationId: user.organizationId, role: { in: STAFF_ROLES } }, include: { assignments: { select: { propertyId: true } } } });
}

export async function createEmployee(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await requireStaff();
    assertCan(user, "employees.manage");
    const parsed = parse(formData);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;
    const org = user.organizationId;

    const [seats, phoneTaken] = await Promise.all([seatsLeft(org), db.user.findUnique({ where: { phone: d.phone }, select: { id: true } })]);
    if (seats.full) return { error: `وصلت لحد المستخدمين في باقتك (${seats.limit}). عطّل عضوًا أو قم بترقية الباقة.` };
    if (phoneTaken) return { error: PHONE_TAKEN };
    const refErr = await validRefs(user, d.branchId, d.managerId);
    if (refErr) return { error: refErr };
    const access = parseAccess(d.role, formData);
    const propertyIds = access.allProperties ? [] : await validPropertyIds(org, formData);
    if (!access.allProperties && propertyIds.length === 0) return { error: NO_PROPERTIES };

    const u = await db.user.create({
      data: {
        organizationId: org,
        name: d.name,
        phone: d.phone,
        email: d.email,
        role: d.role,
        permissions: JSON.stringify(access.permissions),
        allProperties: access.allProperties,
        status: d.status,
        branchId: d.branchId ?? null,
        department: d.department ?? null,
        jobTitle: d.jobTitle ?? null,
        employeeCode: d.employeeCode ?? null,
        managerId: d.managerId ?? null,
        preferences: parsePreferences(formData),
        assignments: { create: propertyIds.map((propertyId) => ({ propertyId })) },
      },
    });
    await audit({ user, action: "CREATE", entityType: "USER", entityId: u.id, entityLabel: u.name, newValue: { ...d, ...access, propertyIds } });
    if (d.managerId && d.managerId !== user.id) {
      await notify({ organizationId: org, userIds: [d.managerId], title: `انضم ${d.name} إلى الفريق`, body: `${ROLES[d.role as keyof typeof ROLES]?.label ?? d.role}${d.jobTitle ? ` · ${d.jobTitle}` : ""}`, entityType: "USER", entityId: u.id, href: `/employees/${u.id}` });
    }
    revalidatePath("/employees");
    redirect(`/employees/${u.id}?toast=created`);
  } catch (e) {
    return actionFailure(e);
  }
}

export async function updateEmployee(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await requireStaff();
    assertCan(user, "employees.manage");
    const id = String(formData.get("id"));
    const parsed = parse(formData);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;
    const org = user.organizationId;
    const old = await loadMember(user, id);
    if (!old) return { error: "العضو غير موجود." };

    const access = parseAccess(d.role, formData);
    const oldPermissions = old.role === "EMPLOYEE" ? normalizePermissions(old.permissions) : [];
    const accessChanged = d.role !== old.role || access.allProperties !== old.allProperties || access.permissions.join(",") !== oldPermissions.join(",");
    if (old.id === user.id && (accessChanged || d.status !== "ACTIVE")) return { error: "لا يمكنك تغيير دورك أو صلاحياتك أو تعطيل حسابك بنفسك." };
    const leavesOwnership = old.role === "ACCOUNT_OWNER" && old.status === "ACTIVE" && (d.role !== "ACCOUNT_OWNER" || d.status !== "ACTIVE");
    if (leavesOwnership && (await otherActiveOwners(org, id)) === 0) return { error: LAST_OWNER };
    if (old.status === "INACTIVE" && d.status !== "INACTIVE" && (await seatsLeft(org)).full) return { error: "وصلت لحد المستخدمين في باقتك." };
    if (d.phone !== old.phone) {
      const taken = await db.user.findUnique({ where: { phone: d.phone }, select: { id: true } });
      if (taken) return { error: PHONE_TAKEN };
    }
    const refErr = await validRefs(user, d.branchId, d.managerId, id);
    if (refErr) return { error: refErr };
    const propertyIds = access.allProperties ? [] : await validPropertyIds(org, formData);
    if (!access.allProperties && propertyIds.length === 0) return { error: NO_PROPERTIES };
    const oldIds = old.assignments.map((a) => a.propertyId).sort();
    const newIds = [...propertyIds].sort();
    const assignmentsChanged = oldIds.join(",") !== newIds.join(",");

    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          name: d.name,
          phone: d.phone,
          email: d.email,
          role: d.role,
          permissions: JSON.stringify(access.permissions),
          allProperties: access.allProperties,
          status: d.status,
          branchId: d.branchId ?? null,
          department: d.department ?? null,
          jobTitle: d.jobTitle ?? null,
          employeeCode: d.employeeCode ?? null,
          managerId: d.managerId ?? null,
          preferences: parsePreferences(formData),
        },
      });
      if (assignmentsChanged) {
        await tx.propertyAssignment.deleteMany({ where: { userId: id } });
        if (newIds.length) await tx.propertyAssignment.createMany({ data: newIds.map((propertyId) => ({ userId: id, propertyId })) });
      }
      // A new login number or a disabled account ends every open session.
      if ((d.status === "INACTIVE" && old.status !== "INACTIVE") || d.phone !== old.phone) {
        await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      }
    });

    await audit({ user, action: "UPDATE", entityType: "USER", entityId: id, entityLabel: d.name, oldValue: { name: old.name, phone: old.phone, email: old.email, status: old.status, branchId: old.branchId, department: old.department, jobTitle: old.jobTitle, managerId: old.managerId }, newValue: { ...d } });
    if (accessChanged || assignmentsChanged) {
      await audit({
        user,
        action: "PERMISSION_CHANGE",
        entityType: "USER",
        entityId: id,
        entityLabel: d.name,
        oldValue: { role: old.role, permissions: oldPermissions, allProperties: old.allProperties, propertyIds: oldIds },
        newValue: { role: d.role, permissions: access.permissions, allProperties: access.allProperties, propertyIds: newIds },
      });
      await notify({ organizationId: org, userIds: [id], title: "تم تحديث صلاحياتك", body: `عدّلها ${user.name}. تظهر الأقسام المتاحة لك في القائمة مباشرة.`, entityType: "USER", entityId: id });
    }
    revalidatePath(`/employees/${id}`);
    revalidatePath("/employees");
    redirect(`/employees/${id}?toast=updated`);
  } catch (e) {
    return actionFailure(e);
  }
}

export async function deactivateEmployee(formData: FormData) {
  try {
    const user = await requireStaff();
    assertCan(user, "employees.manage");
    const id = String(formData.get("id"));
    if (id === user.id) throw new Error("لا يمكنك تعطيل حسابك بنفسك.");
    const e = await loadMember(user, id);
    if (!e) return;
    if (e.role === "ACCOUNT_OWNER" && (await otherActiveOwners(user.organizationId, id)) === 0) throw new Error(LAST_OWNER);
    await db.$transaction([
      db.user.update({ where: { id }, data: { status: "INACTIVE" } }),
      db.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await audit({ user, action: "UPDATE", entityType: "USER", entityId: id, entityLabel: e.name, oldValue: { status: e.status }, newValue: { status: "INACTIVE" } });
    revalidatePath(`/employees/${id}`);
    revalidatePath("/employees");
  } catch (e) {
    await failFromError(e);
  }
}

export async function activateEmployee(formData: FormData) {
  try {
    const user = await requireStaff();
    assertCan(user, "employees.manage");
    const id = String(formData.get("id"));
    const e = await loadMember(user, id);
    if (!e || e.status === "ACTIVE") return;
    const seats = await seatsLeft(user.organizationId);
    if (seats.full) throw new Error(`وصلت لحد المستخدمين في باقتك (${seats.limit}).`);
    await db.user.update({ where: { id }, data: { status: "ACTIVE" } });
    await audit({ user, action: "UPDATE", entityType: "USER", entityId: id, entityLabel: e.name, oldValue: { status: e.status }, newValue: { status: "ACTIVE" } });
    revalidatePath(`/employees/${id}`);
    revalidatePath("/employees");
  } catch (e) {
    await failFromError(e);
  }
}

export async function revokeSession(formData: FormData) {
  try {
    const user = await requireStaff();
    assertCan(user, "employees.manage");
    const sessionId = String(formData.get("sessionId"));
    const s = await db.session.findFirst({ where: { id: sessionId, user: { organizationId: user.organizationId } }, include: { user: { select: { id: true, name: true } } } });
    if (!s || s.revokedAt) return;
    await db.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
    await audit({ user, action: "UPDATE", entityType: "SESSION", entityId: sessionId, entityLabel: `إنهاء جلسة ${s.user.name}`, newValue: { userId: s.user.id, device: s.device, ip: s.ip } });
    revalidatePath(`/employees/${s.user.id}`);
  } catch (e) {
    await failFromError(e);
  }
}
