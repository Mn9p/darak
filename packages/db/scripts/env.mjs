// Shared helpers for @darak/db scripts.
// - loads the repo-root .env (single source of truth for the monorepo)
// - keeps prisma/schema/base.prisma's datasource provider in sync with DATABASE_URL
//   (SQLite for local dev, PostgreSQL for staging/production). Idempotent.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;

export const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_ROOT = resolve(PKG_ROOT, "../..");
export const SCHEMA_DIR = resolve(PKG_ROOT, "prisma/schema");
export const BASE_SCHEMA = resolve(SCHEMA_DIR, "base.prisma");

export function loadEnv() {
  loadEnvConfig(REPO_ROOT, process.env.NODE_ENV !== "production", { info: () => {}, error: console.error });
  if (!process.env.DATABASE_URL) {
    if (process.env.VERCEL) {
      console.error("[db] DATABASE_URL is not set for this Vercel environment (Production / Preview). Refusing to build a SQLite client.");
      process.exit(1);
    }
    process.env.DATABASE_URL = "file:./dev.db";
  }
  return process.env.DATABASE_URL;
}

export function providerFor(url) {
  return /^postgres(ql)?:\/\//i.test(url) ? "postgresql" : "sqlite";
}

export function syncProvider(provider = providerFor(process.env.DATABASE_URL ?? "")) {
  const src = readFileSync(BASE_SCHEMA, "utf8");
  const next = src.replace(/datasource db \{\s*provider\s*=\s*"[a-z]+"/, `datasource db {\n  provider = "${provider}"`);
  if (next !== src) {
    writeFileSync(BASE_SCHEMA, next);
    console.log(`[db] schema provider set to ${provider}`);
  }
  return provider;
}
