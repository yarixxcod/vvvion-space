import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { assertActive, loadAccess } from "@/lib/social/access";
import type { BookFormat, ShelfBook } from "@/lib/books/types";

const FORMATS = new Set<BookFormat>(["epub", "fb2", "txt", "pdf"]);

type ShelfRow = {
  id: string;
  owner_id: string;
  title: string;
  author: string;
  language: string;
  format: string;
  cover: string;
  file_name: string;
  words: number;
  chapters: number;
  added_at: string | Date;
  owner_name: string | null;
  owner_image: string | null;
  chapter: number | null;
  ratio: number | null;
};

function asBook(row: ShelfRow, userId: string, admin: boolean): ShelfBook {
  const format = FORMATS.has(row.format as BookFormat) ? (row.format as BookFormat) : "txt";
  const added = row.added_at instanceof Date ? row.added_at.getTime() : Date.parse(String(row.added_at));
  return {
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    author: row.author,
    language: row.language,
    format,
    cover: row.cover.startsWith("data:image/") ? row.cover : "",
    fileName: row.file_name,
    words: Number(row.words) || 0,
    chapters: Number(row.chapters) || 0,
    addedAt: Number.isFinite(added) ? added : Date.now(),
    openedAt: Date.now(),
    chapter: Number(row.chapter) || 0,
    ratio: Number(row.ratio) || 0,
    ownerName: row.owner_name?.trim() || "",
    ownerImage: row.owner_image,
    removable: admin || row.owner_id === userId,
  };
}

function likePattern(value: string): string | null {
  const clean = value.trim().slice(0, 80);
  if (!clean) return null;
  return `%${clean.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

export const listShelf = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = input && typeof input === "object" ? (input as { q?: unknown }).q : "";
    return { q: typeof raw === "string" ? raw.slice(0, 80) : "" };
  })
  .handler(async ({ context, data }): Promise<ShelfBook[]> => {
    await assertActive(context.userId);
    const access = await loadAccess(context.userId);
    const sql = await getSql();
    const pattern = likePattern(data.q);
    const rows = await sql<ShelfRow>`
      select
        b.id, b.owner_id, b.title, b.author, b.language, b.format, b.cover, b.file_name,
        b.words, b.chapters, b.added_at, u.name as owner_name, u.image as owner_image,
        p.chapter, p.ratio
      from shelf_books b
      join "user" u on u.id = b.owner_id
      left join shelf_progress p on p.book_id = b.id and p.user_id = ${context.userId}
      where ${pattern}::text is null or b.title ilike ${pattern} escape '\\'
      order by b.added_at desc
      limit 120
    `;
    return rows.map((row) => asBook(row, context.userId, access.role === "admin"));
  });

export const readBookCard = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const id = typeof input === "string" ? input.trim() : "";
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Книга не найдена");
    return id;
  })
  .handler(async ({ context, data }): Promise<{ title: string; author: string; cover: string }> => {
    await assertActive(context.userId);
    const sql = await getSql();
    const rows = await sql<{ title: string; author: string; cover: string }>`
      select title, author, cover from shelf_books where id = ${data} limit 1
    `;
    const row = rows[0];
    if (!row) throw new Error("Книга не найдена");
    const cover = row.cover.startsWith("data:image/") && row.cover.length < 180_000 ? row.cover : "";
    return { title: row.title, author: row.author, cover };
  });

function newToken(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

const SHARE_TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

export const shareShelfBook = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const id = input && typeof input === "object" ? (input as { id?: unknown }).id : "";
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Книга не найдена");
    return { id };
  })
  .handler(async ({ context, data }): Promise<{ token: string }> => {
    await assertActive(context.userId);
    const sql = await getSql();
    const rows = await sql<{ share_token: string | null }>`
      select share_token from shelf_books where id = ${data.id} limit 1
    `;
    const existing = rows[0]?.share_token;
    if (existing) return { token: existing };
    const token = newToken();
    const saved = await sql<{ share_token: string }>`
      update shelf_books
      set share_token = ${token}
      where id = ${data.id} and share_token is null
      returning share_token
    `;
    const next = saved[0]?.share_token;
    if (next) return { token: next };
    const again = await sql<{ share_token: string | null }>`
      select share_token from shelf_books where id = ${data.id} limit 1
    `;
    if (again[0]?.share_token) return { token: again[0].share_token };
    throw new Error("Не удалось создать ссылку");
  });

export type SharedBookMeta = {
  id: string;
  title: string;
  author: string;
  language: string;
  format: BookFormat;
  cover: string;
  fileName: string;
  words: number;
  chapters: number;
};

export const readSharedBook = createServerFn({ method: "GET" })
  .validator((token: unknown): string => (typeof token === "string" && SHARE_TOKEN.test(token) ? token : ""))
  .handler(async ({ data }): Promise<SharedBookMeta | null> => {
    if (!data) return null;
    const sql = await getSql();
    const rows = await sql<{
      id: string;
      title: string;
      author: string;
      language: string;
      format: string;
      cover: string;
      file_name: string;
      words: number;
      chapters: number;
    }>`
      select id, title, author, language, format, cover, file_name, words, chapters
      from shelf_books
      where share_token = ${data}
      limit 1
    `;
    const row = rows[0];
    if (!row) return null;
    const format = FORMATS.has(row.format as BookFormat) ? (row.format as BookFormat) : "txt";
    return {
      id: row.id,
      title: row.title,
      author: row.author,
      language: row.language,
      format,
      cover: row.cover.startsWith("data:image/") ? row.cover : "",
      fileName: row.file_name,
      words: Number(row.words) || 0,
      chapters: Number(row.chapters) || 0,
    };
  });

export const removeShelfBook = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const id = input && typeof input === "object" ? (input as { id?: unknown }).id : "";
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Книга не найдена");
    return { id };
  })
  .handler(async ({ context, data }): Promise<void> => {
    await assertActive(context.userId);
    const access = await loadAccess(context.userId);
    const sql = await getSql();
    const gone = await sql<{ id: string }>`
      delete from shelf_books
      where id = ${data.id} and (${access.role === "admin"} or owner_id = ${context.userId})
      returning id
    `;
    if (!gone.length) throw new Error("Эту книгу убрать нельзя");
  });

export const saveShelfProgress = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Не получилось запомнить страницу");
    const raw = input as { id?: unknown; chapter?: unknown; ratio?: unknown };
    if (typeof raw.id !== "string" || !/^[0-9a-f-]{36}$/i.test(raw.id)) throw new Error("Книга не найдена");
    const chapter = Number(raw.chapter);
    const ratio = Number(raw.ratio);
    if (!Number.isFinite(chapter) || chapter < 0 || chapter > 5000) throw new Error("Не получилось запомнить страницу");
    if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) throw new Error("Не получилось запомнить страницу");
    return { id: raw.id, chapter: Math.floor(chapter), ratio };
  })
  .handler(async ({ context, data }): Promise<void> => {
    await assertActive(context.userId);
    const sql = await getSql();
    const book = await sql<{ id: string }>`select id from shelf_books where id = ${data.id} limit 1`;
    if (!book.length) return;
    await sql`
      insert into shelf_progress (user_id, book_id, chapter, ratio, opened_at)
      values (${context.userId}, ${data.id}, ${data.chapter}, ${data.ratio}, now())
      on conflict (user_id, book_id) do update set
        chapter = excluded.chapter,
        ratio = excluded.ratio,
        opened_at = now()
    `;
  });
