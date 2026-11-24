import { createHash } from "node:crypto";
import type { Sql } from "@/lib/db";
import { compareSemver, cleanSignature, exeName, parseUpdatePath, semverNewer, semverOk, updateWanted, updaterBody, WINDOWS_MAX, WINDOWS_MIN } from "@/lib/social/release-rules";
import { releasePrefix, releaseStore, removeRelease, streamObject, type BlobStore } from "@/lib/social/release-blob.server";

const PLATFORM = "windows-x86_64";

type Row = {
  slot: number;
  version_name: string;
  file_name: string;
  changelog: string;
  signature: string;
  size: number;
  received: number;
  next_idx: number;
  ready: boolean;
  published_at: string | null;
};

function num(value: string | number | null | undefined): number {
  const next = Number(value ?? 0);
  return Number.isFinite(next) ? next : 0;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function empty(): Response {
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}

function originOf(request: Request): string {
  const raw = request.headers.get("x-forwarded-host") || request.headers.get("host") || "";
  const host = raw.split(",")[0]?.trim() || "";
  const bare = host.split(":")[0]?.toLowerCase() || "";
  if (bare === "localhost" || bare === "127.0.0.1") return `http://${host}`;
  if (bare === "vvvion.space" || bare.endsWith(".vvvion.space") || bare.endsWith(".vercel.app")) return `https://${bare}`;
  return "https://vvvion.space";
}

async function pref(sql: Sql): Promise<{ slot: number | null; last: string }> {
  const rows = await sql<{ active_slot: number | null; last_version: string }>`select active_slot, last_version from desktop_release_pref where id = 1`;
  const row = rows[0];
  return { slot: row?.active_slot == null ? null : num(row.active_slot), last: row?.last_version || "" };
}

async function rowAt(sql: Sql, slot: number, ready: boolean): Promise<Row | null> {
  const rows = await sql<Row>`
    select slot, version_name, file_name, changelog, signature, size, received, next_idx, ready, published_at
    from desktop_release where slot = ${slot} and ready = ${ready}
  `;
  const row = rows[0];
  if (!row) return null;
  return { ...row, slot: num(row.slot), size: num(row.size), received: num(row.received), next_idx: num(row.next_idx) };
}

async function live(sql: Sql): Promise<Row | null> {
  const flag = await pref(sql);
  if (flag.slot !== 1 && flag.slot !== 2) return null;
  return rowAt(sql, flag.slot, true);
}

async function draft(sql: Sql): Promise<Row | null> {
  const flag = await pref(sql);
  return rowAt(sql, flag.slot === 1 ? 2 : 1, false);
}

function view(row: Row, origin: string) {
  return {
    version: row.version_name,
    fileName: row.file_name,
    changelog: row.changelog,
    size: row.size,
    publishedAt: row.published_at,
    url: `${origin}/app/desktop/${row.file_name}`,
  };
}

export async function desktopStatus(sql: Sql, origin = "https://vvvion.space") {
  const row = await live(sql);
  return { platform: "windows" as const, current: row ? view(row, origin) : null };
}

export async function desktopBegin(sql: Sql, store: BlobStore, body: Record<string, unknown>): Promise<Response> {
  const version = typeof body.versionName === "string" ? body.versionName.trim() : typeof body.version === "string" ? body.version.trim() : "";
  if (!semverOk(version)) throw new Error("Версия в виде 0.2.0");
  // eslint-disable-next-line no-control-regex -- Strip forbidden control bytes from untrusted input.
  const notes = typeof body.changelog === "string" ? body.changelog.replace(/\u0000/g, "").trim() : "";
  if (notes.length > 2000) throw new Error("Текст обновления слишком длинный");
  const signature = cleanSignature(body.signature);
  if (!signature) throw new Error("Подпись не подходит");
  const size = num(body.size as number);
  if (!Number.isInteger(size) || size < WINDOWS_MIN || size > WINDOWS_MAX) throw new Error("Файл пустой или больше 150 МБ");
  const current = await live(sql);
  const flag = await pref(sql);
  if (!semverNewer(version, current?.version_name || flag.last)) throw new Error("Версия должна быть больше опубликованной");
  const slot = flag.slot === 1 ? 2 : 1;
  const previous = await sql<{ size: number }>`select size from desktop_release where slot = ${slot}`;
  if (previous[0]) await removeRelease(store, releasePrefix("windows", slot), num(previous[0].size));
  await sql`delete from desktop_release where slot = ${slot}`;
  const file = exeName(version);
  await sql`
    insert into desktop_release (slot, version_name, file_name, changelog, signature, platform, size)
    values (${slot}, ${version}, ${file}, ${notes}, ${signature}, ${PLATFORM}, ${size})
  `;
  return json(200, { received: 0 });
}

export async function desktopChunk(sql: Sql, store: BlobStore, body: Record<string, unknown>): Promise<Response> {
  const row = await draft(sql);
  if (!row) throw new Error("Сначала начните отправку");
  const index = num(body.index as number);
  if (!Number.isInteger(index) || index < 0) throw new Error("Кусок файла не принят");
  if (index < row.next_idx) return json(200, { received: row.received });
  if (index !== row.next_idx) return json(409, { message: "Кусок пришёл не по порядку", received: row.received });
  const data = typeof body.data === "string" ? body.data.replace(/\s/g, "") : "";
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error("Файл не удалось прочитать");
  const bytes = Buffer.from(data, "base64");
  if (bytes.length < 1 || bytes.length > 512 * 1024) throw new Error("Слишком большой кусок файла");
  if (row.received + bytes.length > row.size) throw new Error("Файл больше заявленного размера");
  if (index === 0 && (bytes[0] !== 0x4d || bytes[1] !== 0x5a)) throw new Error("Это не установщик Windows");
  await store.put(`${releasePrefix("windows", row.slot)}/${index}`, bytes);
  await sql`
    update desktop_release set received = received + ${bytes.length}, next_idx = next_idx + 1
    where slot = ${row.slot} and not ready and next_idx = ${index}
  `;
  return json(200, { received: row.received + bytes.length });
}

export async function desktopFinish(sql: Sql, store: BlobStore): Promise<Response> {
  const row = await draft(sql);
  if (!row) throw new Error("Сначала отправьте файл");
  if (row.received !== row.size) throw new Error("Файл отправился не целиком");
  const hash = createHash("sha256");
  for (let index = 0; index < row.next_idx; index += 1) {
    const bytes = await store.get(`${releasePrefix("windows", row.slot)}/${index}`);
    if (!bytes) throw new Error("Файл в хранилище не собрался");
    hash.update(bytes);
  }
  const flipped = await sql<{ slot: number }>`
    with marked as (
      update desktop_release
      set ready = true, sha256 = ${hash.digest("hex")}, published_at = now()
      where slot = ${row.slot} and received = size and not ready
      returning slot, version_name
    )
    insert into desktop_release_pref (id, active_slot, last_version)
    select 1, slot, version_name from marked
    on conflict (id) do update set active_slot = excluded.active_slot, last_version = excluded.last_version
    returning active_slot as slot
  `;
  if (!flipped.length) throw new Error("Файл отправился не целиком");
  const other = row.slot === 1 ? 2 : 1;
  const old = await sql<{ size: number }>`select size from desktop_release where slot = ${other}`;
  if (old[0]) await removeRelease(store, releasePrefix("windows", other), num(old[0].size));
  await sql`delete from desktop_release where slot = ${other}`;
  return json(200, await desktopStatus(sql));
}

export async function desktopDrop(sql: Sql, store: BlobStore): Promise<Response> {
  const rows = await sql<{ slot: number; size: number; version_name: string }>`select slot, size, version_name from desktop_release`;
  for (const row of rows) await removeRelease(store, releasePrefix("windows", num(row.slot)), num(row.size));
  const last = rows.reduce((best, row) => (compareSemver(row.version_name, best) > 0 ? row.version_name : best), "");
  await sql`delete from desktop_release`;
  await sql`
    insert into desktop_release_pref (id, active_slot, last_version)
    values (1, null, ${last})
    on conflict (id) do update set active_slot = null, last_version = excluded.last_version
  `;
  return json(200, await desktopStatus(sql));
}

export async function desktopUpdate(sql: Sql, request: Request): Promise<Response> {
  const path = parseUpdatePath(new URL(request.url).pathname);
  if (!path || !updateWanted(path)) return empty();
  const row = await live(sql);
  if (!row || !semverNewer(row.version_name, path.version)) return empty();
  const origin = originOf(request);
  return json(200, updaterBody({
    version: row.version_name,
    notes: row.changelog,
    publishedAt: row.published_at ? new Date(row.published_at).toISOString() : new Date().toISOString(),
    url: `${origin}/app/desktop/${row.file_name}`,
    signature: row.signature,
  }));
}

export async function desktopLatest(sql: Sql, request: Request): Promise<Response> {
  const row = await live(sql);
  if (!row) return new Response("Не найдено", { status: 404 });
  return Response.redirect(`${originOf(request)}/app/desktop/${row.file_name}`, 302);
}

export async function desktopBytes(sql: Sql, store: BlobStore, request: Request, name: string): Promise<Response> {
  if (!/^[\w.-]+\.exe$/i.test(name) || name.includes("..")) return new Response("Не найдено", { status: 404 });
  const row = await live(sql);
  if (!row || row.file_name !== name) return new Response("Не найдено", { status: 404 });
  return streamObject(store, releasePrefix("windows", row.slot), row.file_name, row.size, request, "application/octet-stream");
}

export async function handleDesktopRelease(request: Request, body?: Record<string, unknown>): Promise<Response> {
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  const store = releaseStore();
  if (!store) return json(503, { message: "Хранилище файлов не настроено" });
  if (request.method === "GET") return json(200, await desktopStatus(sql, originOf(request)));
  const op = body?.op;
  if (op === "begin") return desktopBegin(sql, store, body || {});
  if (op === "chunk") return desktopChunk(sql, store, body || {});
  if (op === "status") {
    const row = await draft(sql);
    return json(200, { received: row?.received ?? 0, size: row?.size ?? 0 });
  }
  if (op === "finish") return desktopFinish(sql, store);
  if (op === "drop") return desktopDrop(sql, store);
  return json(400, { message: "Неизвестное действие" });
}
