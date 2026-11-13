import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { auth } from "@/lib/auth/server";
import { acceptUpload, claimedMime, serveFile } from "@/lib/social/file-accept";
import { getSql } from "@/lib/db";
import { assertActive } from "@/lib/social/access";
import { grantAchievement } from "@/lib/social/achievements";

export const CIRCLE_MAX = 200 * 1024 * 1024;
const CHUNK_MAX = 2_000_000;

type Meta = {
  userId: string;
  roomId: string;
  name: string;
  mime: string;
  size: number;
  received: number;
  next: number;
};

function rootDir(): string {
  return join(process.cwd(), ".data", "circle-files");
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function cleanName(value: string): string {
  const name = value.replace(/[^\p{L}\p{N}._ ()-]+/gu, "").trim().slice(0, 80);
  return name || "файл";
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

async function requireUser(request: Request): Promise<string | Response> {
  const headers = new Headers(request.headers);
  const token = new URL(request.url).searchParams.get("t");
  if (!headers.get("authorization") && token && token.length >= 16 && token.length <= 2000 && /^[\w.~+/-]+=*$/.test(token)) {
    headers.set("authorization", `Bearer ${token}`);
  }
  const session = await auth.api.getSession({ headers });
  const id = session?.user?.id;
  if (!id) return json(401, { message: "Нужен аккаунт" });
  try {
    await assertActive(id);
  } catch (error) {
    return json(403, { message: error instanceof Error ? error.message : "Аккаунт закрыт" });
  }
  return id;
}

async function assertMember(roomId: string, userId: string): Promise<"dm" | "group"> {
  const sql = await getSql();
  const rows = await sql<{ kind: string }>`
    select r.kind
    from rooms r
    join room_members m on m.room_id = r.id and m.user_id = ${userId}
    where r.id = ${roomId}
  `;
  const kind = rows[0]?.kind;
  if (kind !== "dm" && kind !== "group") throw new Error("Переписка не найдена");
  return kind;
}

async function isFriend(me: string, other: string): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql<{ n: number }>`
    select count(*) as n from friend_links
    where status = 'accepted'
      and ((from_id = ${me} and to_id = ${other}) or (from_id = ${other} and to_id = ${me}))
  `;
  return Number(rows[0]?.n ?? 0) > 0;
}

function paths(id: string): { bin: string; meta: string } {
  const dir = rootDir();
  return { bin: join(dir, id), meta: join(dir, `${id}.json`) };
}

async function readMeta(id: string): Promise<Meta | null> {
  const sql = await getSql();
  const rows = await sql<{
    user_id: string;
    room_id: string;
    name: string;
    mime: string;
    size: number;
    received: number;
    next_idx: number;
  }>`
    select user_id, room_id, name, mime, size, received, next_idx
    from file_uploads
    where id = ${id}
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    userId: row.user_id,
    roomId: row.room_id,
    name: row.name,
    mime: row.mime,
    size: Number(row.size),
    received: Number(row.received),
    next: Number(row.next_idx),
  };
}

export async function handleCircleUpload(request: Request): Promise<Response> {
  const userId = await requireUser(request);
  if (userId instanceof Response) return userId;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json(400, { message: "Файл не удалось прочитать" });
  }
  const op = typeof body.op === "string" ? body.op : "";
  try {
    if (op === "start") return await startUpload(userId, body);
    if (op === "chunk") return await takeChunk(userId, body);
    if (op === "finish") return await finishUpload(userId, body);
    if (op === "cancel") return await cancelUpload(userId, body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось отправить файл";
    return json(400, { message });
  }
  return json(400, { message: "Неизвестная операция" });
}

async function startUpload(userId: string, body: Record<string, unknown>): Promise<Response> {
  const chat = body.scope === "chat";
  const roomId = chat ? "chat" : typeof body.roomId === "string" ? body.roomId.trim() : "";
  if (!chat) {
    if (!isUuid(roomId)) throw new Error("Переписка не найдена");
    await assertMember(roomId, userId);
  }
  const size = typeof body.size === "number" ? body.size : Number(body.size);
  if (!Number.isFinite(size) || size < 1 || size > CIRCLE_MAX) throw new Error("Файл больше 200 МБ");
  const name = cleanName(typeof body.name === "string" ? body.name : "файл");
  const mime = claimedMime(typeof body.mime === "string" ? body.mime : "");
  if (!mime || mime === "image/svg+xml" || mime === "text/html" || mime.endsWith("+xml")) throw new Error("Этот тип файла не принимается");
  const id = crypto.randomUUID();
  const sql = await getSql();
  const bytes = Math.round(size);
  await sql`
    insert into file_uploads (id, user_id, room_id, name, mime, size)
    values (${id}, ${userId}, ${roomId}, ${name}, ${mime}, ${bytes})
  `;
  return json(200, { id });
}

async function takeChunk(userId: string, body: Record<string, unknown>): Promise<Response> {
  const id = typeof body.id === "string" ? body.id : "";
  if (!isUuid(id)) throw new Error("Загрузка не найдена");
  const meta = await readMeta(id);
  if (!meta || meta.userId !== userId) throw new Error("Загрузка не найдена");
  const index = typeof body.index === "number" ? body.index : Number(body.index);
  if (index !== meta.next) throw new Error("Кусок файла пришёл не по порядку");
  const data = typeof body.data === "string" ? body.data.replace(/\s/g, "") : "";
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error("Файл не удалось прочитать");
  const bytes = Buffer.from(data, "base64");
  if (bytes.length < 1 || bytes.length > CHUNK_MAX) throw new Error("Слишком большой кусок файла");
  if (meta.received + bytes.length > meta.size) throw new Error("Файл больше заявленного размера");
  const sql = await getSql();
  await sql`
    with inserted as (
      insert into file_chunks (id, idx, data, bytes)
      values (${id}, ${index}, ${data}, ${bytes.length})
      returning idx
    )
    update file_uploads
    set received = received + ${bytes.length}, next_idx = next_idx + 1
    where id = ${id} and exists (select 1 from inserted)
  `;
  return json(200, { received: meta.received + bytes.length });
}

async function cancelUpload(userId: string, body: Record<string, unknown>): Promise<Response> {
  const id = typeof body.id === "string" ? body.id : "";
  if (!isUuid(id)) return json(400, { message: "Загрузка не найдена" });
  const meta = await readMeta(id);
  if (!meta || meta.userId !== userId) return json(200, { ok: true });
  const sql = await getSql();
  const placed = await sql<{ id: string }>`select id from room_files where id = ${id} limit 1`;
  if (placed.length) return json(400, { message: "Файл уже сохранён" });
  await sql`delete from file_chunks where id = ${id}`;
  await sql`delete from file_uploads where id = ${id} and user_id = ${userId}`;
  return json(200, { ok: true });
}

async function signedMime(id: string, claimed: string): Promise<string> {
  const sql = await getSql();
  const rows = await sql<{ data: string }>`select data from file_chunks where id = ${id} and idx = 0`;
  const head = Buffer.from(rows[0]?.data || "", "base64").subarray(0, 64);
  const mime = acceptUpload(claimed, head);
  if (!mime) throw new Error("Этот тип файла не принимается");
  return mime;
}

async function finishUpload(userId: string, body: Record<string, unknown>): Promise<Response> {
  const id = typeof body.id === "string" ? body.id : "";
  if (!isUuid(id)) throw new Error("Загрузка не найдена");
  const meta = await readMeta(id);
  if (!meta || meta.userId !== userId) throw new Error("Загрузка не найдена");
  if (meta.received !== meta.size) throw new Error("Файл загрузился не целиком");
  const mime = await signedMime(id, meta.mime);
  const sql = await getSql();
  await sql`update file_uploads set mime = ${mime} where id = ${id}`;
  meta.mime = mime;
  if (meta.roomId === "chat" || body.scope === "chat") {
    void grantAchievement(userId, "file");
    return json(200, { id });
  }
  const text = typeof body.body === "string" ? body.body.trim().slice(0, 4000) : "";
  const attachTo = typeof body.messageId === "string" ? body.messageId.trim() : "";
  const kind = await assertMember(meta.roomId, userId);
  if (kind === "dm") {
    const peers = await sql<{ user_id: string }>`
      select user_id from room_members where room_id = ${meta.roomId} and user_id <> ${userId}
    `;
    const peer = peers[0]?.user_id;
    if (!peer || !(await isFriend(userId, peer))) throw new Error("Этот диалог доступен только друзьям");
  }
  let messageId = attachTo;
  if (messageId) {
    if (!isUuid(messageId)) throw new Error("Сообщение не найдено");
    const rows = await sql<{ id: string }>`
      select id from room_messages
      where id = ${messageId} and room_id = ${meta.roomId} and user_id = ${userId}
    `;
    if (!rows.length) throw new Error("Сообщение не найдено");
  } else {
    const recent = await sql<{ n: number }>`
      select count(*) as n from room_messages
      where user_id = ${userId} and created_at > now() - interval '10 minutes'
    `;
    if (Number(recent[0]?.n ?? 0) >= 40) throw new Error("Слишком много сообщений. Подождите немного.");
    messageId = crypto.randomUUID();
    await sql`
      insert into room_messages (id, room_id, user_id, body)
      values (${messageId}, ${meta.roomId}, ${userId}, ${text})
    `;
  }
  await sql`
    insert into room_files (id, room_id, message_id, user_id, name, mime, size, data, blob_path)
    values (${id}, ${meta.roomId}, ${messageId}, ${userId}, ${meta.name}, ${meta.mime}, ${meta.size}, ${""}, ${id})
  `;
  await sql`update rooms set updated_at = now() where id = ${meta.roomId}`;
  await sql`
    update room_members set last_read_at = now()
    where room_id = ${meta.roomId} and user_id = ${userId}
  `;
  void grantAchievement(userId, "file");
  const roomId = meta.roomId;
  const preview = text || "Файл";
  void import("@/lib/social/telegram.server")
    .then(async ({ notifyUser, senderName }) => {
      const members = await sql<{ user_id: string }>`
        select user_id from room_members where room_id = ${roomId} and user_id <> ${userId}
      `;
      if (!members.length) return;
      const name = await senderName(userId);
      const line = kind === "group" ? `${name} в группе:\n${preview}` : `Сообщение от ${name}:\n${preview}`;
      await Promise.all(members.map((member) => notifyUser(member.user_id, line)));
    })
    .catch(() => undefined);
  return json(200, { messageId });
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

function applyRange(headers: Headers, range: { start: number; end: number }, size: number): Headers {
  const next = new Headers(headers);
  next.set("accept-ranges", "bytes");
  next.set("content-range", `bytes ${range.start}-${range.end}/${size}`);
  next.set("content-length", String(range.end - range.start + 1));
  return next;
}

async function chunkBody(request: Request, id: string, name: string, mime: string, size: number): Promise<Response | null> {
  const sql = await getSql();
  const listed = await sql<{ idx: number; bytes: number }>`
    select idx, bytes from file_chunks where id = ${id} order by idx
  `;
  if (!listed.length) return null;
  const spans: { idx: number; bytes: number; start: number }[] = [];
  let cursor = 0;
  for (const row of listed) {
    let bytes = Number(row.bytes);
    if (!bytes) {
      const data = await sql<{ data: string }>`select data from file_chunks where id = ${id} and idx = ${row.idx}`;
      bytes = Buffer.from(data[0]?.data || "", "base64").length;
    }
    spans.push({ idx: Number(row.idx), bytes, start: cursor });
    cursor += bytes;
  }
  const total = cursor || size;
  const filename = cleanName(name);
  const served = serveFile(mime);
  const headers = new Headers({
    "content-type": served.type,
    "content-length": String(total),
    "cache-control": "private, max-age=3600",
    "x-content-type-options": "nosniff",
    "accept-ranges": "bytes",
    "content-disposition": `${served.inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(filename)}`,
  });
  const asked = byteRange(request.headers.get("range"), total);
  if (asked === "bad") return new Response(null, { status: 416, headers });
  if (request.method === "HEAD") {
    if (asked) return new Response(null, { status: 206, headers: applyRange(headers, asked, total) });
    return new Response(null, { status: 200, headers });
  }
  const start = asked ? asked.start : 0;
  const end = asked ? asked.end : total - 1;
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
      const rows = await sql<{ data: string }>`select data from file_chunks where id = ${id} and idx = ${span.idx}`;
      const raw = rows[0]?.data;
      if (!raw) {
        controller.error(new Error("chunk"));
        return;
      }
      const decoded = Buffer.from(raw, "base64");
      const from = Math.max(0, start - span.start);
      const to = Math.min(decoded.length, end - span.start + 1);
      controller.enqueue(from === 0 && to === decoded.length ? decoded : Buffer.from(decoded.subarray(from, to)));
    },
  });
  if (asked) return new Response(stream, { status: 206, headers: applyRange(headers, asked, total) });
  return new Response(stream, { status: 200, headers });
}

export async function readCircleFile(request: Request, id: string): Promise<Response> {
  if (!isUuid(id)) return json(404, { message: "Файл не найден" });
  const userId = await requireUser(request);
  if (userId instanceof Response) return userId;
  const sql = await getSql();
  const rows = await sql<{ name: string; mime: string; size: number; room_id: string; blob_path: string | null; data: string }>`
    select name, mime, size, room_id, blob_path, data
    from room_files
    where id = ${id}
  `;
  const file = rows[0];
  if (!file) {
    const meta = await readMeta(id);
    if (!meta || meta.userId !== userId || meta.roomId !== "chat" || meta.received !== meta.size) return json(404, { message: "Файл не найден" });
    const body = await chunkBody(request, id, meta.name, meta.mime, meta.size);
    return body ?? json(404, { message: "Файл не найден" });
  }
  try {
    await assertMember(file.room_id, userId);
  } catch (error) {
    return json(403, { message: error instanceof Error ? error.message : "Файл не найден" });
  }
  const filename = cleanName(file.name);
  const served = serveFile(file.mime);
  const headers = new Headers({
    "content-type": served.type,
    "cache-control": "private, max-age=3600",
    "x-content-type-options": "nosniff",
    "content-disposition": `${served.inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(filename)}`,
  });
  headers.set("accept-ranges", "bytes");
  if (file.blob_path && isUuid(file.blob_path)) {
    const fromDb = await chunkBody(request, file.blob_path, file.name, file.mime, Number(file.size));
    if (fromDb) return fromDb;
    try {
      const info = await stat(paths(file.blob_path).bin);
      const size = info.size;
      headers.set("content-length", String(size));
      const asked = byteRange(request.headers.get("range"), size);
      if (asked === "bad") return new Response(null, { status: 416, headers });
      if (request.method === "HEAD") {
        return new Response(null, { status: asked ? 206 : 200, headers: asked ? applyRange(headers, asked, size) : headers });
      }
      const stream = createReadStream(paths(file.blob_path).bin, asked ? { start: asked.start, end: asked.end } : undefined);
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: asked ? 206 : 200,
        headers: asked ? applyRange(headers, asked, size) : headers,
      });
    } catch {
      return json(404, { message: "Файл не найден" });
    }
  }
  const bytes = Buffer.from(file.data || "", "base64");
  const size = bytes.length;
  headers.set("content-length", String(size));
  const asked = byteRange(request.headers.get("range"), size);
  if (asked === "bad") return new Response(null, { status: 416, headers });
  if (request.method === "HEAD") {
    return new Response(null, { status: asked ? 206 : 200, headers: asked ? applyRange(headers, asked, size) : headers });
  }
  if (!asked) return new Response(bytes, { status: 200, headers });
  const slice = bytes.subarray(asked.start, asked.end + 1);
  return new Response(slice, { status: 206, headers: applyRange(headers, asked, size) });
}
