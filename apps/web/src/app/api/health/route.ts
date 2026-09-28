import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** Uptime probe. Never returns error details or version info; failures are logged server-side. */
export async function GET() {
  const started = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", db: "ok", latencyMs: Date.now() - started, time: new Date().toISOString() });
  } catch (e) {
    logger.error("health.db_failed", { error: String(e) });
    return NextResponse.json({ status: "degraded" }, { status: 503 });
  }
}
