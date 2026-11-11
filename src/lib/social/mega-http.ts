import { auth } from "@/lib/auth/server";
import { playbackType } from "@/lib/music/tags";
import { assertActive } from "@/lib/social/access";
import { MEGA_CHUNK } from "@/lib/social/mega-plan";
import { beginMegaUpload, cancelMegaUpload, finishMegaUpload, peekMegaFile, peekMegaShare, publicMegaFileBody, publicMegaFileMeta, readMegaDownload, readMegaShare, stampMegaHead, uploadOffset, writeMegaChunk, writeMegaChunkStream } from "@/lib/social/mega";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
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

function fail(error: unknown): Response {
  const message = error instanceof Error ? error.message : "Не получилось";
  const status = /не действует|не хватает|Нужно|почту/i.test(message) ? 402 : /не найден|Не найдено|вышло/i.test(message) ? 404 : 400;
  return json(status, { message });
}

export async function handleMega(request: Request): Promise<Response> {
  const userId = await requireUser(request);
  if (userId instanceof Response) return userId;
  const type = request.headers.get("content-type") || "";
  try {
    if (type.includes("application/octet-stream")) {
      const id = request.headers.get("x-mega-id") || "";
      const offset = Number(request.headers.get("x-mega-offset") || "");
      if (!UUID.test(id) || !Number.isInteger(offset)) return json(400, { message: "Кусок файла не принят" });
      const declared = Number(request.headers.get("content-length") || "");
      const stream = request.body;
      if (request.headers.get("x-mega-stamp") === "1" || !stream || !Number.isInteger(declared) || declared < 1 || declared > MEGA_CHUNK) {
        const bytes = new Uint8Array(await request.arrayBuffer());
        if (bytes.length < 1 || bytes.length > MEGA_CHUNK) return json(413, { message: "Кусок файла не принят" });
        if (request.headers.get("x-mega-stamp") === "1") {
          await stampMegaHead(userId, id, bytes);
          return json(200, { ok: true });
        }
        await writeMegaChunk(userId, id, offset, bytes);
        return json(200, { ok: true });
      }
      await writeMegaChunkStream(userId, id, offset, stream, declared);
      return json(200, { ok: true });
    }
    const body = (await request.json().catch(() => null)) as { op?: string; id?: string; name?: string; parent?: string | null; mime?: string; size?: number } | null;
    if (!body || (body.op !== "start" && body.op !== "finish" && body.op !== "cancel" && body.op !== "status")) return json(400, { message: "Нечего отправить" });
    if (body.op === "start") {
      const id = await beginMegaUpload(userId, body.name || "файл", body.parent ?? null, body.mime || "", Number(body.size));
      return json(200, { id });
    }
    if (!body.id || !UUID.test(body.id)) return json(400, { message: "Файл не найден" });
    if (body.op === "status") {
      const received = await uploadOffset(userId, body.id);
      return json(200, { received });
    }
    if (body.op === "cancel") {
      await cancelMegaUpload(userId, body.id);
      return json(200, { ok: true });
    }
    await finishMegaUpload(userId, body.id);
    return json(200, { ok: true });
  } catch (error) {
    return fail(error);
  }
}

function byteRange(header: string | null, size: number): { start: number; end: number } | "bad" | null {
  if (!header) return null;
  const suffix = /^bytes=-(\d+)$/i.exec(header.trim());
  if (suffix) {
    const tail = Number(suffix[1]);
    if (!Number.isFinite(tail) || tail < 1 || size < 1) return "bad";
    return { start: Math.max(0, size - tail), end: size - 1 };
  }
  const match = /^bytes=(\d+)-(\d*)$/i.exec(header.trim());
  if (!match || size < 1) return "bad";
  const start = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : Math.min(start + 8 * 1024 * 1024 - 1, size - 1);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= size || end < start) return "bad";
  return { start, end };
}

