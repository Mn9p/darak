// Shared access to AUTH_SECRET. In production a missing secret is a hard error (never a silent default);
// in development a fixed fallback keeps `pnpm dev` working without a .env.
// Note: lib/auth.ts should import authSecret() from here instead of its own `?? "darak-dev-secret"` fallback.

const DEV_FALLBACK = "darak-dev-secret";

export function authSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (s && s.length >= 32 && s !== "change-me") return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET is missing or too short (need 32+ random characters). Refusing to sign sessions or codes.");
  }
  return s || DEV_FALLBACK;
}
