// @darak/db — single Prisma client for the whole monorepo.
// Consumers: `import { db, Prisma } from "@darak/db"`. Model types are re-exported from @prisma/client.
import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

export * from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * A relative SQLite URL ("file:./dev.db") is resolved by Prisma against the schema file's location — which, once Next
 * bundles the client (and the Prisma monorepo plugin copies the engine next to the server chunks), is no longer
 * packages/db/prisma/schema. Resolve it here, against the real schema folder found from the working directory, so
 * `next dev`, `next start`, scripts and tests all open the same file. PostgreSQL URLs are returned unchanged.
 */
function datasourceUrl(): string | undefined {
  const url = process.env.DATABASE_URL;
  if (!url || !/^file:/i.test(url)) return url;
  const path = url.slice("file:".length).split("?")[0];
  if (isAbsolute(path)) return url;
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const schemaDir = resolve(dir, "packages/db/prisma/schema");
    if (existsSync(schemaDir)) return `file:${resolve(schemaDir, path)}`;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return url;
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: datasourceUrl(),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

// Cached on globalThis in every environment: serverless instances and duplicated bundles reuse one connection pool.
globalForPrisma.prisma = db;

/** True when DATABASE_URL points at a SQLite file (local dev / CI). */
export function isSqlite(): boolean {
  return /^file:/i.test(process.env.DATABASE_URL ?? "");
}
