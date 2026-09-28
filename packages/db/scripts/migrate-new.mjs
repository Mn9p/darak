// Creates the NEXT PostgreSQL migration after launch (0001_init is frozen once applied).
// Read-only against the database: diffs the live production schema with prisma/schema and writes the SQL for review.
// Usage: MIGRATE_FROM_URL="<Neon DIRECT url>" node scripts/migrate-new.mjs <name>
//   → prisma/schema/migrations/<NNNN>_<name>/migration.sql     then review it and run `pnpm db:migrate:deploy`.
// Never runs `migrate dev` (see prisma.mjs).
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { syncProvider, SCHEMA_DIR, PKG_ROOT, providerFor, loadEnv } from "./env.mjs";

const name = (process.argv[2] ?? "").replace(/[^a-z0-9_]+/gi, "_").toLowerCase();
const from = process.env.MIGRATE_FROM_URL;
if (!name) {
  console.error("usage: MIGRATE_FROM_URL=<postgres direct url> node scripts/migrate-new.mjs <name>");
  process.exit(1);
}
if (!from || !/^postgres/i.test(from)) {
  console.error("[db] MIGRATE_FROM_URL must be the PostgreSQL (direct, non-pooled) URL of the database to diff against.");
  process.exit(1);
}
const original = providerFor(loadEnv());
const dir = resolve(SCHEMA_DIR, "migrations");
const next = String(readdirSync(dir).filter((d) => /^\d{4}_/.test(d)).length + 1).padStart(4, "0");

syncProvider("postgresql");
try {
  const bin = process.platform === "win32" ? "npx.cmd" : "npx";
  const res = spawnSync(bin, ["prisma", "migrate", "diff", "--from-url", from, "--to-schema-datamodel", SCHEMA_DIR, "--script"], {
    cwd: PKG_ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: { ...process.env, DATABASE_URL: from },
  });
  if (res.status !== 0) {
    console.error(res.stderr || res.stdout);
    process.exit(res.status ?? 1);
  }
  if (/^-- This is an empty migration/m.test(res.stdout) || !res.stdout.trim()) {
    console.log("[db] no schema changes — nothing written.");
  } else {
    const out = resolve(dir, `${next}_${name}`);
    mkdirSync(out, { recursive: true });
    writeFileSync(resolve(out, "migration.sql"), res.stdout);
    console.log(`[db] wrote prisma/schema/migrations/${next}_${name}/migration.sql — review it, then pnpm db:migrate:deploy`);
  }
} finally {
  syncProvider(original);
}
