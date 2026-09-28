// Structured JSON logger (stdout). Ship to Datadog/Loki/CloudWatch by collecting container stdout.
// If SENTRY_DSN is set, errors are also forwarded to Sentry's store endpoint without an SDK dependency.

type Level = "debug" | "info" | "warn" | "error";
const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[(process.env.LOG_LEVEL as Level) ?? (process.env.NODE_ENV === "production" ? "info" : "debug")] ?? 20;

function emit(level: Level, msg: string, data?: Record<string, unknown>, sentry = true) {
  if (LEVELS[level] < threshold) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...(data ?? {}) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
  if (level === "error" && sentry) void forwardToSentry(msg, data);
}

/** Masks a phone number for logs: 9665****123 (first 4 + last 3 digits). */
export function maskPhone(p: string | null | undefined) {
  if (!p) return "";
  const d = String(p).replace(/\D/g, "");
  if (d.length < 8) return "*".repeat(d.length);
  return `${d.slice(0, 4)}****${d.slice(-3)}`;
}

export const logger = {
  debug: (msg: string, data?: Record<string, unknown>) => emit("debug", msg, data),
  info: (msg: string, data?: Record<string, unknown>) => emit("info", msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => emit("warn", msg, data),
  error: (msg: string, data?: Record<string, unknown>) => emit("error", msg, data),
  /** Error whose Sentry delivery is awaited (request hooks on serverless, where the function may freeze right after). */
  errorAwaited: async (msg: string, data?: Record<string, unknown>) => {
    emit("error", msg, data, false);
    await forwardToSentry(msg, data);
  },
};

/** Sends one error event to Sentry (store API, no SDK). Awaitable where the platform may freeze the function right after. */
export async function forwardToSentry(msg: string, data?: Record<string, unknown>) {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace("/", "");
    const key = u.username;
    const endpoint = `${u.protocol}//${u.host}/api/${projectId}/store/`;
    await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${key}, sentry_client=darak/1.0` },
      body: JSON.stringify({ message: msg, level: "error", platform: "node", environment: process.env.NODE_ENV, extra: data, timestamp: Date.now() / 1000 }),
    });
  } catch {
    /* never throw from logger */
  }
}
