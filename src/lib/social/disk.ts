import { zipSync } from "fflate";
import { auth } from "@/lib/auth/server";
import { getSql } from "@/lib/db";
import { playbackType } from "@/lib/music/tags";
import { assertActive } from "@/lib/social/access";
import { DISK_ID, diskPath } from "@/lib/social/disk-path";
import { isPremium, PREMIUM_DISK } from "@/lib/social/premium";

export const DISK_BASE = 100 * 1024 * 1024;
export const DISK_STEP = 100 * 1024 * 1024;
export const DISK_COST = 1000;
const MIN_FREE = 200_000;
const AUDIO_MAX = 4_000_000;
const IMAGE_MAX = 8_000_000;

export type DiskFile = {
  id: string;
  name: string;
  mime: string;
  bytes: number;
  kind: "image" | "audio";
  folderId: string | null;
  createdAt: string;
  url: string;
};

export type DiskFolder = {
  id: string;
  name: string;
};

export type DiskSnapshot = {
  used: number;
  quota: number;
  folders: DiskFolder[];
  files: DiskFile[];
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export function newId(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function diskName(value: string): string {
  const name = value.replace(/[^\p{L}\p{N}._ ()\-]+/gu, "").trim().slice(0, 80);
  if (!name || name === "." || name === "..") throw new Error("Так не назвать");
  return name;
}

function cleanName(value: string, fallback: string): string {
  try {
    return diskName(value);
  } catch {
    return fallback;
  }
}

export async function quotaOf(userId: string): Promise<{ used: number; quota: number }> {
  const sql = await getSql();
  await sql`
    insert into disk_accounts (user_id, bonus_bytes)
    values (${userId}, 0)
    on conflict (user_id) do nothing
  `;
  const rows = await sql<{ used: number | string; bonus: number | string }>`
    select coalesce((select sum(bytes) from disk_files where user_id = ${userId}), 0) as used,
           bonus_bytes as bonus
    from disk_accounts
    where user_id = ${userId}
  `;
  const used = Number(rows[0]?.used ?? 0);
  const bonus = Number(rows[0]?.bonus ?? 0);
  const extra = (await isPremium(userId)) ? PREMIUM_DISK : 0;
  return { used, quota: DISK_BASE + (Number.isFinite(bonus) ? bonus : 0) + extra };
}

export async function diskFree(userId: string): Promise<number> {
  const { used, quota } = await quotaOf(userId);
  return Math.max(0, quota - used);
}

export async function assertDiskRoom(userId: string): Promise<string | null> {
  const free = await diskFree(userId);
  if (free < MIN_FREE) return "На диске нет места. В магазине можно докупить ещё 100 МБ.";
  return null;
}

async function putFile(
  userId: string,
  name: string,
  mime: string,
  kind: "image" | "audio",
  bytes: Uint8Array,
): Promise<string | "full"> {
  if (bytes.length < 32) throw new Error("Файл пустой");
  const sql = await getSql();
  await sql`
    insert into disk_accounts (user_id, bonus_bytes)
    values (${userId}, 0)
    on conflict (user_id) do nothing
  `;
  const id = newId();
  const data = Buffer.from(bytes).toString("base64");
  const extra = (await isPremium(userId)) ? PREMIUM_DISK : 0;
  const rows = await sql<{ id: string }>`
    with room as (
      select ( ${DISK_BASE} + ${extra} + bonus_bytes
               - coalesce((select sum(bytes) from disk_files where user_id = ${userId}), 0)
             ) as free
      from disk_accounts
      where user_id = ${userId}
    )
    insert into disk_files (id, user_id, name, mime, bytes, kind, data)
    select ${id}, ${userId}, ${name}, ${mime}, ${bytes.length}, ${kind}, ${data}
    where exists (select 1 from room where free >= ${bytes.length})
    returning id
  `;
  if (!rows[0]?.id) return "full";
  void import("@/lib/social/push.server")
    .then((mod) => mod.pushDiskLevel(userId))
    .catch(() => undefined);
  return diskPath(rows[0].id);
}

export async function storeDiskImage(userId: string, dataUrl: string): Promise<string | "full" | null> {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/_=\s-]+)$/i.exec(dataUrl.trim());
  if (!match) return null;
  let mime = (match[1] || "").toLowerCase().split(";")[0] || "";
  if (mime === "image/jpg") mime = "image/jpeg";
  if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(mime)) return null;
  let body = (match[2] || "").replace(/\s/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = body.length % 4;
  if (pad) body += "=".repeat(4 - pad);
  let bytes: Buffer;
  try {
    bytes = Buffer.from(body, "base64");
  } catch {
    return null;
  }
  if (bytes.length < 32 || bytes.length > IMAGE_MAX) return null;
  const stamp = new Date();
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const ext = mime === "image/jpeg" ? "jpg" : mime.slice(6);
  const name = `vvvion-${stamp.getFullYear()}${pad2(stamp.getMonth() + 1)}${pad2(stamp.getDate())}-${pad2(stamp.getHours())}${pad2(stamp.getMinutes())}${pad2(stamp.getSeconds())}.${ext}`;
  return putFile(userId, name, mime, "image", bytes);
}

