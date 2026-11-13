import { auth } from "@/lib/auth/server";
import { getSql } from "@/lib/db";
import { bytesResponse } from "@/lib/http/byte-range";
import { assertActive } from "@/lib/social/access";

const IMAGE_MAX = 3_000_000;
const VIDEO_MAX = 12_000_000;
const FILE_MAX = 8_000_000;
const TOTAL_MAX = 20_000_000;
const MAX_FILES = 4;

const ALLOWED = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "application/pdf",
  "text/plain",
  "application/zip",
  "application/x-zip-compressed",
]);

const UUID = /^[0-9a-f-]{36}$/i;
const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

type Kind = "image" | "video" | "file";

type Stored = { data: string; mime: string; name: string; kind: string };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function kindOf(mime: string): Kind {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return "file";
}

function limitOf(kind: Kind): number {
  if (kind === "image") return IMAGE_MAX;
  if (kind === "video") return VIDEO_MAX;
  return FILE_MAX;
}

function cleanName(value: string): string {
  return value.replace(/[^\p{L}\p{N}._ ()\-]+/gu, "").trim().slice(0, 80) || "файл";
}

function magicOk(bytes: Buffer, mime: string): boolean {
  if (mime === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8;
  if (mime === "image/png") return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (mime === "image/gif") return bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46;
  if (mime === "image/webp") return bytes.length > 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  if (mime === "video/mp4") return bytes.length > 12 && bytes.toString("ascii", 4, 8) === "ftyp";
  if (mime === "video/webm") return bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  if (mime === "application/pdf") return bytes.toString("ascii", 0, 5) === "%PDF-";
  if (mime === "application/zip" || mime === "application/x-zip-compressed") return bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (mime === "text/plain") return !bytes.includes(0);
  return false;
}

function safeMime(mime: string): string {
  return ALLOWED.has(mime) ? mime : "application/octet-stream";
}

async function requireUser(request: Request): Promise<string | Response> {
  const headers = new Headers(request.headers);
  const token = new URL(request.url).searchParams.get("t");
  if (!headers.get("authorization") && token && /^[A-Za-z0-9]{16,200}$/.test(token)) {
    headers.set("authorization", `Bearer ${token}`);
  }
  const session = await auth.api.getSession({ headers });
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

function mediaResponse(request: Request, row: Stored): Response {
  const bytes = Buffer.from(row.data, "base64");
  const mime = safeMime(row.mime);
  const inline = row.kind === "image" || row.kind === "video" || row.kind === "audio";
  const ascii = row.name.replace(/[^\w.\- ()]+/g, "_").slice(0, 80) || "file";
  const headers = new Headers();
  headers.set("content-type", mime);
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-robots-tag", "noindex, nofollow, noarchive");
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", "private, max-age=300");
  headers.set(
    "content-disposition",
    `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(row.name)}`,
  );
  return bytesResponse(request, bytes, headers);
}

export async function handlePostPublish(request: Request): Promise<Response> {
  const userId = await requireUser(request);
  if (userId instanceof Response) return userId;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json(400, { message: "Запись не дошла" });
  }
  const body = typeof form.get("body") === "string" ? (form.get("body") as string) : "";
  const text = body.replace(/\u0000/g, "").replace(/\r\n/g, "\n").trim();
  if (text.length > 500) return json(400, { message: "Не больше 500 символов" });
  const parentRaw = typeof form.get("parentId") === "string" ? (form.get("parentId") as string).trim() : "";
  if (parentRaw && !UUID.test(parentRaw)) return json(400, { message: "Запись не найдена" });
  const incoming = form.getAll("file").filter((item): item is File => item instanceof File && item.size > 0);
  if (!text && incoming.length === 0) return json(400, { message: "Напишите текст или приложите файл" });
  if (incoming.length > MAX_FILES) return json(400, { message: "Можно приложить не больше четырёх файлов" });

  const prepared: { name: string; mime: string; kind: Kind; size: number; b64: string }[] = [];
  let total = 0;
  for (const file of incoming) {
    const mime = file.type === "image/jpg" ? "image/jpeg" : file.type;
    if (!ALLOWED.has(mime)) return json(400, { message: "Этот тип файла нельзя приложить" });
    const kind = kindOf(mime);
    if (file.size > limitOf(kind)) {
      const label = kind === "image" ? "3 МБ" : kind === "video" ? "12 МБ" : "8 МБ";
      return json(413, { message: `Файл больше ${label}` });
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.length < 1 || !magicOk(bytes, mime)) return json(400, { message: "Файл не похож на заявленный тип" });
    total += bytes.length;
    if (total > TOTAL_MAX) return json(413, { message: "Вложения вместе больше 20 МБ" });
    prepared.push({
      name: cleanName(file.name),
      mime,
      kind,
      size: bytes.length,
      b64: bytes.toString("base64"),
    });
  }

  const sql = await getSql();
  if (parentRaw) {
    const parent = await sql<{ id: string }>`select id from posts where id = ${parentRaw} and parent_id is null`;
    if (!parent.length) return json(400, { message: "Запись не найдена" });
  }
  const recent = await sql<{ n: number }>`
    select count(*) as n from posts
    where user_id = ${userId} and created_at > now() - interval '10 minutes'
  `;
  if (Number(recent[0]?.n ?? 0) >= 12) return json(429, { message: "Слишком много записей подряд. Подождите немного." });

  const id = crypto.randomUUID();
  await sql`
    insert into posts (id, user_id, body, parent_id)
    values (${id}, ${userId}, ${text}, ${parentRaw || null})
  `;
  const files: { id: string; name: string; mime: string; size: number; kind: Kind }[] = [];
  try {
    for (const file of prepared) {
      const fileId = crypto.randomUUID();
      await sql.query(
        `insert into post_files (id, post_id, user_id, name, mime, size, kind, data)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [fileId, id, userId, file.name, file.mime, file.size, file.kind, file.b64],
      );
      const saved = await sql<{ n: number }>`select length(data) as n from post_files where id = ${fileId}`;
      if (Number(saved[0]?.n) !== file.b64.length) throw new Error("short");
      files.push({ id: fileId, name: file.name, mime: file.mime, size: file.size, kind: file.kind });
    }
  } catch {
    await sql`delete from posts where id = ${id}`;
    return json(500, { message: "Вложение не сохранилось. Попробуйте ещё раз." });
  }
  return json(200, { id, files });
}

export async function handlePostFile(request: Request, id: string): Promise<Response> {
  if (!UUID.test(id)) return json(404, { message: "Файл не найден" });
  const userId = await requireUser(request);
  if (userId instanceof Response) return userId;
  const sql = await getSql();
  const rows = await sql<Stored>`
    select data, mime, name, kind from post_files where id = ${id} limit 1
  `;
  const row = rows[0];
  if (!row?.data) return json(404, { message: "Файл не найден" });
  return mediaResponse(request, row);
}

export async function handleSharedPostFile(request: Request, token: string, id: string): Promise<Response> {
  if (!TOKEN.test(token) || !UUID.test(id)) return json(404, { message: "Файл не найден" });
  const sql = await getSql();
  const rows = await sql<Stored>`
    select f.data, f.mime, f.name, f.kind
    from post_files f
    join post_shares s on s.post_id = f.post_id
    where s.token = ${token} and f.id = ${id}
    limit 1
  `;
  const row = rows[0];
  if (!row?.data) return json(404, { message: "Файл не найден" });
  return mediaResponse(request, row);
}
