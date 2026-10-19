"use server";

import { revalidatePath } from "next/cache";
import { failFromError } from "@/lib/action-error";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { isAccountOwner } from "@/lib/permissions";
import { audit } from "@/lib/audit";

/** Ends an assistant connection: its tokens stop working at the next request. Own connections, or any in the office for the owner. */
export async function revokeAiConnection(formData: FormData) {
  try {
    const user = await requireStaff();
    const id = String(formData.get("id"));
    const conn = await db.aiConnection.findFirst({ where: { id, organizationId: user.organizationId, revokedAt: null, ...(isAccountOwner(user) ? {} : { userId: user.id }) } });
    if (!conn) return;
    await db.aiConnection.update({ where: { id }, data: { revokedAt: new Date() } });
    await audit({ user, action: "DELETE", entityType: "AI_CONNECTION", entityId: id, entityLabel: conn.clientName, newValue: { revoked: true } });
    revalidatePath("/assistant");
  } catch (e) {
    await failFromError(e);
  }
}
