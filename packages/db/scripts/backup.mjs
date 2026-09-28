// Database backup with retention and optional S3 upload.
// PostgreSQL: pg_dump custom format (requires pg_dump on PATH). SQLite: file copy.
// Usage: node scripts/backup.mjs            (env: DATABASE_URL, BACKUP_DIR, BACKUP_RETENTION_DAYS, BACKUP_S3_BUCKET + S3_* creds)
// Restore (Postgres): pg_restore --clean --if-exists -d "$DATABASE_URL" backups/darak-YYYYMMDD-HHMM.dump
// Restore (SQLite):   cp backups/darak-YYYYMMDD-HHMM.db packages/db/prisma/schema/dev.db
import { execFileSync } from "node:child_process";
import { mkdirSync, copyFileSync, readdirSync, statSync, unlinkSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadEnv, SCHEMA_DIR } from "./env.mjs";

const url = loadEnv();
const dir = resolve(process.env.BACKUP_DIR ?? "backups");
const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS ?? 30);
mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 13).replace("T", "-");

let out;
if (/^postgres/i.test(url)) {
  out = join(dir, `darak-${stamp}.dump`);
  execFileSync("pg_dump", ["--format=custom", "--no-owner", "--file", out, url], { stdio: "inherit" });
} else {
  const src = resolve(SCHEMA_DIR, url.replace(/^file:/, ""));
  out = join(dir, `darak-${stamp}.db`);
  copyFileSync(src, out);
}
console.log(`[backup] wrote ${out} (${(statSync(out).size / 1024).toFixed(0)} KB)`);

// retention
const cutoff = Date.now() - retentionDays * 86400e3;
for (const f of readdirSync(dir)) {
  const p = join(dir, f);
  if (/^darak-.*\.(dump|db)$/.test(f) && statSync(p).mtimeMs < cutoff) {
    unlinkSync(p);
    console.log(`[backup] pruned ${f}`);
  }
}

// optional off-site copy
if (process.env.BACKUP_S3_BUCKET) {
  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
  const s3 = new S3Client({
    region: process.env.S3_REGION ?? "auto",
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "", secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "" },
  });
  const key = `backups/${out.split(/[\\/]/).pop()}`;
  // R2 always encrypts at rest and rejects the SSE header; AWS S3 gets it explicitly.
  const isR2 = /r2.cloudflarestorage.com/i.test(process.env.S3_ENDPOINT ?? "");
  await s3.send(new PutObjectCommand({ Bucket: process.env.BACKUP_S3_BUCKET, Key: key, Body: readFileSync(out), ...(isR2 ? {} : { ServerSideEncryption: "AES256" }) }));
  console.log(`[backup] uploaded s3://${process.env.BACKUP_S3_BUCKET}/${key}`);
}
