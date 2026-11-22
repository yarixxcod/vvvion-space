import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  applyEdit,
  applyFact,
  applyForget,
  cleanDocument,
  commitMemory,
  documentFromLegacy,
  documentFromView,
  emptyDocument,
  legacyFromInput,
  liveTexts,
  memoryObjectKey,
  mergeMigration,
  textsForModel,
  viewOf,
  type CommitResult,
  type MemoryBackend,
  type MemoryDocument,
  type MemoryInput,
  type MemoryResponse,
  type Produced,
} from "@/lib/ai/memory-doc";
import { openMemory, sealMemory } from "@/lib/ai/memory-seal.server";

type Config = {
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
  region: string;
  encryptionKey: string;
};

const FAIL = "Не удалось сохранить, попробуйте ещё раз";
const READ_FAIL = "Не удалось обновить память. Попробуйте ещё раз.";

function log(op: string, status: number | string) {
  console.info("[memory]", { op, status });
}

function statusOf(err: unknown): number | string {
  const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
  if (status) return status;
  const code = (err as { code?: string }).code;
  if (code && /^[0-9A-Z]{5}$/.test(code)) return code;
  return (err as { name?: string })?.name || "error";
}

function isMissing(err: unknown): boolean {
  const name = (err as { name?: string }).name;
  const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  return name === "NoSuchKey" || name === "NotFound" || status === 404;
}

function config(): Config | null {
  const bucket = process.env.VVVION_S3_BUCKET?.trim();
  const accessKeyId = process.env.VVVION_S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.VVVION_S3_SECRET_ACCESS_KEY?.trim();
  const encryptionKey = process.env.VVVION_MEMORY_ENCRYPTION_KEY?.trim();
  const storage = process.env.VVVION_MEMORY_STORAGE?.trim() || "s3";
  if (process.env.VVVION_MEMORY_ENABLED?.trim() === "false" || storage !== "s3") return null;
  if (!bucket || !accessKeyId || !secretAccessKey || !encryptionKey) return null;
  return {
    bucket,
    accessKeyId,
    secretAccessKey,
    endpoint: process.env.VVVION_S3_ENDPOINT?.trim() || "https://slc1.s3.yeapcloud.com",
    region: process.env.VVVION_S3_REGION?.trim() || "slc1",
    encryptionKey,
  };
}

function allowed(userId: string): boolean {
  const users = process.env.VVVION_MEMORY_USERS?.trim() || "*";
  if (!users || users === "*") return true;
  return users.split(",").map((item) => item.trim()).filter(Boolean).includes(userId);
}

let client: S3Client | null = null;
function s3(cfg: Config): S3Client {
  client ??= new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
  return client;
}

async function retry<T>(op: string, fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const status = statusOf(err);
      log(op, status);
      if (status === 400 || status === 401 || status === 403 || status === 404) throw err;
      await new Promise((resolve) => setTimeout(resolve, 120 * (attempt + 1)));
    }
  }
  throw last;
}

function backend(cfg: Config): MemoryBackend {
  return {
    async read(userId) {
      const key = memoryObjectKey(userId);
      try {
        const res = await s3(cfg).send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }), { abortSignal: AbortSignal.timeout(8000) });
        const bytes = res.Body ? await res.Body.transformToByteArray() : new Uint8Array();
        if (bytes.byteLength > 128 * 1024) throw new Error("MEMORY_READ_FAILED");
        const plain = openMemory(Buffer.from(bytes).toString("utf8"), cfg.encryptionKey);
        return { doc: cleanDocument(JSON.parse(plain)), etag: res.ETag || "1" };
      } catch (err) {
        if (isMissing(err)) return null;
        log("read", statusOf(err));
        throw new Error("MEMORY_READ_FAILED");
      }
    },
    async write(userId, doc) {
      const key = memoryObjectKey(userId);
      const plain = JSON.stringify(doc);
      if (plain.length > 64 * 1024) throw new Error("MEMORY_WRITE_FAILED");
      const body = sealMemory(plain, cfg.encryptionKey);
      await retry("write", () =>
        s3(cfg).send(
          new PutObjectCommand({
            Bucket: cfg.bucket,
            Key: key,
            Body: body,
            ContentType: "application/json",
            CacheControl: "private, no-store",
            ServerSideEncryption: "AES256",
          }),
          { abortSignal: AbortSignal.timeout(8000) },
        ),
      );
      return { etag: resEtag(body) };
    },
  };
}

function resEtag(body: string): string {
  let hash = 0;
  for (let i = 0; i < body.length; i += 1) hash = (hash * 33 + body.charCodeAt(i)) >>> 0;
  return hash.toString(16);
}

type MutateResult = CommitResult | { ok: false; error: "MEMORY_STORE_UNAVAILABLE"; message: string };

