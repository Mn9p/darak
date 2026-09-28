"use server";


import { failFromError } from "@/lib/action-error";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireTenant } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import type { FormState } from "@/components/ui";
import { getTenantContract, ACTIVE_CONTRACT_STATUSES } from "./_scope";

export async function markNotificationRead(formData: FormData) {
  try {
    const user = await requireTenant();
    const id = String(formData.get("id") ?? "");
    await db.notification.updateMany({ where: { id, userId: user.id, organizationId: user.organizationId, readAt: null }, data: { readAt: new Date() } });
    revalidatePath("/tenant/notifications");
  } catch (e) {
    await failFromError(e);
  }
}

export async function markAllNotificationsRead() {
  const user = await requireTenant();
  await db.notification.updateMany({ where: { userId: user.id, organizationId: user.organizationId, readAt: null }, data: { readAt: new Date() } });
  revalidatePath("/tenant/notifications");
}
