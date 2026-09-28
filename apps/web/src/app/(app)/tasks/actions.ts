"use server";


import { actionFailure, failFromError } from "@/lib/action-error";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireStaff, type SessionUser } from "@/lib/auth";
import { assertCan } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { TASK_STATUS, TASK_PRIORITY } from "@/lib/constants";
import { safeJson } from "@/lib/format";
import type { FormState } from "@/components/ui";

type StaffUser = SessionUser & { organizationId: string };
type ChecklistItem = { text: string; done: boolean };

const schema = z.object({
  title: z.string().min(2, "عنوان المهمة مطلوب"),
  description: z.string().optional().nullable(),
  assignedToId: z.string().optional().nullable(),
  priority: z.string().min(1).default("MEDIUM"),
  dueDate: z.string().optional().nullable(),
  entityType: z.string().optional().nullable(),
  entityId: z.string().optional().nullable(),
  entityLabel: z.string().optional().nullable(),
  tags: z.string().optional().default(""),
  checklist: z.string().optional().default("[]"),
});

function parse(formData: FormData) {
  const raw: Record<string, unknown> = {};
  formData.forEach((v, k) => {
    if (k === "id" || k.startsWith("check_")) return;
    raw[k] = v === "" ? null : v;
  });
  // checklist rows arrive as check_<i>
  const items: ChecklistItem[] = [];
  formData.forEach((v, k) => {
    if (k.startsWith("check_") && String(v).trim()) items.push({ text: String(v).trim(), done: false });
  });
  const existing = safeJson<ChecklistItem[]>(String(formData.get("checklist") ?? "[]"), []);
  raw.checklist = JSON.stringify(items.map((it) => ({ ...it, done: existing.find((e) => e.text === it.text)?.done ?? false })));
  raw.tags = raw.tags ?? "";
  if (!TASK_PRIORITY[String(raw.priority ?? "MEDIUM")]) raw.priority = "MEDIUM";
  return schema.safeParse(raw);
}

async function loadTask(user: StaffUser, id: string) {
  return db.task.findFirst({ where: { id, organizationId: user.organizationId }, include: { assignedTo: { select: { id: true, name: true } } } });
}

async function assertAssignee(user: StaffUser, assignedToId: string | null | undefined) {
  if (!assignedToId) return null;
  const u = await db.user.findFirst({ where: { id: assignedToId, organizationId: user.organizationId, status: "ACTIVE" }, select: { id: true, name: true } });
  return u ?? undefined;
}

export async function createTask(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await requireStaff();
    assertCan(user, "tasks.manage");
    const parsed = parse(formData);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;
    const assignee = await assertAssignee(user, d.assignedToId);
    if (assignee === undefined) return { error: "الموظف المحدد غير موجود." };
    const t = await db.task.create({
      data: {
        organizationId: user.organizationId,
        title: d.title,
        description: d.description ?? null,
        assignedToId: assignee?.id ?? null,
        createdById: user.id,
        priority: d.priority,
        status: assignee ? "ASSIGNED" : "NEW",
        dueDate: d.dueDate ? new Date(d.dueDate) : null,
        entityType: d.entityType ?? null,
        entityId: d.entityId ?? null,
        entityLabel: d.entityLabel ?? null,
        tags: d.tags,
        checklist: d.checklist,
        isAutomated: false,
      },
    });
    await audit({ user, action: "CREATE", entityType: "TASK", entityId: t.id, entityLabel: t.title, newValue: { ...d, status: t.status } });
    if (assignee && assignee.id !== user.id) {
      await notify({
        organizationId: user.organizationId,
        userIds: [assignee.id],
        title: `مهمة جديدة: ${t.title}`,
        body: d.dueDate ? `الاستحقاق ${d.dueDate} · الأولوية ${TASK_PRIORITY[d.priority].label}` : `الأولوية ${TASK_PRIORITY[d.priority].label}`,
        severity: d.priority === "URGENT" ? "WARNING" : "INFO",
        entityType: "TASK",
        entityId: t.id,
        href: `/tasks/${t.id}`,
      });
    }
    revalidatePath("/tasks");
    redirect(`/tasks/${t.id}?toast=created`);
  } catch (e) {
    return actionFailure(e);
  }
}