async function withLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("MEMORY_WRITE_FAILED");
  const { Client } = await import("pg");
  const db = new Client({ connectionString: url, connectionTimeoutMillis: 8000, query_timeout: 20000 });
  await db.connect();
  try {
    await db.query("begin");
    await db.query("set local statement_timeout = 20000");
    await db.query("select pg_advisory_xact_lock(('x' || substr(md5($1), 1, 16))::bit(64)::bigint)", [userId]);
    const value = await fn();
    const wrote = Boolean(value && typeof value === "object" && "wrote" in value && (value as CommitResult).ok && (value as { wrote?: boolean }).wrote);
    const revision = value && typeof value === "object" && "revision" in value ? Number((value as { revision?: number }).revision) : 0;
    if (wrote && revision > 0) {
      try {
        await db.query(
          `insert into memory_objects (user_id, revision, updated_at) values ($1, $2, now())
           on conflict (user_id) do update set revision = excluded.revision, updated_at = now()`,
          [userId, revision],
        );
      } catch (err) {
        log("meta", statusOf(err));
      }
    }
    await db.query("commit");
    return value;
  } catch (err) {
    await db.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    await db.end().catch(() => undefined);
  }
}

async function mutate(userId: string, produce: (doc: MemoryDocument, missing: boolean) => Produced): Promise<MutateResult> {
  if (!config() || !allowed(userId)) return { ok: false, error: "MEMORY_STORE_UNAVAILABLE", message: FAIL };
  try {
    memoryObjectKey(userId);
  } catch {
    return { ok: false, error: "REJECTED", message: FAIL };
  }
  const cfg = config();
  if (!cfg) return { ok: false, error: "MEMORY_STORE_UNAVAILABLE", message: FAIL };
  try {
    return await withLock(userId, () => commitMemory(backend(cfg), userId, produce));
  } catch (err) {
    log("write", statusOf(err));
    return { ok: false, error: "MEMORY_WRITE_FAILED", message: FAIL };
  }
}

function asView(result: MutateResult): MemoryResponse {
  if (!result.ok) {
    const message = result.error === "MEMORY_READ_FAILED" ? READ_FAIL : result.message || FAIL;
    return { ok: false, error: result.error, message };
  }
  return viewOf(result.doc, result.missing && !result.wrote);
}

export async function readMemoryProfile(userId: string): Promise<MemoryResponse> {
  const cfg = config();
  if (!cfg || !allowed(userId)) return { ok: false, error: "MEMORY_STORE_UNAVAILABLE", message: READ_FAIL };
  try {
    memoryObjectKey(userId);
    const found = await backend(cfg).read(userId);
    if (!found) return viewOf(emptyDocument(), true);
    return viewOf(found.doc, false);
  } catch (err) {
    log("read", statusOf(err));
    return { ok: false, error: "MEMORY_READ_FAILED", message: READ_FAIL };
  }
}

export async function writeMemoryProfile(userId: string, input: MemoryInput): Promise<MemoryResponse> {
  const now = new Date().toISOString();
  const result = await mutate(userId, (doc, missing) => {
    if (input.mode === "migrate") {
      const local = legacyFromInput(input);
      if (missing) {
        const created = documentFromLegacy(local, now);
        const changed = created.entries.some((entry) => !entry.deletedAt) || created.settings.enabled === false || created.settings.disabledChats.length > 0;
        return { doc: created, changed };
      }
      return mergeMigration(doc, local);
    }
    return applyEdit(doc, input, now);
  });
  return asView(result);
}

export async function applyAgentMemory(userId: string, name: string, args: unknown, clientTexts: string[]) {
  const row = args && typeof args === "object" ? (args as { text?: unknown }) : {};
  const text = typeof row.text === "string" ? row.text : "";
  if (name === "memory_list") {
    const view = await readMemoryProfile(userId);
    if (!view.ok) {
      const entries = clientTexts.map((item) => item.trim()).filter(Boolean).slice(0, 40);
      return { ok: true, changed: false, entries, text: JSON.stringify({ ok: true, stale: true, entries }) };
    }
    const entries = textsForModel(documentFromView(view), clientTexts);
    return { ok: true, changed: false, entries, revision: view.revision, text: JSON.stringify({ ok: true, entries }) };
  }
  const now = new Date().toISOString();
  if (name === "memory_save") {
    const result = await mutate(userId, (doc) => applyFact(doc, text, now));
    if (!result.ok) {
      return { ok: false, changed: false, text: JSON.stringify({ ok: false, saved: false, error: result.error === "REJECTED" ? "REJECTED" : "MEMORY_WRITE_FAILED" }) };
    }
    return { ok: true, changed: result.wrote, entries: liveTexts(result.doc), revision: result.revision, text: JSON.stringify({ ok: true, saved: true, revision: result.revision }) };
  }
  if (name === "memory_forget") {
    let forgotten = 0;
    const result = await mutate(userId, (doc) => {
      const outcome = applyForget(doc, text, now);
      forgotten = outcome.forgotten ?? 0;
      return outcome;
    });
    if (!result.ok) return { ok: false, changed: false, text: JSON.stringify({ ok: false, saved: false, error: result.error === "REJECTED" ? "REJECTED" : "MEMORY_WRITE_FAILED" }) };
    return {
      ok: true,
      changed: result.wrote,
      entries: liveTexts(result.doc),
      revision: result.revision,
      text: JSON.stringify({ ok: true, forgotten, revision: result.revision }),
    };
  }
  return { ok: false, changed: false, text: JSON.stringify({ ok: false, saved: false, error: "REJECTED" }) };
}
