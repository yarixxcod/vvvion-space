import { getSql } from "@/lib/db";
import { auth } from "@/lib/auth/server";
import { assertActive } from "@/lib/social/access";
import type { BookFormat } from "@/lib/books/types";

const MAX_BYTES = 25 * 1024 * 1024;
const FORMATS = new Set<BookFormat>(["epub", "fb2", "txt", "pdf"]);

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function clip(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
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
  if (file.size > MAX_BYTES) return json(413, { message: "Книга больше 25 МБ" });
  const format = clip(form.get("format"), 8) as BookFormat;
  if (!FORMATS.has(format)) return json(400, { message: "Этот формат здесь не читается" });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength < 16) return json(400, { message: "В файле почти ничего нет" });
  const title = clip(form.get("title"), 180) || clip(file.name.replace(/\.[^.]+$/, ""), 180) || "Без названия";
  const author = clip(form.get("author"), 180);
  const language = clip(form.get("language"), 16);
  const fileName = clip(file.name, 180) || "book";
  const coverRaw = typeof form.get("cover") === "string" ? (form.get("cover") as string) : "";
  const cover = coverRaw.startsWith("data:image/") && coverRaw.length <= 700_000 ? coverRaw : "";
  const words = Math.max(0, Math.min(5_000_000, Math.floor(Number(form.get("words")) || 0)));
  const chapters = Math.max(0, Math.min(2000, Math.floor(Number(form.get("chapters")) || 0)));
  const id = crypto.randomUUID();
  const sql = await getSql();
  await sql`
    insert into shelf_books (
      id, owner_id, title, author, language, format, cover, file_name, words, chapters
    ) values (
      ${id}, ${userId}, ${title}, ${author}, ${language}, ${format}, ${cover}, ${fileName}, ${words}, ${chapters}
    )
  `;
  const payload = Buffer.from(bytes).toString("base64");
  try {
    await sql.query("insert into shelf_files (book_id, payload) values ($1, $2)", [id, payload]);
    const saved = await sql<{ n: number | string }>`select length(payload) as n from shelf_files where book_id = ${id}`;
    if (Number(saved[0]?.n) !== payload.length) throw new Error("Книга сохранилась не целиком");
  } catch (err) {
    await sql`delete from shelf_books where id = ${id}`;
    if (err instanceof Error && err.message === "Книга сохранилась не целиком") {
      return json(500, { message: "Книга не сохранилась целиком. Попробуйте ещё раз." });
    }
    throw err;
  }
  const { grantAchievement } = await import("@/lib/social/achievements");
  void grantAchievement(userId, "book");
  return json(200, { id, title });
}

const SHARE_TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

export async function handleSharedBookFile(token: string): Promise<Response> {
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
  const type = row.format === "pdf" ? "application/pdf" : "application/octet-stream";
  return new Response(bytes, {
    headers: {
      "content-type": type,
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex, nofollow, noarchive",
      "content-disposition": "inline",
    },
  });
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
  const type = row.format === "pdf" ? "application/pdf" : "application/octet-stream";
  return new Response(bytes, {
    headers: {
      "content-type": type,
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex",
    },
  });
}
