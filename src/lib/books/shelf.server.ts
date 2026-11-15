import { getSql } from "@/lib/db";
import { auth } from "@/lib/auth/server";
import { assertActive } from "@/lib/social/access";
import { bytesResponse } from "@/lib/http/byte-range";
import type { BookFormat } from "@/lib/books/types";

const MAX_BYTES = 20 * 1024 * 1024;
const CHUNK_MAX = 1_500_000;
const DIRECT_MAX = 3_500_000;
const FORMATS = new Set<BookFormat>(["epub", "fb2", "txt", "pdf"]);

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function clip(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  // eslint-disable-next-line no-control-regex -- Strip forbidden control bytes from untrusted input.
  return value.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

async function requireUser(request: Request): Promise<string | Response> {
  const session = await auth.api.getSession({ headers: request.headers });
  const id = session?.user?.id;
  if (!id) return json(401, { message: "Нужен аккаунт" });
  try {
    await assertActive(id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Аккаунт заблокирован";
    return json(403, { message });
  }
  return id;
}

export async function handleBookUpload(request: Request): Promise<Response> {
  const type = request.headers.get("content-type") || "";
  if (type.includes("application/json")) return handleBookParts(request);
  const userId = await requireUser(request);
  if (userId instanceof Response) return userId;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json(400, { message: "Файл не дошёл" });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return json(400, { message: "Нужен файл книги" });
  if (file.size > MAX_BYTES) return json(413, { message: "Книга больше 20 МБ" });
  if (file.size > DIRECT_MAX) return json(413, { message: "Файл крупный, отправьте его частями" });
  const format = clip(form.get("format"), 8) as BookFormat;
  if (!FORMATS.has(format)) return json(400, { message: "Этот формат здесь не читается" });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength < 16) return json(400, { message: "В файле почти ничего нет" });
  const title = clip(form.get("title"), 180) || clip(file.name.replace(/\.[^.]+$/, ""), 180) || "Без названия";
  const author = clip(form.get("author"), 180);
  const language = clip(form.get("language"), 16);
  const fileName = clip(file.name, 180) || "book";
  const cover = takeCover(form.get("cover"));
  const words = countField(form.get("words"), 5_000_000);
  const chapters = countField(form.get("chapters"), 2000);
  try {
    const id = await storeBook(userId, { title, author, language, format, cover, fileName, words, chapters, bytes });
    return json(200, { id, title });
  } catch (err) {
    if (err instanceof Error && err.message === "Книга сохранилась не целиком") {
      return json(500, { message: "Книга не сохранилась целиком. Попробуйте ещё раз." });
    }
    throw err;
  }
}

const SHARE_TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

export async function handleSharedBookFile(request: Request, token: string): Promise<Response> {
  if (!SHARE_TOKEN.test(token)) return json(404, { message: "Книга не найдена" });
  const sql = await getSql();
  const rows = await sql<{ payload: string; format: string; file_name: string }>`
    select f.payload, b.format, b.file_name
    from shelf_files f
    join shelf_books b on b.id = f.book_id
    where b.share_token = ${token}
    limit 1
  `;
  const row = rows[0];
  if (!row?.payload) return json(404, { message: "Книга не найдена" });
  const bytes = Buffer.from(row.payload, "base64");
  return fileBytes(request, bytes, row.format);
}

export async function handleBookFile(request: Request, id: string): Promise<Response> {
  const userId = await requireUser(request);
  if (userId instanceof Response) return userId;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json(404, { message: "Книга не найдена" });
  const sql = await getSql();
  const rows = await sql<{ payload: string; format: string; file_name: string }>`
    select f.payload, b.format, b.file_name
    from shelf_files f
    join shelf_books b on b.id = f.book_id
    where f.book_id = ${id}
    limit 1
  `;
  const row = rows[0];
  if (!row?.payload) return json(404, { message: "Книга не найдена" });
  const bytes = Buffer.from(row.payload, "base64");
  return fileBytes(request, bytes, row.format);
}

function fileBytes(request: Request, bytes: Buffer, format: string): Response {
  const headers = new Headers({
    "content-type": format === "pdf" ? "application/pdf" : "application/octet-stream",
    "cache-control": "private, no-store",
    "x-robots-tag": "noindex, nofollow, noarchive",
    "content-disposition": "inline",
  });
  return bytesResponse(request, new Uint8Array(bytes), headers);
}

function takeCover(value: unknown): string {
  return typeof value === "string" && value.startsWith("data:image/") && value.length <= 700_000 ? value : "";
}

function countField(value: unknown, max: number): number {
  return Math.max(0, Math.min(max, Math.floor(Number(value) || 0)));
}

async function storeBook(
  userId: string,
  book: { title: string; author: string; language: string; format: BookFormat; cover: string; fileName: string; words: number; chapters: number; bytes: Uint8Array },
): Promise<string> {
  const id = crypto.randomUUID();
  const payload = Buffer.from(book.bytes).toString("base64");
  const sql = await getSql();
  await sql`
    insert into shelf_books (
      id, owner_id, title, author, language, format, cover, file_name, words, chapters
    ) values (
      ${id}, ${userId}, ${book.title}, ${book.author}, ${book.language}, ${book.format}, ${book.cover}, ${book.fileName}, ${book.words}, ${book.chapters}
    )
  `;
  try {
    await sql.query("insert into shelf_files (book_id, payload) values ($1, $2)", [id, payload]);
    const saved = await sql<{ n: number | string }>`select length(payload) as n from shelf_files where book_id = ${id}`;
    if (Number(saved[0]?.n) !== payload.length) throw new Error("Книга сохранилась не целиком");
  } catch (err) {
    await sql`delete from shelf_books where id = ${id}`;
    throw err;
  }
  const { grantAchievement } = await import("@/lib/social/achievements");
  void grantAchievement(userId, "book");
  return id;
}

async function handleBookParts(request: Request): Promise<Response> {
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
    if (op === "start") return await startBook(userId, body);
    if (op === "chunk") return await takeBookChunk(userId, body);
    if (op === "finish") return await finishBook(userId, body);
    if (op === "cancel") return await cancelBook(userId, body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось отправить книгу";
    return json(400, { message });
  }
  return json(400, { message: "Неизвестная операция" });
}

async function startBook(userId: string, body: Record<string, unknown>): Promise<Response> {
  const size = Number(body.size);
  if (!Number.isInteger(size) || size < 16 || size > MAX_BYTES) throw new Error("Книга больше 20 МБ");
  const name = clip(body.name, 180) || "book";
  const id = crypto.randomUUID();
  const sql = await getSql();
  await sql`
    insert into file_uploads (id, user_id, room_id, name, mime, size)
    values (${id}, ${userId}, ${"shelf"}, ${name}, ${"application/octet-stream"}, ${size})
  `;
  return json(200, { id });
}

async function takeBookChunk(userId: string, body: Record<string, unknown>): Promise<Response> {
  const id = typeof body.id === "string" ? body.id : "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Загрузка не найдена");
  const sql = await getSql();
  const rows = await sql<{ user_id: string; room_id: string; size: number; received: number; next_idx: number }>`
    select user_id, room_id, size, received, next_idx from file_uploads where id = ${id}
  `;
  const row = rows[0];
  if (!row || row.user_id !== userId || row.room_id !== "shelf") throw new Error("Загрузка не найдена");
  const index = Number(body.index);
  if (index !== Number(row.next_idx)) throw new Error("Кусок книги пришёл не по порядку");
  const data = typeof body.data === "string" ? body.data.replace(/\s/g, "") : "";
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error("Файл не удалось прочитать");
  const bytes = Buffer.from(data, "base64");
  if (bytes.length < 1 || bytes.length > CHUNK_MAX) throw new Error("Слишком большой кусок файла");
  const received = Number(row.received);
  const size = Number(row.size);
  if (received + bytes.length > size) throw new Error("Файл больше заявленного размера");
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
  return json(200, { received: received + bytes.length });
}