async function requireUser(request: Request): Promise<string | Response> {
  const session = await auth.api.getSession({ headers: request.headers });
  const id = session?.user?.id;
  if (!id) return json(401, { message: "Нужен аккаунт" });
  try {
    await assertActive(id);
  } catch (error) {
    return json(403, { message: error instanceof Error ? error.message : "Аккаунт закрыт" });
  }
  return id;
}

function fileResponse(request: Request, row: { data: string; mime: string; name: string }, download: boolean): Response {
  const bytes = Buffer.from(row.data, "base64");
  const headers = new Headers({
    "content-type": playbackType(row.name, row.mime || ""),
    "content-length": String(bytes.length),
    "cache-control": "private, max-age=86400",
    "x-content-type-options": "nosniff",
  });
  const filename = cleanName(row.name, "file");
  headers.set(
    "content-disposition",
    `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(filename)}`,
  );
  if (request.method === "HEAD") return new Response(null, { status: 200, headers });
  return new Response(bytes, { status: 200, headers });
}

export async function readDiskFile(request: Request, id: string): Promise<Response> {
  if (!DISK_ID.test(id)) return json(404, { message: "Файл не найден" });
  const sql = await getSql();
  const meta = await sql<{ user_id: string }>`
    select user_id from disk_files where id = ${id} limit 1
  `;
  const ownerId = meta[0]?.user_id;
  if (!ownerId) return json(404, { message: "Файл не найден" });
  const share = new URL(request.url).searchParams.get("s") || "";
  let allowed = false;
  if (share && DISK_ID.test(share)) {
    const open = await sql<{ ok: number }>`
      select 1 as ok from disk_shares where token = ${share} and user_id = ${ownerId} limit 1
    `;
    allowed = Boolean(open[0]);
  }
  if (!allowed) {
    const session = await auth.api.getSession({ headers: request.headers });
    const userId = session?.user?.id;
    if (!userId || userId !== ownerId) return json(404, { message: "Файл не найден" });
    try {
      await assertActive(userId);
    } catch (error) {
      return json(403, { message: error instanceof Error ? error.message : "Аккаунт закрыт" });
    }
  }
  const rows = await sql<{ data: string; mime: string; name: string }>`
    select data, mime, name from disk_files where id = ${id} and user_id = ${ownerId} limit 1
  `;
  const row = rows[0];
  if (!row?.data) return json(404, { message: "Файл не найден" });
  const download = new URL(request.url).searchParams.get("dl") === "1";
  return fileResponse(request, row, download);
}

async function replaceAudio(userId: string, form: FormData): Promise<Response> {
  const id = typeof form.get("id") === "string" ? String(form.get("id")) : "";
  if (!DISK_ID.test(id)) return json(404, { message: "Файл не найден" });
  const file = form.get("file");
  if (!(file instanceof File)) return json(400, { message: "Нет файла" });
  if (file.size < 32 || file.size > AUDIO_MAX) return json(400, { message: "После правки файл пустой или больше 4 МБ" });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sql = await getSql();
  await sql`
    insert into disk_accounts (user_id, bonus_bytes)
    values (${userId}, 0)
    on conflict (user_id) do nothing
  `;
  const owned = await sql<{ id: string }>`
    select id from disk_files where id = ${id} and user_id = ${userId} and kind = 'audio'
  `;
  if (!owned[0]) return json(404, { message: "Файл не найден" });
  const extra = (await isPremium(userId)) ? PREMIUM_DISK : 0;
  const data = Buffer.from(bytes).toString("base64");
  const rows = await sql<{ id: string }>`
    with room as (
      select (
        ${DISK_BASE} + ${extra} + a.bonus_bytes
        - coalesce((select sum(bytes) from disk_files where user_id = ${userId}), 0)
        + f.bytes
      ) as free
      from disk_accounts a
      join disk_files f on f.user_id = a.user_id
      where a.user_id = ${userId} and f.id = ${id} and f.kind = 'audio'
    )
    update disk_files
    set data = ${data}, bytes = ${bytes.length}
    where id = ${id} and user_id = ${userId} and kind = 'audio'
      and exists (select 1 from room where free >= ${bytes.length})
    returning id
  `;
  if (!rows[0]) return json(409, { message: "На диске нет места" });
  return json(200, { ok: true });
}

