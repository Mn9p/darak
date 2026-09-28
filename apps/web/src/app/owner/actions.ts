"use server";


import { actionFailure, failFromError } from "@/lib/action-error";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireOwner } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import type { FormState } from "@/components/ui";
import { getOwnerScope } from "./_scope";

/** Owner adds a comment on a statement → creates a support ticket for the office. */
export async function addStatementComment(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await requireOwner();
    const id = String(formData.get("id") ?? "");
    const comment = String(formData.get("comment") ?? "").trim();
    if (comment.length < 3) return { error: "يرجى كتابة الملاحظة قبل الإرسال." };
    const st = await db.ownerStatement.findFirst({ where: { id, organizationId: user.organizationId, ownerId: user.ownerId }, select: { id: true, code: true } });
    if (!st) return { error: "التسوية غير موجودة." };
    try {
      const t = await db.supportTicket.create({
        data: { organizationId: user.organizationId, userId: user.id, subject: `[مالك] ملاحظة على التسوية ${st.code}`, body: comment, status: "OPEN", priority: "MEDIUM" },
      });
      await audit({ user, action: "CREATE", entityType: "SUPPORT_TICKET", entityId: t.id, entityLabel: t.subject, newValue: { statementId: st.id, comment } });
      await notify({
        organizationId: user.organizationId,
        roles: ["OFFICE_MANAGER", "ACCOUNTANT"],
        title: `ملاحظة من المالك على التسوية ${st.code}`,
        body: comment.slice(0, 160),
        severity: "INFO",
        entityType: "STATEMENT",
        entityId: st.id,
        href: `/statements/${st.id}`,
      });
    } catch {
      return { error: "تعذر إرسال الملاحظة حاليًا. يرجى المحاولة لاحقًا." };
    }
    revalidatePath(`/owner/statements/${id}`);
    return { success: "تم إرسال ملاحظتك إلى المكتب وسيتم الرد عليها قريبًا." };
  } catch (e) {
    return actionFailure(e);
  }
}

export async function markNotificationRead(formData: FormData) {
  try {
    const user = await requireOwner();
    const id = String(formData.get("id") ?? "");
    await db.notification.updateMany({ where: { id, userId: user.id, organizationId: user.organizationId, readAt: null }, data: { readAt: new Date() } });
    revalidatePath("/owner/notifications");
  } catch (e) {
    await failFromError(e);
  }
}

export async function markAllNotificationsRead() {
  const user = await requireOwner();
  await db.notification.updateMany({ where: { userId: user.id, organizationId: user.organizationId, readAt: null }, data: { readAt: new Date() } });
  revalidatePath("/owner/notifications");
}
