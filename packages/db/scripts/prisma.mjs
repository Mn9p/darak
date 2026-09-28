// Runs the Prisma CLI with the repo-root .env loaded and the datasource provider synced.
// Usage: node scripts/prisma.mjs <prisma args...>
// Guard rails: `migrate dev`, `migrate reset` and `db push --force-reset` are refused (see docs/ENGINEERING.md).
import { spawnSync } from "node:child_process";
import { loadEnv, syncProvider, PKG_ROOT } from "./env.mjs";

const args = process.argv.slice(2);
const joined = args.join(" ");
if (/^migrate (dev|reset)\b/.test(joined) || /--force-reset/.test(joined)) {
  console.error(`[db] refused: "prisma ${joined}" is blocked in this repository. Use "pnpm db:push" or "pnpm db:migrate:deploy".`);
  process.exit(1);
}

loadEnv();
// Migrations need a direct connection (Neon's pooler runs PgBouncer in transaction mode). The Neon–Vercel integration
// provides DATABASE_URL_UNPOOLED; DIRECT_URL is accepted too. The provider is still derived from DATABASE_URL.
if (args[0] === "migrate") {
  const direct = process.env.DATABASE_URL_UNPOOLED || process.env.DIRECT_URL;
  if (direct) process.env.DATABASE_URL = direct;
}
syncProvider();

const bin = process.platform === "win32" ? "npx.cmd" : "npx";
const isGenerate = args[0] === "generate";
const res = spawnSync(bin, ["prisma", ...args], { cwd: PKG_ROOT, stdio: isGenerate ? "pipe" : "inherit", env: process.env, shell: process.platform === "win32" });

if (isGenerate) {
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  process.stdout.write(out);
  // Windows: a running dev server (or Studio) keeps the query engine DLL open, so the rename step fails with EPERM
  // even though the generated client is already up to date. Keep going instead of blocking `pnpm dev`.
  if (res.status !== 0 && /EPERM: operation not permitted, rename .*query_engine-windows.dll.node/.test(out)) {
    console.warn("[db] generate: the query engine is in use by another process (dev server or Studio). Keeping the existing client. Stop the other process and rerun \"pnpm db:generate\" after schema changes.");
    process.exit(0);
  }
}
process.exit(res.status ?? 1);