export async function readMega(request: Request, id: string): Promise<Response> {
  const userId = await requireUser(request);
  if (userId instanceof Response) return userId;
  try {
    const url = new URL(request.url);
    const shared = url.searchParams.get("room") === "1";
    const file = shared ? await peekMegaShare(userId, id) : await peekMegaFile(userId, id);
    const mime = playbackType(file.name, file.mime || "");
    const media = mime.startsWith("image/") || mime.startsWith("video/") || mime.startsWith("audio/") || mime === "application/pdf";
    const inline = url.searchParams.get("dl") !== "1" && (url.searchParams.get("view") === "1" || media);
    const headers = new Headers({
      "content-type": mime,
      "cache-control": inline ? "private, max-age=86400" : "private, no-store",
      "x-content-type-options": "nosniff",
      "accept-ranges": "bytes",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    });
    if (file.size > 0) headers.set("content-length", String(file.size));
    const asked = byteRange(request.headers.get("range"), file.size);
    if (asked === "bad") return new Response(null, { status: 416, headers });
    if (request.method === "HEAD") {
      if (asked) {
        headers.set("content-range", `bytes ${asked.start}-${asked.end}/${file.size}`);
        headers.set("content-length", String(asked.end - asked.start + 1));
        return new Response(null, { status: 206, headers });
      }
      return new Response(null, { status: 200, headers });
    }
    const part = shared ? await readMegaShare(userId, id, asked) : await readMegaDownload(userId, id, asked);
    if (part.response.status === 416 || !part.response.body) return new Response(null, { status: 416, headers });
    if (asked) {
      headers.set("content-range", `bytes ${asked.start}-${asked.end}/${file.size}`);
      headers.set("content-length", String(asked.end - asked.start + 1));
      return new Response(part.response.body, { status: 206, headers });
    }
    return new Response(part.response.body, { status: 200, headers });
  } catch (error) {
    return fail(error);
  }
}

const PUBLIC_TOKEN = /^[A-Za-z0-9_-]{16,32}$/;

export async function readPublicMegaHttp(request: Request, token: string, id: string): Promise<Response> {
  if (!PUBLIC_TOKEN.test(token) || !UUID.test(id)) return json(404, { message: "Ссылка не действует" });
  try {
    const file = await publicMegaFileMeta(token, id);
    if (!file) return json(404, { message: "Ссылка не действует" });
    const mime = playbackType(file.name, file.mime || "");
    const media = mime.startsWith("image/") || mime.startsWith("video/") || mime.startsWith("audio/") || mime === "application/pdf" || mime.startsWith("text/");
    const url = new URL(request.url);
    const inline = url.searchParams.get("dl") !== "1" && (url.searchParams.get("view") === "1" || media);
    const headers = new Headers({
      "content-type": mime,
      "cache-control": "private, max-age=86400",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex, nofollow",
      "accept-ranges": "bytes",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    });
    if (file.size > 0) headers.set("content-length", String(file.size));
    const asked = byteRange(request.headers.get("range"), file.size);
    if (asked === "bad") return new Response(null, { status: 416, headers });
    if (request.method === "HEAD") {
      if (asked) {
        headers.set("content-range", `bytes ${asked.start}-${asked.end}/${file.size}`);
        headers.set("content-length", String(asked.end - asked.start + 1));
        return new Response(null, { status: 206, headers });
      }
      return new Response(null, { status: 200, headers });
    }
    const upstream = await publicMegaFileBody(token, id, asked);
    if (upstream.status === 416 || !upstream.body) return new Response(null, { status: 416, headers });
    if (asked) {
      headers.set("content-range", `bytes ${asked.start}-${asked.end}/${file.size}`);
      headers.set("content-length", String(asked.end - asked.start + 1));
      return new Response(upstream.body, { status: 206, headers });
    }
    return new Response(upstream.body, { status: 200, headers });
  } catch {
    return json(404, { message: "Ссылка не действует" });
  }
}
