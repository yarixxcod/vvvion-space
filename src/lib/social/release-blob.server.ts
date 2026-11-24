import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Sql } from "@/lib/db";
import { chunkCount, chunkSpan } from "@/lib/social/release-rules";

export type BlobStore = {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  remove(key: string): Promise<void>;
};

let client: S3Client | null = null;
let override: BlobStore | null = null;

export function useReleaseStore(store: BlobStore | null) {
  override = store;
}

export function releasePrefix(kind: "android" | "windows", slot: number): string {
  return `vvvion-releases/${kind}/${slot}`;
}

export function releaseStore(): BlobStore | null {
  if (override) return override;
  const bucket = process.env.VVVION_S3_BUCKET?.trim();
  const accessKeyId = process.env.VVVION_S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.VVVION_S3_SECRET_ACCESS_KEY?.trim();
  if (!bucket || !accessKeyId || !secretAccessKey) return null;
  const endpoint = process.env.VVVION_S3_ENDPOINT?.trim() || "https://slc1.s3.yeapcloud.com";
  const region = process.env.VVVION_S3_REGION?.trim() || "slc1";
  client ??= new S3Client({
    region,
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
  const s3 = client;
  return {
    async put(key, bytes) {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: bytes,
          ContentType: "application/octet-stream",
        }),
        { abortSignal: AbortSignal.timeout(20_000) },
      );
    },
    async get(key) {
      try {
        const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(20_000) });
        return res.Body ? await res.Body.transformToByteArray() : new Uint8Array();
      } catch (err) {
        const name = (err as { name?: string }).name;
        const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (name === "NoSuchKey" || name === "NotFound" || status === 404) return null;
        throw err;
      }
    },
    async remove(key) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => undefined);
    },
  };
}

export async function removeRelease(store: BlobStore, prefix: string, size: number) {
  const count = chunkCount(size);
  for (let index = 0; index < count; index += 1) await store.remove(`${prefix}/${index}`);
}

export function memoryReleaseStore(): BlobStore & { objects: Map<string, Uint8Array> } {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    async put(key, bytes) {
      objects.set(key, new Uint8Array(bytes));
    },
    async get(key) {
      const hit = objects.get(key);
      return hit ? new Uint8Array(hit) : null;
    },
    async remove(key) {
      objects.delete(key);
    },
  };
}

export function fileHeaders(name: string, size: number, contentType: string, range?: { start: number; end: number }): Headers {
  const headers = new Headers({
    "content-type": contentType,
    "x-content-type-options": "nosniff",
    "accept-ranges": "bytes",
    "cache-control": "public, max-age=86400",
    "content-disposition": `attachment; filename="${name.replace(/"/g, "")}"`,
  });
  if (range) {
    headers.set("content-range", `bytes ${range.start}-${range.end}/${size}`);
    headers.set("content-length", String(range.end - range.start + 1));
  } else {
    headers.set("content-length", String(size));
  }
  return headers;
}

export function byteRange(header: string | null, size: number): { start: number; end: number } | "bad" | null {
  if (!header) return null;
  const match = /^bytes=(\d+)-(\d*)$/i.exec(header.trim());
  if (!match || size < 1) return "bad";
  const start = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= size || end < start) return "bad";
  return { start, end };
}

export async function streamObject(
  store: BlobStore,
  prefix: string,
  name: string,
  size: number,
  request: Request,
  contentType: string,
): Promise<Response> {
  const range = byteRange(request.headers.get("range"), size);
  if (range === "bad") return new Response(null, { status: 416, headers: fileHeaders(name, size, contentType) });
  const headers = fileHeaders(name, size, contentType, range || undefined);
  const status = range ? 206 : 200;
  if (request.method === "HEAD") return new Response(null, { status, headers });
  const start = range ? range.start : 0;
  const end = range ? range.end : Math.max(0, size - 1);
  const count = chunkCount(size);
  let index = 0;
  while (index < count && chunkSpan(size, index).start + chunkSpan(size, index).bytes - 1 < start) index += 1;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (size < 1 || index >= count) {
        controller.close();
        return;
      }
      const idx = index;
      index += 1;
      const span = chunkSpan(size, idx);
      if (span.start > end) {
        controller.close();
        return;
      }
      const raw = await store.get(`${prefix}/${idx}`);
      if (!raw) {
        controller.error(new Error("missing"));
        return;
      }
      const from = Math.max(0, start - span.start);
      const to = Math.min(raw.byteLength, end - span.start + 1);
      controller.enqueue(new Uint8Array(raw.subarray(from, to)));
      if (span.start + span.bytes - 1 >= end) controller.close();
    },
  });
  return new Response(stream, { status, headers });
}

const APK_TYPE = "application/vnd.android.package-archive";

/** Old Android releases: bytes still live in `app_release_chunks`. */
export async function streamStoredApk(
  sql: Sql,
  request: Request,
  live: { slot: number; file_name: string; size: number },
): Promise<Response> {
  const listed = await sql<{ idx: number; bytes: number }>`
    select idx, bytes from app_release_chunks where slot = ${live.slot} order by idx
  `;
  const spans: { idx: number; bytes: number; start: number }[] = [];
  let cursor = 0;
  for (const row of listed) {
    const bytes = Number(row.bytes);
    spans.push({ idx: Number(row.idx), bytes, start: cursor });
    cursor += bytes;
  }
  const size = cursor || live.size;
  const range = byteRange(request.headers.get("range"), size);
  if (range === "bad") return new Response(null, { status: 416, headers: fileHeaders(live.file_name, size, APK_TYPE) });
  const headers = fileHeaders(live.file_name, size, APK_TYPE, range || undefined);
  if (request.method === "HEAD") return new Response(null, { status: range ? 206 : 200, headers });
  const start = range ? range.start : 0;
  const end = range ? range.end : size - 1;
  const needed = spans.filter((span) => span.start + span.bytes > start && span.start <= end);
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const span = needed[index];
      if (!span) {
        controller.close();
        return;
      }
      index += 1;
      const rows = await sql<{ data: string }>`select data from app_release_chunks where slot = ${live.slot} and idx = ${span.idx}`;
      const raw = Buffer.from(rows[0]?.data || "", "base64");
      const from = Math.max(0, start - span.start);
      const to = Math.min(raw.length, end - span.start + 1);
      controller.enqueue(new Uint8Array(raw.subarray(from, to)));
    },
  });
  return new Response(stream, { status: range ? 206 : 200, headers });
}
