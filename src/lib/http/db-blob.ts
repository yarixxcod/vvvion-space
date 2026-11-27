import type { Sql } from "@/lib/db";
import { byteRange, bytesResponse } from "./byte-range.ts";

/**
 * Files in this app live in Postgres as base64 text (`data` columns). Reading one
 * with `select data …` moves the WHOLE file out of Neon on every request — including
 * HEAD, conditional (304) and Range requests, which is how video seeking and PDF
 * viewers work. These helpers read only the bytes a response really needs, so the
 * database egress follows the response size rather than the file size.
 *
 * Only these tables are allowed, because the table name is spliced into the SQL text.
 */
export type B64Table = "post_files" | "room_files" | "disk_files";

const TABLES = new Set<string>(["post_files", "room_files", "disk_files"]);

/** Longest answer to an open-ended `Range: bytes=N-` on audio/video (browsers just ask again). */
export const OPEN_RANGE_CAP = 2 * 1024 * 1024;

/**
 * Decoded size of a canonical base64 string from its character count and its last
 * two characters (`select length(data) as chars, right(data, 2) as tail`).
 * `null` means the text is not canonical (line breaks etc.) — read it whole instead.
 */
export function decodedSize(chars: number | string, tail: string | null): number | null {
  const n = Number(chars);
  if (!Number.isInteger(n) || n < 0 || n % 4 !== 0) return null;
  if (n === 0) return 0;
  const end = tail ?? "";
  const pad = end.endsWith("==") ? 2 : end.endsWith("=") ? 1 : 0;
  return (n / 4) * 3 - pad;
}

/** The characters of the base64 text that cover bytes `start..end` (inclusive). */
export function base64Window(start: number, end: number): { from: number; length: number; skip: number } {
  const first = Math.floor(start / 3);
  const last = Math.floor(end / 3);
  return { from: first * 4, length: (last - first + 1) * 4, skip: start - first * 3 };
}

/** Read bytes `start..end` (inclusive) of a stored file; `null` when the row is gone. */
export async function readStoredBytes(
  sql: Sql,
  table: B64Table,
  id: string,
  start: number,
  end: number,
): Promise<Buffer | null> {
  if (!TABLES.has(table)) throw new Error("table not allowed");
  const win = base64Window(start, end);
  const rows = await sql.query<{ part: string | null }>(
    `select substring(data from $2::int for $3::int) as part from ${table} where id = $1`,
    [id, win.from + 1, win.length],
  );
  const part = rows[0]?.part;
  if (part == null) return null;
  const decoded = Buffer.from(part, "base64");
  return decoded.subarray(win.skip, win.skip + (end - start + 1));
}

/**
 * Same answers as `bytesResponse` (200 / 206 / 416 / HEAD), but the body is fetched
 * from the database only when it is needed, and only the requested slice.
 * `chars` / `tail` come from the metadata query, `data` itself is never selected there.
 */
export async function storedBytesResponse(opts: {
  request: Request;
  headers: Headers;
  sql: Sql;
  table: B64Table;
  id: string;
  chars: number | string;
  tail: string | null;
  /** audio/video: cap open-ended ranges so a seek does not pull the rest of the file. */
  media?: boolean;
}): Promise<Response> {
  const { request, headers, sql, table, id, media } = opts;
  const total = decodedSize(opts.chars, opts.tail);
  if (total == null) {
    // Not canonical base64: keep the old behaviour (read the whole value).
    if (!TABLES.has(table)) throw new Error("table not allowed");
    const rows = await sql.query<{ data: string }>(`select data from ${table} where id = $1`, [id]);
    const data = rows[0]?.data;
    if (!data) return new Response(null, { status: 404 });
    return bytesResponse(request, Buffer.from(data, "base64"), headers);
  }
  headers.set("accept-ranges", "bytes");
  const rangeHeader = request.headers.get("range");
  const asked = byteRange(rangeHeader, total);
  if (asked === "bad") {
    headers.set("content-range", `bytes */${total}`);
    headers.delete("content-length");
    return new Response(null, { status: 416, headers });
  }
  let start = 0;
  let end = total - 1;
  if (asked) {
    start = asked.start;
    end = asked.end;
    if (media && rangeHeader && /^\s*bytes=\d+-\s*$/i.test(rangeHeader) && end - start + 1 > OPEN_RANGE_CAP) {
      end = start + OPEN_RANGE_CAP - 1;
    }
  }
  const status = asked ? 206 : 200;
  if (asked) headers.set("content-range", `bytes ${start}-${end}/${total}`);
  headers.set("content-length", String(total === 0 ? 0 : end - start + 1));
  if (request.method === "HEAD") return new Response(null, { status, headers });
  if (total === 0) return new Response(new Uint8Array(0), { status, headers });
  const bytes = await readStoredBytes(sql, table, id, start, end);
  if (!bytes) return new Response(null, { status: 404 });
  return new Response(bytes as BodyInit, { status, headers });
}