async function cancelBook(userId: string, body: Record<string, unknown>): Promise<Response> {
  const id = typeof body.id === "string" ? body.id : "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json(400, { message: "Загрузка не найдена" });
  const sql = await getSql();
  await sql`delete from file_chunks where id = ${id} and exists (select 1 from file_uploads where id = ${id} and user_id = ${userId} and room_id = 'shelf')`;
  await sql`delete from file_uploads where id = ${id} and user_id = ${userId} and room_id = 'shelf'`;
  return json(200, { ok: true });
}

async function finishBook(userId: string, body: Record<string, unknown>): Promise<Response> {
  const id = typeof body.id === "string" ? body.id : "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Загрузка не найдена");
  const format = clip(body.format, 8) as BookFormat;
  if (!FORMATS.has(format)) throw new Error("Этот формат здесь не читается");
  const sql = await getSql();
  const rows = await sql<{ user_id: string; room_id: string; name: string; size: number; received: number; next_idx: number }>`
    select user_id, room_id, name, size, received, next_idx from file_uploads where id = ${id}
  `;
  const row = rows[0];
  if (!row || row.user_id !== userId || row.room_id !== "shelf") throw new Error("Загрузка не найдена");
  if (Number(row.received) !== Number(row.size)) throw new Error("Книга загрузилась не целиком");
  const parts = await sql<{ idx: number; data: string }>`
    select idx, data from file_chunks where id = ${id} order by idx
  `;
  if (parts.length !== Number(row.next_idx)) throw new Error("Книга загрузилась не целиком");
  const raw = Buffer.alloc(Number(row.size));
  let offset = 0;
  for (const part of parts) {
    const piece = Buffer.from(part.data, "base64");
    if (offset + piece.length > raw.length) throw new Error("Книга загрузилась не целиком");
    piece.copy(raw, offset);
    offset += piece.length;
  }
  if (offset !== raw.length) throw new Error("Книга загрузилась не целиком");
  const bookId = await storeBook(userId, {
    title: clip(body.title, 180) || clip(row.name.replace(/\.[^.]+$/, ""), 180) || "Без названия",
    author: clip(body.author, 180),
    language: clip(body.language, 16),
    format,
    cover: takeCover(body.cover),
    fileName: clip(body.name, 180) || row.name || "book",
    words: countField(body.words, 5_000_000),
    chapters: countField(body.chapters, 2000),
    bytes: new Uint8Array(raw),
  });
  await sql`delete from file_chunks where id = ${id}`;
  await sql`delete from file_uploads where id = ${id}`;
  return json(200, { id: bookId, title: clip(body.title, 180) });
}
