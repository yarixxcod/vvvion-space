import { createHash, randomUUID } from "node:crypto";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

const PREFIX = "@vv-s3:1:";
const MAX = 16 * 1024 * 1024;
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export function s3DiskEnabled() { return process.env.VVVION_DISK_S3_ENABLED === "true"; }
function config() {
  const endpoint = process.env.VVVION_S3_ENDPOINT || "";
  const url = new URL(endpoint);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("Некорректная конфигурация S3");
  const accessKeyId = process.env.VVVION_S3_ACCESS_KEY_ID || "";
  const secretAccessKey = process.env.VVVION_S3_SECRET_ACCESS_KEY || "";
  const bucket = process.env.VVVION_S3_BUCKET || "";
  if (!accessKeyId || !secretAccessKey || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error("Хранилище S3 не настроено");
  return { endpoint, region: process.env.VVVION_S3_REGION || "slc1", credentials: { accessKeyId, secretAccessKey }, bucket };
}
function client() {
  const { bucket, ...settings } = config();
  return { bucket, s3: new S3Client({ ...settings, forcePathStyle: true, maxAttempts: 2, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED", requestHandler: { connectionTimeout: 5000, requestTimeout: 15_000 } }) };
}
function pointer(data: string, owner: string): { key: string; bytes: number; sha: string } | null {
  if (!data.startsWith(PREFIX)) return null;
  try {
    const value = JSON.parse(Buffer.from(data.slice(PREFIX.length), "base64url").toString("utf8"));
    const root = `vvvion/disk/${digest(owner)}/`;
    if (typeof value.key !== "string" || !value.key.startsWith(root) || !/^[a-f0-9-]+$/.test(value.key.slice(root.length)) || !/^[a-f0-9]{64}$/.test(value.sha) || !Number.isInteger(value.bytes) || value.bytes < 0 || value.bytes > MAX) throw new Error();
    return value;
  } catch { throw new Error("Некорректная ссылка хранилища"); }
}
/** Owner must come from a verified session or an already authorized database row. Never from the model. */
export async function encodeDiskBlob(owner: string, bytes: Uint8Array): Promise<string> {
  if (!s3DiskEnabled()) return Buffer.from(bytes).toString("base64");
  if (bytes.length > MAX) throw new Error("Файл превышает лимит хранилища");
  const key = `vvvion/disk/${digest(owner)}/${randomUUID()}`;
  const sha = digest(bytes);
  const { bucket, s3 } = client();
  try {
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: "application/octet-stream", CacheControl: "private, no-store" }), { abortSignal: AbortSignal.timeout(20_000) });
    return PREFIX + Buffer.from(JSON.stringify({ key, bytes: bytes.length, sha })).toString("base64url");
  } catch { throw new Error("Не удалось сохранить файл в S3. Сохранение не подтверждено."); }
  finally { s3.destroy(); }
}
export async function decodeDiskBlob(owner: string, data: string): Promise<Buffer> {
  const ref = pointer(data, owner);
  if (!ref) return Buffer.from(data, "base64");
  // Reading existing pointers must continue even if new S3 writes are switched off.
  const { bucket, s3 } = client();
  try {
    const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: ref.key }), { abortSignal: AbortSignal.timeout(20_000) });
    if (!result.Body || result.ContentLength !== undefined && result.ContentLength !== ref.bytes) throw new Error();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const part of result.Body as AsyncIterable<Uint8Array>) {
      size += part.length;
      if (size > ref.bytes || size > MAX) { (result.Body as { destroy?: () => void }).destroy?.(); throw new Error(); }
      chunks.push(part);
    }
    const bytes = Buffer.concat(chunks);
    if (bytes.length !== ref.bytes || digest(bytes) !== ref.sha) throw new Error();
    return bytes;
  } catch { throw new Error("Файл временно недоступен в S3. Повторите позже."); }
  finally { s3.destroy(); }
}
/** Only a pointer obtained from this owner's scoped row can be removed. */
export async function removeDiskBlob(owner: string, data: string): Promise<void> {
  const ref = pointer(data, owner);
  if (!ref) return;
  const { bucket, s3 } = client();
  try { await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: ref.key }), { abortSignal: AbortSignal.timeout(20_000) }); }
  finally { s3.destroy(); }
}

/** Private memory objects have a separate namespace and are encrypted by the memory backend. */
export async function readMemoryObject(owner: string): Promise<{ body: string | null; etag?: string }> {
  const { bucket, s3 } = client();
  try {
    const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: `vvvion/memory/${digest(owner)}.json` }), { abortSignal: AbortSignal.timeout(5000) });
    if (!result.Body || !result.ETag || (result.ContentLength ?? 0) > 400_000) throw new Error();
    let size = 0;
    const chunks: Uint8Array[] = [];
    for await (const part of result.Body as AsyncIterable<Uint8Array>) {
      size += part.length;
      if (size > 400_000) { (result.Body as { destroy?: () => void }).destroy?.(); throw new Error(); }
      chunks.push(part);
    }
    return { body: Buffer.concat(chunks).toString("utf8"), etag: result.ETag };
  } catch (e) {
    if ((e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return { body: null };
    throw new Error("Хранилище памяти временно недоступно");
  } finally { s3.destroy(); }
}
export async function writeMemoryObject(owner: string, body: string): Promise<void> {
  if (Buffer.byteLength(body) > 400_000) throw new Error("Превышен размер памяти аккаунта");
  const { bucket, s3 } = client();
  try {
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: `vvvion/memory/${digest(owner)}.json`, Body: body, ContentType: "application/json", CacheControl: "private, no-store" }), { abortSignal: AbortSignal.timeout(5000) });
  } catch {
    throw new Error("Изменение памяти не подтверждено хранилищем");
  } finally { s3.destroy(); }
}