export async function updateTask(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await requireStaff();
    assertCan(user, "tasks.manage");
    const id = String(formData.get("id"));
    const parsed = parse(formData);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;
    const old = await loadTask(user, id);
    if (!old) return { error: "المهمة غير موجودة." };
    if (["COMPLETED", "CANCELLED"].includes(old.status)) return { error: "لا يمكن تعديل مهمة منجزة أو ملغاة. أعد فتحها أولًا." };
    const assignee = await assertAssignee(user, d.assignedToId);
    if (assignee === undefined) return { error: "الموظف المحدد غير موجود." };
    const status = old.status === "NEW" && assignee ? "ASSIGNED" : !assignee && old.status === "ASSIGNED" ? "NEW" : old.status;
    await db.task.update({
      where: { id },
      data: {
        title: d.title,
        description: d.description ?? null,
        assignedToId: assignee?.id ?? null,
        priority: d.priority,
        status,
        dueDate: d.dueDate ? new Date(d.dueDate) : null,
        entityType: d.entityType ?? null,
        entityId: d.entityId ?? null,
        entityLabel: d.entityLabel ?? null,
        tags: d.tags,
        checklist: d.checklist,
      },
    });
    await audit({ user, action: "UPDATE", entityType: "TASK", entityId: id, entityLabel: d.title, oldValue: { title: old.title, assignedToId: old.assignedToId, priority: old.priority, dueDate: old.dueDate, status: old.status }, newValue: { ...d, status } });
    if (assignee && assignee.id !== old.assignedToId && assignee.id !== user.id) {
      await notify({ organizationId: user.organizationId, userIds: [assignee.id], title: `أُسندت إليك مهمة: ${d.title}`, entityType: "TASK", entityId: id, href: `/tasks/${id}` });
    }
    revalidatePath(`/tasks/${id}`);
    revalidatePath("/tasks");
    redirect(`/tasks/${id}?toast=updated`);
  } catch (e) {
    return actionFailure(e);
  }
}

const TRANSITIONS: Record<string, string[]> = {
  NEW: ["IN_PROGRESS", "ASSIGNED", "COMPLETED", "CANCELLED"],
  ASSIGNED: ["IN_PROGRESS", "WAITING", "COMPLETED", "CANCELLED"],
  IN_PROGRESS: ["WAITING", "COMPLETED", "CANCELLED"],
  WAITING: ["IN_PROGRESS", "COMPLETED", "CANCELLED"],
  COMPLETED: ["IN_PROGRESS"],
  CANCELLED: ["IN_PROGRESS"],
};

export async function setTaskStatus(formData: FormData) {
  try {
    const user = await requireStaff();
    assertCan(user, "tasks.manage");
    const id = String(formData.get("id"));
    const next = String(formData.get("status"));
    const t = await loadTask(user, id);
    if (!t) throw new Error("المهمة غير موجودة.");
    if (!TASK_STATUS[next] || next === "OVERDUE") throw new Error("الحالة غير صحيحة.");
    if (!(TRANSITIONS[t.status] ?? []).includes(next)) throw new Error(`لا يمكن الانتقال من «${TASK_STATUS[t.status]?.label ?? t.status}» إلى «${TASK_STATUS[next].label}».`);
    const reopened = ["COMPLETED", "CANCELLED"].includes(t.status);
    const status = reopened ? (t.assignedToId ? "IN_PROGRESS" : "NEW") : next;
    await db.task.update({ where: { id }, data: { status, completedAt: status === "COMPLETED" ? new Date() : reopened ? null : t.completedAt } });
    await audit({ user, action: "STATUS_CHANGE", entityType: "TASK", entityId: id, entityLabel: t.title, oldValue: { status: t.status }, newValue: { status } });
    if (t.createdById && t.createdById !== user.id && ["COMPLETED", "CANCELLED"].includes(status)) {
      await notify({ organizationId: user.organizationId, userIds: [t.createdById], title: `المهمة «${t.title}» ${TASK_STATUS[status].label}`, severity: status === "COMPLETED" ? "SUCCESS" : "WARNING", entityType: "TASK", entityId: id, href: `/tasks/${id}` });
    }
    revalidatePath(`/tasks/${id}`);
    revalidatePath("/tasks");
  } catch (e) {
    await failFromError(e);
  }
}

