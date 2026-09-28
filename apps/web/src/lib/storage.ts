// File storage adapter: local disk (default) or any S3-compatible bucket (AWS S3, Cloudflare R2, MinIO, Supabase).
// Files are private; access goes through /api/files/[...key] which checks the session + organization.
import { mkdir, writeFile, readFile, unlink, stat } from "node:fs/promises";
import { join, resolve, extname } from "node:path";
import { randomBytes } from "node:crypto";
import { db } from "./db";

const PROVIDER = (process.env.STORAGE_PROVIDER ?? "local").toLowerCase();
const LOCAL_ROOT = resolve(process.env.UPLOAD_DIR ?? "uploads");
/** Per-file upload cap. Vercel functions reject request bodies over 4.5 MB, so 4 MB there; 20 MB on Docker/VPS. */
export const MAX_FILE_MB = process.env.VERCEL ? 4 : 20;
export const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;

/** Serverless (Vercel) has no persistent disk: without S3/R2 configured, uploads are switched off rather than lost. */
export function uploadsEnabled(): boolean {
  return PROVIDER === "s3" || !process.env.VERCEL;
}
export const UPLOADS_DISABLED_MESSAGE = "رفع الملفات غير مفعّل بعد على هذا الخادم. احفظ بدون مرفق، وأضف الملف لاحقًا بعد تفعيل التخزين.";
export const ALLOWED_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel", "text/csv", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);

function safeName(name: string) {
  return name.replace(/[^\w.\-؀-ۿ ]+/g, "_").slice(0, 120);
}

export function buildKey(organizationId: string, entity: string, fileName: string) {
  const ext = extname(fileName).toLowerCase().slice(0, 8);
  return `${organizationId}/${entity.toLowerCase()}/${Date.now()}-${randomBytes(6).toString("hex")}${ext}`;
}

async function s3() {
  const { S3Client } = await import("@aws-sdk/client-s3");
  return new S3Client({
    region: process.env.S3_REGION ?? "auto",
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "", secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "" },
  });
}

export interface StoredFileInfo {
  id: string;
  key: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  url: string;
}

/** Validates and stores an uploaded File. Returns the StoredFile row + private URL. */
export async function putFile(opts: { organizationId: string; entity: string; file: File; uploadedById?: string | null }): Promise<StoredFileInfo> {
  const { file } = opts;
  if (!file || file.size === 0) throw new Error("لم يتم اختيار ملف.");
  if (!uploadsEnabled()) throw new Error(UPLOADS_DISABLED_MESSAGE);
  if (file.size > MAX_FILE_BYTES) throw new Error(`حجم الملف يتجاوز الحد المسموح (${MAX_FILE_MB}MB). صغّر الصورة أو احفظها PDF.`);
  const contentType = file.type || "application/octet-stream";
  if (!ALLOWED_TYPES.has(contentType)) throw new Error("نوع الملف غير مسموح. المسموح: PDF، صور، Excel، Word.");
  const key = buildKey(opts.organizationId, opts.entity, file.name);
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!sniffMatches(bytes, contentType)) throw new Error("محتوى الملف لا يطابق نوعه المعلن. ارفع ملفًا صالحًا.");

  if (PROVIDER === "s3") {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    await (await s3()).send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, Body: bytes, ContentType: contentType }));
  } else {
    const path = join(LOCAL_ROOT, key);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, bytes);
  }
  const row = await db.storedFile.create({
    data: { organizationId: opts.organizationId, key, name: safeName(file.name), contentType, sizeBytes: file.size, provider: PROVIDER === "s3" ? "s3" : "local", uploadedById: opts.uploadedById ?? null },
  });
  return { id: row.id, key, name: row.name, contentType, sizeBytes: file.size, url: fileUrl(key) };
}

/** Magic-byte check so a renamed executable cannot pass as PDF/image (never trust file.type alone). */
export function sniffMatches(b: Buffer, contentType: string): boolean {
  const h = b.subarray(0, 8);
  const startsWith = (...bytes: number[]) => bytes.every((x, i) => h[i] === x);
  switch (contentType) {
    case "application/pdf": return startsWith(0x25, 0x50, 0x44, 0x46); // %PDF
    case "image/jpeg": return startsWith(0xff, 0xd8, 0xff);
    case "image/png": return startsWith(0x89, 0x50, 0x4e, 0x47);
    case "image/gif": return startsWith(0x47, 0x49, 0x46, 0x38);
    case "image/webp": return startsWith(0x52, 0x49, 0x46, 0x46) && b.subarray(8, 12).toString("ascii") === "WEBP";
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document": return startsWith(0x50, 0x4b, 0x03, 0x04); // zip
    case "application/vnd.ms-excel":
    case "application/msword": return startsWith(0xd0, 0xcf, 0x11, 0xe0) || startsWith(0x50, 0x4b, 0x03, 0x04);
    case "text/csv": return !b.subarray(0, 512).includes(0);
    default: return false;
  }
}

export function fileUrl(key: string) {
  return `/api/files/${key}`;
}

/** Streams a file back (used by the /api/files route after auth checks). */
export async function getFile(key: string): Promise<{ body: Buffer; contentType: string; name: string } | null> {
  const row = await db.storedFile.findUnique({ where: { key } });
  if (!row) return null;
  if (row.provider === "s3") {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const res = await (await s3()).send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
    const body = Buffer.from(await res.Body!.transformToByteArray());
    return { body, contentType: row.contentType, name: row.name };
  }
  const path = join(LOCAL_ROOT, key);
  try {
    await stat(path);
  } catch {
    return null;
  }
  return { body: await readFile(path), contentType: row.contentType, name: row.name };
}

export async function deleteFile(key: string) {
  const row = await db.storedFile.findUnique({ where: { key } });
  if (!row) return;
  if (row.provider === "s3") {
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    await (await s3()).send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
  } else {
    await unlink(join(LOCAL_ROOT, key)).catch(() => {});
  }
  await db.storedFile.delete({ where: { id: row.id } });
}

/** Organization that owns a stored file key (for access checks). */
export async function fileOwnerOrg(key: string) {
  const row = await db.storedFile.findUnique({ where: { key }, select: { organizationId: true } });
  return row?.organizationId ?? null;
}
