// Next.js instrumentation hook: validates production secrets at boot and reports unhandled server errors
// (RSC, route handlers, server actions).
import type { Instrumentation } from "next";

const MIN_SECRET_LENGTH = 32;

/** Refuses to start in production with missing/placeholder secrets. Throws a clear message instead of failing later. */
function assertProductionSecrets() {
  const problems: string[] = [];
  for (const name of ["AUTH_SECRET", "CRON_SECRET"] as const) {
    const v = process.env[name];
    if (!v) problems.push(`${name} is missing`);
    else if (v === "change-me") problems.push(`${name} is still the placeholder "change-me"`);
    else if (v.length < MIN_SECRET_LENGTH) problems.push(`${name} is too short (${v.length} chars, need ${MIN_SECRET_LENGTH}+)`);
  }
  if (problems.length) {
    throw new Error(
      `Refusing to start in production: ${problems.join("; ")}. ` +
        `Generate one with: node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`,
    );
  }
}

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { logger } = await import("./lib/logger");
    if (process.env.NODE_ENV === "production") {
      assertProductionSecrets();
      if ((process.env.DATABASE_URL ?? "").startsWith("file:")) {
        // Serverless has no persistent disk: SQLite there loses every write.
        if (process.env.VERCEL) throw new Error("Refusing to start on Vercel with a SQLite DATABASE_URL. Set the Neon (PostgreSQL) pooled URL.");
        logger.warn("app.sqlite_in_production", { hint: "DATABASE_URL points to SQLite; use PostgreSQL for production." });
      }
      const storage = (process.env.STORAGE_PROVIDER ?? "local").toLowerCase();
      if (process.env.VERCEL && storage !== "s3") {
        // No persistent disk on Vercel: uploads are switched off (lib/storage uploadsEnabled) until R2/S3 is configured.
        logger.warn("app.uploads_disabled", { hint: "Set STORAGE_PROVIDER=s3 and the S3_* variables (Cloudflare R2) to enable uploads." });
      }
      if (storage === "s3") {
        const missing = ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"].filter((k) => !process.env[k]);
        if (missing.length) throw new Error(`STORAGE_PROVIDER=s3 but ${missing.join(", ")} missing.`);
      }
      if (!process.env.APP_URL) logger.warn("app.no_app_url", { hint: "APP_URL is empty: links in emails and statements will be relative." });
    }
    logger.info("app.start", { version: process.env.npm_package_version ?? "1.0.0", env: process.env.NODE_ENV });
  }
}

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const { logger } = await import("./lib/logger");
  const data = {
    message: (err as Error)?.message,
    digest: (err as { digest?: string })?.digest,
    path: request.path,
    method: request.method,
    routerKind: context.routerKind,
    routeType: context.routeType,
  };
  // Serverless may freeze right after the response: make sure the Sentry event actually leaves.
  await logger.errorAwaited("request.error", data);
};