export async function toggleChecklist(formData: FormData) {
  try {
    const user = await requireStaff();
    assertCan(user, "tasks.manage");
    const id = String(formData.get("id"));
    const index = Number(formData.get("index"));
    const t = await loadTask(user, id);
    if (!t) throw new Error("المهمة غير موجودة.");
    const items = safeJson<ChecklistItem[]>(t.checklist, []);
    if (!items[index]) return;
    items[index] = { ...items[index], done: !items[index].done };
    await db.task.update({ where: { id }, data: { checklist: JSON.stringify(items) } });
    await audit({ user, action: "UPDATE", entityType: "TASK", entityId: id, entityLabel: `${t.title} — بند: ${items[index].text}`, newValue: { index, done: items[index].done } });
    revalidatePath(`/tasks/${id}`);
  } catch (e) {
    await failFromError(e);
  }
}

export async function reassignTask(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await requireStaff();
    assertCan(user, "tasks.manage");
    const id = String(formData.get("id"));
    const assignedToId = String(formData.get("assignedToId") ?? "") || null;
    const t = await loadTask(user, id);
    if (!t) return { error: "المهمة غير موجودة." };
    if (["COMPLETED", "CANCELLED"].includes(t.status)) return { error: "لا يمكن إعادة إسناد مهمة منجزة أو ملغاة." };
    const assignee = await assertAssignee(user, assignedToId);
    if (assignee === undefined) return { error: "الموظف المحدد غير موجود." };
    const status = t.status === "NEW" && assignee ? "ASSIGNED" : !assignee && t.status === "ASSIGNED" ? "NEW" : t.status;
    await db.task.update({ where: { id }, data: { assignedToId: assignee?.id ?? null, status } });
    await audit({ user, action: "UPDATE", entityType: "TASK", entityId: id, entityLabel: `${t.title} — إعادة إسناد`, oldValue: { assignedToId: t.assignedToId, assignedTo: t.assignedTo?.name }, newValue: { assignedToId: assignee?.id ?? null, assignedTo: assignee?.name ?? null } });
    if (assignee && assignee.id !== t.assignedToId && assignee.id !== user.id) {
      await notify({ organizationId: user.organizationId, userIds: [assignee.id], title: `أُسندت إليك مهمة: ${t.title}`, entityType: "TASK", entityId: id, href: `/tasks/${id}` });
    }
    revalidatePath(`/tasks/${id}`);
    revalidatePath("/tasks");
    return { success: "تم تحديث الإسناد." };
  } catch (e) {
    return actionFailure(e);
  }
}

/** Comments are stored as audit entries (activity), the task body stays untouched. */
export async function addTaskComment(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await requireStaff();
    assertCan(user, "tasks.view");
    const id = String(formData.get("id"));
    const comment = String(formData.get("comment") ?? "").trim();
    if (comment.length < 2) return { error: "اكتب تعليقًا قبل الإرسال." };
    const t = await loadTask(user, id);
    if (!t) return { error: "المهمة غير موجودة." };
    await audit({ user, action: "UPDATE", entityType: "TASK", entityId: id, entityLabel: `${t.title} — تعليق`, newValue: { comment } });
    const targets = [t.assignedToId, t.createdById].filter((x): x is string => Boolean(x) && x !== user.id);
    if (targets.length) {
      await notify({ organizationId: user.organizationId, userIds: [...new Set(targets)], title: `تعليق جديد على «${t.title}»`, body: comment.slice(0, 140), entityType: "TASK", entityId: id, href: `/tasks/${id}` });
    }
    revalidatePath(`/tasks/${id}`);
    return { success: "تمت إضافة التعليق." };
  } catch (e) {
    return actionFailure(e);
  }
}
