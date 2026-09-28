import { db } from "@/lib/db";
import { safeJson } from "@/lib/format";

/**
 * First-run guidance. A guide is a small card shown on a module while it is still empty;
 * once the user dismisses it we remember that inside User.preferences.guides (JSON, no audit needed).
 */
export type GuidePrefs = { guides?: Record<string, true> };

export async function guideDismissed(userId: string, id: string): Promise<boolean> {
  const me = await db.user.findUnique({ where: { id: userId }, select: { preferences: true } });
  const prefs = safeJson<GuidePrefs>(me?.preferences, {});
  return prefs.guides?.[id] === true;
}
