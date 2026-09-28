"use server";


import { failFromError } from "@/lib/action-error";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { assertCan } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { reportBySlug, reportAllowed } from "./queries";

/** Saves a scheduled report definition as a SavedView (module "reports"). Delivery itself is simulated in this build. */
export async function saveSchedule(formData: FormData): Promise<void> {
  try {
    const user = await requireStaff();
    assertCan(user, "reports.view");
    const slug = String(formData.get("slug") ?? "");
    const meta = reportBySlug(slug);
    if (!meta) throw new Error("التقرير غير موجود.");
    if (!reportAllowed(user, meta)) throw new Error("ليس لديك صلاحية هذا التقرير.");
    const frequency = String(formData.get("frequency") ?? "weekly");
    const period = String(formData.get("period") ?? "monthly");
    const recipients = String(formData.get("recipients") ?? "").trim();
    const channel = String(formData.get("channel") ?? "EMAIL");
    const name = String(formData.get("name") ?? "").trim() || `${meta.title} — ${frequency === "daily" ? "يومي" : frequency === "weekly" ? "أسبوعي" : "شهري"}`;
    const query = new URLSearchParams({ slug, frequency, period, channel, recipients }).toString();
    const v = await db.savedView.create({ data: { organizationId: user.organizationId, userId: user.id, module: "reports", name, query, isShared: formData.get("shared") === "on" } });
    await audit({ user, action: "CREATE", entityType: "REPORT", entityId: v.id, entityLabel: name, newValue: { slug, frequency, period, channel, recipients } });
    revalidatePath("/reports");
  } catch (e) {
    await failFromError(e);
  }
}

export async function deleteSchedule(formData: FormData): Promise<void> {
  try {
    const user = await requireStaff();
    assertCan(user, "reports.view");
    const id = String(formData.get("id"));
    const v = await db.savedView.findFirst({ where: { id, organizationId: user.organizationId, module: "reports" } });
    if (!v) return;
    if (v.userId !== user.id) assertCan(user, "settings.manage");
    await db.savedView.delete({ where: { id } });
    await audit({ user, action: "DELETE", entityType: "REPORT", entityId: id, entityLabel: v.name, oldValue: { query: v.query } });
    revalidatePath("/reports");
  } catch (e) {
    await failFromError(e);
  }
}
