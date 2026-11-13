const ALLOWED = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/ogg",
  "audio/webm",
  "audio/flac",
  "application/pdf",
  "text/plain",
  "application/zip",
]);

const DANGEROUS = new Set(["image/svg+xml", "text/html", "application/xhtml+xml", "text/javascript", "application/javascript", "image/svg"]);

export function claimedMime(raw: string): string {
  const mime = raw.split(";")[0]?.trim().toLowerCase() ?? "";
  return /^[\w.+-]+\/[\w.+-]+$/.test(mime) ? mime.slice(0, 120) : "";
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return Buffer.from(bytes.subarray(start, start + length)).toString("latin1");
}

function looksActive(bytes: Uint8Array): boolean {
  const text = Buffer.from(bytes.subarray(0, 256)).toString("utf8").trimStart().toLowerCase();
  return text.startsWith("<svg") || text.startsWith("<html") || text.startsWith("<!doctype") || text.startsWith("<script") || text.startsWith("<?xml");
}

export function sniffMime(bytes: Uint8Array): string | null {
  if (bytes.length < 4) return null;
  if (looksActive(bytes)) return "reject";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && ascii(bytes, 1, 3) === "PNG") return "image/png";
  if (ascii(bytes, 0, 4) === "GIF8") return "image/gif";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image/webp";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE") return "audio/wav";
  if (ascii(bytes, 0, 4) === "%PDF") return "application/pdf";
  if (ascii(bytes, 0, 4) === "OggS") return "audio/ogg";
  if (ascii(bytes, 0, 4) === "fLaC") return "audio/flac";
  if (ascii(bytes, 0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "video/webm";
  if (ascii(bytes, 0, 2) === "PK") return "application/zip";
  if (ascii(bytes, 4, 4) === "ftyp") {
    const brand = ascii(bytes, 8, 4);
    if (brand.startsWith("qt")) return "video/quicktime";
    if (brand === "M4A " || brand === "M4B ") return "audio/mp4";
    return "video/mp4";
  }
  return null;
}

export function acceptUpload(claimedRaw: string, head: Uint8Array): string | null {
  const claimed = claimedMime(claimedRaw);
  if (DANGEROUS.has(claimed) || claimed.endsWith("+xml")) return null;
  const sniffed = sniffMime(head);
  if (sniffed === "reject") return null;
  if (sniffed && ALLOWED.has(sniffed)) return sniffed;
  if (sniffed && !ALLOWED.has(sniffed)) return null;
  if (claimed === "text/plain") {
    if (head.some((byte) => byte === 0)) return null;
    if (looksActive(head)) return null;
    return "text/plain";
  }
  return null;
}

export function serveFile(mime: string): { type: string; inline: boolean } {
  const accepted = acceptUpload(mime, new Uint8Array());
  const type = claimedMime(mime);
  if (DANGEROUS.has(type) || type.endsWith("+xml") || type === "text/html") return { type: "application/octet-stream", inline: false };
  const inline = type.startsWith("image/") || type.startsWith("video/") || type.startsWith("audio/") || type === "application/pdf";
  if (accepted === null && !ALLOWED.has(type)) return { type: "application/octet-stream", inline: false };
  return { type: type || "application/octet-stream", inline: inline && ALLOWED.has(type) };
}
