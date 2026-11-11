export function decodeText(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes).replace(/^\uFEFF/, "");
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes).replace(/^\uFEFF/, "");
  }
  const utf = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const broken = utf.match(/\uFFFD/g)?.length ?? 0;
  if (broken === 0) return utf.replace(/^\uFEFF/, "");
  try {
    return new TextDecoder("windows-1251").decode(bytes).replace(/^\uFEFF/, "");
  } catch {
    return utf.replace(/^\uFEFF/, "");
  }
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "\u0026amp;")
    .replace(/</g, "\u0026lt;")
    .replace(/>/g, "\u0026gt;")
    .replace(/"/g, "\u0026quot;");
}

export function countWords(html: string): number {
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return 0;
  return text.split(" ").length;
}

const HEADING =
  /^\s*(?:глава|chapter|часть|пролог|эпилог|вступление|послесловие|предисловие)(?:\s+\S.{0,80})?\s*$/i;

export function splitPlainChapters(raw: string): { title: string; html: string }[] {
  const text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!text) return [];
  const lines = text.split("\n");
  const chunks: { title: string; lines: string[] }[] = [];
  let current = { title: "Текст", lines: [] as string[] };
  for (const line of lines) {
    if (HEADING.test(line.trim()) && (current.lines.some((item) => item.trim()) || chunks.length > 0)) {
      chunks.push(current);
      current = { title: line.trim().slice(0, 80), lines: [] };
      continue;
    }
    if (HEADING.test(line.trim()) && chunks.length === 0 && !current.lines.some((item) => item.trim())) {
      current.title = line.trim().slice(0, 80);
      continue;
    }
    current.lines.push(line);
  }
  chunks.push(current);
  const chapters = chunks
    .map((chunk) => ({
      title: chunk.title,
      html: chunk.lines
        .join("\n")
        .split(/\n{2,}/)
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => `<p>${escapeHtml(part).replace(/\n/g, "<br>")}</p>`)
        .join(""),
    }))
    .filter((chapter) => chapter.html);
  return chapters.length ? chapters : [{ title: "Текст", html: `<p>${escapeHtml(text)}</p>` }];
}

export function fileTitle(name: string): string {
  const base = name.replace(/\.[^.]+$/, "").replace(/\.fb2$/i, "");
  const clean = base.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  return clean.slice(0, 180) || "Без названия";
}

export function pdfTitle(bytes: Uint8Array): string {
  const latin = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 350_000)));
  const match = /\/Title\s*\(([^)]{1,180})\)/.exec(latin);
  if (!match) return "";
  const raw = match[1].replace(/\\([()\\])/g, "$1").replace(/\\[nrt]/g, " ").trim();
  if (!raw || raw.length < 2) return "";
  let odd = 0;
  for (const char of raw) {
    const code = char.charCodeAt(0);
    if (code < 32 || code === 127) odd += 1;
  }
  if (odd > 1) return "";
  return raw.slice(0, 180);
}
