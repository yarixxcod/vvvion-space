import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { auth, authConfigured } from "@/lib/auth/server";
import { getSql } from "@/lib/db";
import { assertAdmin } from "@/lib/social/access";

const CHUNK_MAX = 512 * 1024;
const MAX_BYTES = 80 * 1024 * 1024;
const BUNDLED_CODE = 5;
const BUNDLED_NAME = "2.3.0";
const BUNDLED_FILE = "vvvion-space-2.3.0.apk";
const BUNDLED_NOTES =
  "• Убрана белая полоса сверху при открытии клавиатуры\n• Красивая загрузка при запуске в стиле сайта\n• Экран «Связи нет» с кнопкой «Повторить», если сайт не открылся\n• Обновлены встроенные файлы сайта — запуск быстрее";

export type ReleaseView = {
  source: "live" | "builtin" | "none";
  versionCode: number;
  versionName: string;
  fileName: string;
  changelog: string;
  force: boolean;
  size: number;
};

type LiveRow = {
  slot: number;
  version_code: number;
  version_name: string;
  file_name: string;
  changelog: string;
  force_update: boolean;
  size: number;
  received: number;
  next_idx: number;
  ready: boolean;
};

let bundledCache: Uint8Array | null | undefined;

function json(status: number, body: unknown, extra?: HeadersInit): Response {
  const headers = new Headers(extra);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}

function siteOrigin(request: Request): string {
  const raw = request.headers.get("x-forwarded-host") || request.headers.get("host") || "";
  const host = raw.split(",")[0]?.trim() || "";
  const bare = host.split(":")[0]?.toLowerCase() || "";
  if (bare === "localhost" || bare === "127.0.0.1") return `http://${host}`;
  if (bare === "vvvion.space" || bare.endsWith(".vvvion.space")) return `https://${bare}`;
  return "https://vvvion.space";
}

async function bundledBytes(): Promise<Uint8Array | null> {
  if (bundledCache !== undefined) return bundledCache;
  const candidates = [
    fileURLToPath(new URL("./bundled-apk.bin", import.meta.url)),
    join(process.cwd(), "app-seed.apk"),
    join(process.cwd(), "src/lib/social/bundled-apk.bin"),
  ];
  for (const path of candidates) {
    try {
      const bytes = new Uint8Array(await readFile(path));
      if (bytes.byteLength > 1000 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
        bundledCache = bytes;
        return bytes;
      }
    } catch {
      /* next place */
    }
  }
  bundledCache = null;
  return null;
}

async function pref(): Promise<{ hide: boolean; last: number; slot: number | null }> {
  const sql = await getSql();
  const rows = await sql<{ hide_builtin: boolean; last_code: number; active_slot: number | null }>`
    select hide_builtin, last_code, active_slot from app_release_pref where id = 1
  `;
  const row = rows[0];
  return {
    hide: Boolean(row?.hide_builtin),
    last: Number(row?.last_code ?? 0),
    slot: row?.active_slot == null ? null : Number(row.active_slot),
  };
}

async function liveRow(): Promise<LiveRow | null> {
  const flag = await pref();
  if (flag.slot !== 1 && flag.slot !== 2) return null;
  const sql = await getSql();
  const rows = await sql<LiveRow>`
    select slot, version_code, version_name, file_name, changelog, force_update, size, received, next_idx, ready
    from app_release where slot = ${flag.slot} and ready
  `;
  const row = rows[0];
  if (!row) return null;
  return { ...row, slot: Number(row.slot), version_code: Number(row.version_code), size: Number(row.size), received: Number(row.received), next_idx: Number(row.next_idx) };
}

async function draftRow(): Promise<LiveRow | null> {
  const flag = await pref();
  const slot = flag.slot === 1 ? 2 : 1;
  const sql = await getSql();
  const rows = await sql<LiveRow>`
    select slot, version_code, version_name, file_name, changelog, force_update, size, received, next_idx, ready
    from app_release where slot = ${slot} and not ready
  `;
  const row = rows[0];
  if (!row) return null;
  return { ...row, slot: Number(row.slot), version_code: Number(row.version_code), size: Number(row.size), received: Number(row.received), next_idx: Number(row.next_idx) };
}

export async function releaseStatus(): Promise<{ current: ReleaseView | null; nextCode: number }> {
  const [live, flag, bundled] = await Promise.all([liveRow(), pref(), bundledBytes()]);
  const floor = Math.max(flag.last, live?.version_code ?? 0, !flag.hide && bundled ? BUNDLED_CODE : 0);
  if (live) {
    return {
      current: {
        source: "live",
        versionCode: live.version_code,
        versionName: live.version_name,
        fileName: live.file_name,
        changelog: live.changelog,
        force: Boolean(live.force_update),
        size: live.size,
      },
      nextCode: floor + 1,
    };
  }
  if (!flag.hide && bundled) {
    return {
      current: {
        source: "builtin",
        versionCode: BUNDLED_CODE,
        versionName: BUNDLED_NAME,
        fileName: BUNDLED_FILE,
        changelog: BUNDLED_NOTES,
        force: false,
        size: bundled.byteLength,
      },
      nextCode: Math.max(floor, BUNDLED_CODE) + 1,
    };
  }
  return { current: null, nextCode: Math.max(floor, 0) + 1 };
}

