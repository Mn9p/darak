"use server";


import { failFromError } from "@/lib/action-error";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { safeJson } from "@/lib/format";
import type { GuidePrefs } from "@/lib/guides";

/** Hide a guide card for the current user (stored in preferences.guides, any portal). */
export async function dismissGuide(formData: FormData): Promise<void> {
  try {
    const user = await requireUser();
    const id = String(formData.get("id") ?? "").trim();
    if (!id || id.length > 64) return;
    const me = await db.user.findUnique({ where: { id: user.id }, select: { preferences: true } });
    const prefs = safeJson<GuidePrefs & Record<string, unknown>>(me?.preferences, {});
    const next = { ...prefs, guides: { ...(prefs.guides ?? {}), [id]: true as const } };
    await db.user.update({ where: { id: user.id }, data: { preferences: JSON.stringify(next) } });
    revalidatePath("/", "layout");
  } catch (e) {
    await failFromError(e);
  }
}