export async function uploadVoice(request: Request): Promise<Response> {
  const userId = await requireUser(request);
  if (userId instanceof Response) return userId;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json(400, { message: "Нет записи" });
  }
  if (form.get("op") === "replace") return replaceAudio(userId, form);
  const file = form.get("file");
  if (!(file instanceof File)) return json(400, { message: "Нет записи" });
  const mime = (file.type || "audio/webm").split(";")[0].trim().toLowerCase();
  if (!mime.startsWith("audio/") && mime !== "video/webm") return json(400, { message: "Нужен звуковой файл" });
  if (file.size < 400 || file.size > AUDIO_MAX) return json(400, { message: "Запись слишком короткая или больше 4 МБ" });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const storedMime = mime === "video/webm" ? "audio/webm" : mime;
  const ext = storedMime.includes("mp4") ? "m4a" : storedMime.includes("mpeg") ? "mp3" : storedMime.includes("ogg") ? "ogg" : storedMime.includes("wav") ? "wav" : "webm";
  let stored: string | "full";
  try {
    stored = await putFile(userId, cleanName(file.name, `voice.${ext}`), storedMime, "audio", bytes);
  } catch (error) {
    return json(400, { message: error instanceof Error ? error.message : "Не удалось сохранить запись" });
  }
  if (stored === "full") return json(409, { message: "На диске нет места. В банке можно докупить ещё 100 МБ." });
  return json(200, { url: stored, name: cleanName(file.name, `voice.${ext}`), mime: storedMime, bytes: bytes.length });
}

export async function zipDisk(request: Request): Promise<Response> {
  const userId = await requireUser(request);
  if (userId instanceof Response) return userId;
  const sql = await getSql();
  const rows = await sql<{ name: string; mime: string; data: string }>`
    select name, mime, data from disk_files
    where user_id = ${userId}
    order by created_at asc
    limit 400
  `;
  if (!rows.length) return json(404, { message: "Диск пуст" });
  const files: Record<string, Uint8Array> = {};
  const used = new Set<string>();
  rows.forEach((row, index) => {
    let name = cleanName(row.name, `file-${index + 1}`);
    if (!name.includes(".")) {
      const ext = row.mime === "image/jpeg" ? "jpg" : row.mime.startsWith("image/") ? row.mime.slice(6) : row.mime.includes("mp4") ? "m4a" : "webm";
      name = `${name}.${ext}`;
    }
    const base = name;
    let n = 2;
    while (used.has(name)) {
      const dot = base.lastIndexOf(".");
      name = dot > 0 ? `${base.slice(0, dot)}-${n}${base.slice(dot)}` : `${base}-${n}`;
      n += 1;
    }
    used.add(name);
    files[name] = new Uint8Array(Buffer.from(row.data, "base64"));
  });
  const zipped = zipSync(files, { level: 0 });
  const body = Buffer.from(zipped);
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/zip",
      "content-length": String(body.byteLength),
      "content-disposition": "attachment; filename=\"vvvion-disk.zip\"",
      "cache-control": "no-store",
    },
  });
}

export async function readDisk(userId: string): Promise<DiskSnapshot> {
  const { used, quota } = await quotaOf(userId);
  const sql = await getSql();
  const rows = await sql<{
    id: string;
    name: string;
    mime: string;
    bytes: number;
    kind: string;
    folder_id: string | null;
    created_at: string;
  }>`
    select id, name, mime, bytes, kind, folder_id, created_at::text as created_at
    from disk_files
    where user_id = ${userId}
    order by created_at desc
    limit 200
  `;
  const folders = await sql<{ id: string; name: string }>`
    select id, name from disk_folders
    where user_id = ${userId}
    order by lower(name)
  `;
  return {
    used,
    quota,
    folders,
    files: rows.map((row) => ({
      id: row.id,
      name: row.name,
      mime: row.mime,
      bytes: Number(row.bytes),
      kind: row.kind === "audio" ? "audio" : "image",
      folderId: row.folder_id,
      createdAt: row.created_at,
      url: diskPath(row.id),
    })),
  };
}
