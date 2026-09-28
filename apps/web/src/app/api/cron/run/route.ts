import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { runEngineLeased } from "@/lib/engine";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Scheduled job entrypoint: recompute statuses & automations for every active organization,
 * then run housekeeping (expired sessions, old throttle rows, yesterday's login codes).
 * Protected by CRON_SECRET, accepted only as `Authorization: Bearer <secret>` (Vercel Cron sends this automatically;
 * system cron: `curl -H "Authorization: Bearer $CRON_SECRET" …`). Query-string tokens are not accepted (they end up in logs).
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (process.env.NODE_ENV === "production" && !secret) {
    logger.error("cron.no_secret");
    return NextResponse.json({ ok: false }, { status: 503 });
  }
  if (secret) {
    const auth = req.headers.get("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!safeEqual(token, secret)) return NextResponse.json({ ok: false }, { status: 401 });
  }

  const started = Date.now();
  const orgs = await db.organization.findMany({ where: { status: { not: "SUSPENDED" } }, select: { id: true, name: true } });
  const results: Record<string, number | string> = {};
  for (const o of orgs) {
    try {
      const r = await runEngineLeased(o.id);
      results[o.name] = r.skipped ? "skipped (ran recently)" : r.updates;
    } catch (e) {
      results[o.name] = "error";
      logger.error("cron.engine_failed", { org: o.id, error: String(e) });
    }
  }

  // Housekeeping / retention
  const now = new Date();
  const [sessions, attempts, codes] = await Promise.all([
    db.session.deleteMany({ where: { OR: [{ expiresAt: { lt: new Date(now.getTime() - 30 * 86400e3) } }, { revokedAt: { lt: new Date(now.getTime() - 30 * 86400e3) } }] } }),
    db.loginAttempt.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 7 * 86400e3) } } }),
    db.otpCode.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 86400e3) } } }),
  ]);

  const payload = { ok: true, ranAt: now.toISOString(), ms: Date.now() - started, results, housekeeping: { sessions: sessions.count, loginAttempts: attempts.count, otpCodes: codes.count } };
  logger.info("cron.run", payload);
  return NextResponse.json(payload);
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
