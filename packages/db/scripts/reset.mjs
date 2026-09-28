// Local dev only: delete the SQLite database and push the schema fresh.
// Refuses to touch PostgreSQL — production data is never reset by script.
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { loadEnv, providerFor, SCHEMA_DIR, PKG_ROOT } from "./env.mjs";

const url = loadEnv();
if (providerFor(url) !== "sqlite") {
  console.error("[db] reset refused: DATABASE_URL is not SQLite. Use migrations on PostgreSQL.");
  process.exit(1);
}
// Prisma resolves `file:` URLs relative to the schema directory.
const file = resolve(SCHEMA_DIR, url.replace(/^file:/, ""));
rmSync(file, { force: true });
rmSync(`${file}-journal`, { force: true });
console.log(`[db] removed ${file}`);

const res = spawnSync(process.execPath, [resolve(PKG_ROOT, "scripts/prisma.mjs"), "db", "push", "--skip-generate"], { stdio: "inherit", env: process.env });
process.exit(res.status ?? 1);
