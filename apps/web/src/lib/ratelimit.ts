// Throttles backed by the LoginAttempt table (works on any host, no Redis needed).
// OTP sends and code checks are throttled inside lib/otp.ts; this file keeps the client-IP helper
// and the public "request an account" limit.
import { db } from "./db";
import { headers } from "next/headers";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Best-effort client IP. Behind Vercel/Caddy the first x-forwarded-for hop is set by the proxy; elsewhere it is advisory only. */
export async function clientIp() {
  try {
    const h = await headers();
    return (h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? "local").split(",")[0].trim();
  } catch {
    return "local";
  }
}

/** Public access requests: max 3 per IP per hour and 1 per phone per day. */
export async function accessRequestLimited(ip: string, phone: string) {
  const [byIp, byPhone] = await Promise.all([
    db.loginAttempt.count({ where: { key: { startsWith: "request:" }, ip, createdAt: { gte: new Date(Date.now() - HOUR_MS) } } }),
    db.loginAttempt.count({ where: { key: `request:${phone}`, createdAt: { gte: new Date(Date.now() - DAY_MS) } } }),
  ]);
  return byIp >= 3 || byPhone >= 1;
}

export async function recordAccessRequest(phone: string, ip: string) {
  await db.loginAttempt.create({ data: { key: `request:${phone}`, ip, success: true } });
}
