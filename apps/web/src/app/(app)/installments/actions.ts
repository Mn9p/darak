"use server";


import { failFromError } from "@/lib/action-error";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { assertCan, contractScope } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";

/** Waives the unpaid remainder of an installment. Requires installments.waive and a reason. */
export async function waiveInstallment(formData: FormData) {
  try {
    const user = await requireStaff();
    assertCan(user, "installments.waive");
    const org = user.organizationId;
    const id = String(formData.get("id"));
    const reason = String(formData.get("reason") ?? "").trim();
    if (reason.length < 3) throw new Error("سبب الإعفاء مطلوب.");
    const inst = await db.installment.findFirst({
      where: { id, organizationId: org, ...contractScope(user) },
      include: { contract: { select: { code: true, createdById: true } }, tenant: { select: { name: true } }, collectionCase: { select: { id: true } } },
    });
    if (!inst) throw new Error("القسط غير موجود.");
    if (inst.status === "PAID") throw new Error("القسط مسدد بالكامل — لا حاجة للإعفاء.");
    if (inst.status === "WAIVED") throw new Error("القسط معفى بالفعل.");
    const remaining = inst.amount - inst.paidAmount;

    await db.$transaction(async (tx) => {
      // amount drops to what was paid; the forgiven part is kept in waivedAmount (a later bounced cheque re-opens only the paid part).
      await tx.installment.update({ where: { id }, data: { status: "WAIVED", amount: inst.paidAmount, waivedAmount: inst.waivedAmount + remaining, waivedReason: reason, waivedById: user.id } });
      if (inst.collectionCase) {
        await tx.collectionCase.update({ where: { id: inst.collectionCase.id }, data: { followUpStatus: "CLOSED", priority: 0 } });
        await tx.collectionAction.create({ data: { caseId: inst.collectionCase.id, type: "SYSTEM", note: `تم إعفاء القسط بواسطة ${user.name}: ${reason}`, byUserId: user.id } });
      }
      await tx.task.updateMany({ where: { organizationId: org, entityType: "INSTALLMENT", entityId: id, status: { notIn: ["COMPLETED", "CANCELLED"] } }, data: { status: "CANCELLED" } });
    });
    await audit({
      user,
      action: "APPROVE",
      entityType: "INSTALLMENT",
      entityId: id,
      entityLabel: `${inst.contract.code} / ${inst.seq}`,
      oldValue: { status: inst.status, remaining },
      newValue: { status: "WAIVED", waivedReason: reason, waivedAmount: remaining },
    });
    await notify({
      organizationId: org,
      roles: ["OFFICE_MANAGER"],
      title: `إعفاء قسط — ${inst.tenant.name}`,
      body: `القسط ${inst.seq} من العقد ${inst.contract.code} · ${Math.round(remaining)} ر.س · السبب: ${reason}`,
      severity: "WARNING",
      entityType: "INSTALLMENT",
      entityId: id,
      href: `/installments/${id}`,
    });
    revalidatePath(`/installments/${id}`);
    revalidatePath("/installments");
    revalidatePath(`/contracts/${inst.contractId}`);
  } catch (e) {
    await failFromError(e);
  }
}
