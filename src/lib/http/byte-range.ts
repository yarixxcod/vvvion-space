export type ByteSpan = { start: number; end: number };

/** One byte range. Garbage or several ranges mean “send the whole file”. A range past the end is “bad”. */
export function byteRange(header: string | null, size: number): ByteSpan | "bad" | null {
  if (!header) return null;
  const text = header.trim();
  if (!text || !/^bytes=/i.test(text) || text.includes(",")) return null;
  if (size < 1) return "bad";
  const suffix = /^bytes=-(\d+)$/i.exec(text);
  if (suffix) {
    const tail = Number(suffix[1]);
    if (!Number.isFinite(tail) || tail < 1) return null;
    return { start: Math.max(0, size - tail), end: size - 1 };
  }
  const match = /^bytes=(\d+)-(\d*)$/i.exec(text);
  if (!match) return null;
  const start = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= size || end < start) return "bad";
  return { start, end };
}

export function bytesResponse(request: Request, bytes: Uint8Array, headers: Headers): Response {
  const total = bytes.length;
  headers.set("accept-ranges", "bytes");
  const asked = byteRange(request.headers.get("range"), total);
  if (asked === "bad") {
    headers.set("content-range", `bytes */${total}`);
    headers.delete("content-length");
    return new Response(null, { status: 416, headers });
  }
  if (!asked) {
    headers.set("content-length", String(total));
    if (request.method === "HEAD") return new Response(null, { status: 200, headers });
    return new Response(bytes as BodyInit, { status: 200, headers });
  }
  const slice = bytes.subarray(asked.start, asked.end + 1);
  headers.set("content-range", `bytes ${asked.start}-${asked.end}/${total}`);
  headers.set("content-length", String(slice.length));
  if (request.method === "HEAD") return new Response(null, { status: 206, headers });
  return new Response(slice as BodyInit, { status: 206, headers });
}