function versionDocument(origin: string, view: ReleaseView) {
  return {
    versionCode: view.versionCode,
    versionName: view.versionName,
    apkUrl: `${origin}/app/${view.fileName}`,
    changelog: view.changelog,
    force: view.force,
  };
}

export async function versionDocumentResponse(request: Request): Promise<Response> {
  const status = await releaseStatus();
  if (!status.current) {
    return json(200, { versionCode: 0, versionName: "0", apkUrl: "", changelog: "", force: false });
  }
  return json(200, versionDocument(siteOrigin(request), status.current));
}

function fileHeaders(name: string, size: number, range?: { start: number; end: number }): Headers {
  const headers = new Headers({
    "content-type": "application/vnd.android.package-archive",
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

function byteRange(header: string | null, size: number): { start: number; end: number } | "bad" | null {
  if (!header) return null;
  const match = /^bytes=(\d+)-(\d*)$/i.exec(header.trim());
  if (!match || size < 1) return "bad";
  const start = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= size || end < start) return "bad";
  return { start, end };
}

export async function apkFileResponse(request: Request, name: string): Promise<Response> {
  if (!/^[\w.-]+\.apk$/i.test(name) || name.includes("..")) return new Response("Не найдено", { status: 404 });
  const live = await liveRow();
  if (live && live.file_name === name) return streamLive(request, live);
  const flag = await pref();
  if (!flag.hide && !live && name === BUNDLED_FILE) {
    const bytes = await bundledBytes();
    if (bytes) return bytesResponse(request, BUNDLED_FILE, bytes);
  }
  return new Response("Не найдено", { status: 404 });
}

function bytesResponse(request: Request, name: string, bytes: Uint8Array): Response {
  const range = byteRange(request.headers.get("range"), bytes.byteLength);
  if (range === "bad") return new Response(null, { status: 416, headers: fileHeaders(name, bytes.byteLength) });
  const headers = fileHeaders(name, bytes.byteLength, range || undefined);
  if (request.method === "HEAD") return new Response(null, { status: range ? 206 : 200, headers });
  const slice = range ? bytes.subarray(range.start, range.end + 1) : bytes;
  const body = new Uint8Array(slice.byteLength);
  body.set(slice);
  return new Response(body.buffer as ArrayBuffer, { status: range ? 206 : 200, headers });
}

async function streamLive(request: Request, live: LiveRow): Promise<Response> {
  const sql = await getSql();
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
  if (range === "bad") return new Response(null, { status: 416, headers: fileHeaders(live.file_name, size) });
  const headers = fileHeaders(live.file_name, size, range || undefined);
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

async function requireAdmin(request: Request): Promise<string | Response> {
  const session = await auth.api.getSession({ headers: request.headers });
  const id = session?.user?.id;
  if (!id) {
    if (!authConfigured && !process.env.DATABASE_URL?.trim()) return "dev-user";
    return json(401, { message: "Нужен аккаунт" });
  }
  try {
    await assertAdmin(id);
  } catch (error) {
    return json(403, { message: error instanceof Error ? error.message : "Недостаточно прав" });
  }
  return id;
}

function cleanVersion(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (!/^[0-9]+(\.[0-9]+){1,3}$/.test(name)) throw new Error("Версия в виде 2.4.0");
  return name;
}

function cleanNotes(value: unknown): string {
  const text = typeof value === "string" ? value.replace(/\u0000/g, "").trim() : "";
  if (text.length > 2000) throw new Error("Текст обновления слишком длинный");
  return text;
}

async function baselineCode(): Promise<number> {
  const [live, flag, bundled] = await Promise.all([liveRow(), pref(), bundledBytes()]);
  if (live) return live.version_code;
  if (!flag.hide && bundled) return Math.max(flag.last, BUNDLED_CODE);
  return flag.last;
}

async function begin(body: Record<string, unknown>): Promise<Response> {
  const versionName = cleanVersion(body.versionName);
  const notes = cleanNotes(body.changelog);
  const force = body.force === true;
  const versionCode = typeof body.versionCode === "number" ? body.versionCode : Number(body.versionCode);
  const size = typeof body.size === "number" ? body.size : Number(body.size);
  if (!Number.isInteger(versionCode) || versionCode < 1 || versionCode > 1_000_000) throw new Error("Номер версии не подходит");
  const floor = await baselineCode();
  if (versionCode <= floor) throw new Error("Номер должен быть больше текущего, иначе телефон не предложит обновление");
  if (!Number.isInteger(size) || size < 1000 || size > MAX_BYTES) throw new Error("Файл пустой или больше 80 МБ");
  const fileName = `vvvion-space-${versionName}.apk`;
  const flag = await pref();
  const slot = flag.slot === 1 ? 2 : 1;
  const sql = await getSql();
  await sql`delete from app_release_chunks where slot = ${slot}`;
  await sql`delete from app_release where slot = ${slot}`;
  await sql`
    insert into app_release (slot, version_code, version_name, file_name, changelog, force_update, size)
    values (${slot}, ${versionCode}, ${versionName}, ${fileName}, ${notes}, ${force}, ${size})
  `;
  return json(200, { received: 0 });
}

async function takeChunk(body: Record<string, unknown>): Promise<Response> {
  const draft = await draftRow();
  if (!draft) throw new Error("Сначала начните отправку");
  const index = typeof body.index === "number" ? body.index : Number(body.index);
  if (!Number.isInteger(index) || index < 0) throw new Error("Кусок файла не принят");
  if (index < draft.next_idx) return json(200, { received: draft.received });
  if (index !== draft.next_idx) return json(409, { message: "Кусок пришёл не по порядку", received: draft.received });
  const data = typeof body.data === "string" ? body.data.replace(/\s/g, "") : "";
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error("Файл не удалось прочитать");
  const bytes = Buffer.from(data, "base64");
  if (bytes.length < 1 || bytes.length > CHUNK_MAX) throw new Error("Слишком большой кусок файла");
  if (draft.received + bytes.length > draft.size) throw new Error("Файл больше заявленного размера");
  if (index === 0 && (bytes[0] !== 0x50 || bytes[1] !== 0x4b)) throw new Error("Это не установщик");
  const sql = await getSql();
  await sql`
    with inserted as (
      insert into app_release_chunks (slot, idx, data, bytes)
      values (${draft.slot}, ${index}, ${data}, ${bytes.length})
      returning idx
    )
    update app_release
    set received = received + ${bytes.length}, next_idx = next_idx + 1
    where slot = ${draft.slot} and not ready and exists (select 1 from inserted)
  `;
  return json(200, { received: draft.received + bytes.length });
}

async function finish(): Promise<Response> {
  const draft = await draftRow();
  if (!draft) throw new Error("Сначала отправьте файл");
  if (draft.received !== draft.size) throw new Error("Файл отправился не целиком");
  const sql = await getSql();
  const flipped = await sql<{ slot: number }>`
    with marked as (
      update app_release set ready = true
      where slot = ${draft.slot} and received = size and not ready
      returning slot, version_code
    )
    insert into app_release_pref (id, active_slot, hide_builtin, last_code)
    select 1, slot, false, version_code from marked
    on conflict (id) do update
      set active_slot = excluded.active_slot, hide_builtin = false, last_code = excluded.last_code
    returning active_slot as slot
  `;
  if (!flipped.length) throw new Error("Файл отправился не целиком");
  const other = draft.slot === 1 ? 2 : 1;
  await sql`delete from app_release_chunks where slot = ${other}`;
  await sql`delete from app_release where slot = ${other}`;
  return json(200, await releaseStatus());
}

async function drop(): Promise<Response> {
  const live = await liveRow();
  const flag = await pref();
  const last = Math.max(flag.last, live?.version_code ?? 0, flag.hide ? 0 : BUNDLED_CODE);
  const sql = await getSql();
  await sql`
    with cleared_chunks as (
      delete from app_release_chunks
    ), cleared as (
      delete from app_release
    )
    insert into app_release_pref (id, active_slot, hide_builtin, last_code)
    values (1, null, true, ${last})
    on conflict (id) do update set active_slot = null, hide_builtin = true, last_code = ${last}
  `;
  return json(200, await releaseStatus());
}

export async function handleAppRelease(request: Request): Promise<Response> {
  const admin = await requireAdmin(request);
  if (admin instanceof Response) return admin;
  if (request.method === "GET") return json(200, await releaseStatus());
  if (request.method !== "POST") return json(405, { message: "Нельзя" });
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const op = body.op;
    if (op === "begin") return await begin(body);
    if (op === "chunk") return await takeChunk(body);
    if (op === "status") {
      const draft = await draftRow();
      return json(200, { received: draft?.received ?? 0, size: draft?.size ?? 0 });
    }
    if (op === "finish") return await finish();
    if (op === "drop") return await drop();
    return json(400, { message: "Неизвестное действие" });
  } catch (error) {
    return json(400, { message: error instanceof Error ? error.message : "Не получилось" });
  }
}

export async function handlePublicApp(request: Request): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Нельзя", { status: 405 });
  try {
    const path = decodeURIComponent(new URL(request.url).pathname);
    if (path === "/app/version.json") return await versionDocumentResponse(request);
    if (path.startsWith("/app/")) return await apkFileResponse(request, path.slice("/app/".length));
    return new Response("Не найдено", { status: 404 });
  } catch {
    return json(500, { message: "Обновление не открылось" });
  }
}
