"use server";


import { actionFailure } from "@/lib/action-error";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { notify, emailOwners } from "@/lib/notify";
import type { FormState } from "@/components/ui";

const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"];

export async function createTicket(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await requireStaff();
    const subject = String(formData.get("subject") ?? "").trim();
    const body = String(formData.get("body") ?? "").trim();
    const priority = String(formData.get("priority") ?? "MEDIUM");
    if (subject.length < 4) return { error: "عنوان التذكرة مطلوب (4 أحرف على الأقل)." };
    if (body.length < 10) return { error: "يرجى وصف المشكلة أو الطلب بما لا يقل عن 10 أحرف." };
    if (!PRIORITIES.includes(priority)) return { error: "الأولوية غير صالحة." };
    const t = await db.supportTicket.create({
      data: { organizationId: user.organizationId, userId: user.id, subject: subject.slice(0, 180), body: body.slice(0, 4000), priority, status: "OPEN" },
    });
    await audit({ user, action: "CREATE", entityType: "SUPPORT_TICKET", entityId: t.id, entityLabel: t.subject, newValue: { priority } });
    await notify({
      organizationId: user.organizationId,
      owners: true,
      title: `تذكرة دعم جديدة: ${t.subject}`,
      body: `بواسطة ${user.name} · الأولوية ${priority}`,
      severity: priority === "URGENT" || priority === "HIGH" ? "WARNING" : "INFO",
      entityType: "SUPPORT_TICKET",
      entityId: t.id,
      href: "/help?tab=tickets",
    });
    // Email office managers (simulated + logged when no email provider). Never throws.
    await emailOwners({
      organizationId: user.organizationId,
      subject: `تذكرة دعم جديدة: ${t.subject}`,
      body: `تذكرة دعم جديدة من ${user.name} (الأولوية: ${priority}).\n\nالعنوان: ${t.subject}\n\n${t.body}\n\nللمتابعة: ${process.env.APP_URL ?? ""}/help?tab=tickets`,
      entityType: "SUPPORT_TICKET",
      entityId: t.id,
    });
    revalidatePath("/help");
    return { success: "تم إرسال التذكرة. سيتواصل معك فريق الدعم خلال ساعات العمل." };
  } catch (e) {
    return actionFailure(e);
  }
}
