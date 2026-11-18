import { strFromU8, unzipSync } from "fflate";

const MAX = 12 * 1024 * 1024;

export type OfficeKind = "pdf" | "docx" | "xlsx" | "pptx" | "odt" | "rtf" | "doc" | "xls" | "ppt";

export type OfficeView = { kind: "text"; text: string } | { kind: "table"; rows: string[][] };

export function officeKind(name: string): OfficeKind | null {
  const file = name.toLowerCase();
  if (file.endsWith(".pdf")) return "pdf";
  if (file.endsWith(".docx")) return "docx";
  if (file.endsWith(".xlsx")) return "xlsx";
  if (file.endsWith(".pptx")) return "pptx";
  if (file.endsWith(".odt") || file.endsWith(".ods") || file.endsWith(".odp")) return "odt";
  if (file.endsWith(".rtf")) return "rtf";
  if (file.endsWith(".doc")) return "doc";
  if (file.endsWith(".xls")) return "xls";
  if (file.endsWith(".ppt")) return "ppt";
  return null;
}

function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number(num)))
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, '"')
    .replace(/'/g, "'")
    .replace(/&/g, "&");
}

function safeXml(xml: string): string {
  return /<!DOCTYPE|<!ENTITY/i.test(xml) ? "" : xml;
}

function zipFiles(bytes: Uint8Array): Record<string, Uint8Array> | null {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return null;
  let total = 0;
  let count = 0;
  return unzipSync(bytes, {
    filter(entry) {
      total += entry.originalSize;
      count += 1;
      if (count > 400 || total > 30 * 1024 * 1024) throw new Error("big");
      return /^(word\/document\.xml|xl\/sharedStrings\.xml|xl\/worksheets\/sheet1\.xml|ppt\/slides\/slide\d+\.xml|content\.xml)$/.test(entry.name);
    },
  });
}

function docxText(xml: string): string {
  const safe = safeXml(xml);
  if (!safe) return "";
  return safe
    .split(/<w:p[\s>]/)
    .map((part) => [...part.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((item) => decodeXml(item[1] || "")).join(""))
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function sharedStrings(xml: string): string[] {
  const safe = safeXml(xml);
  if (!safe) return [];
  return safe.split(/<si[\s>]/).slice(1).map((item) =>
    [...item.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((bit) => decodeXml(bit[1] || "")).join(""),
  );
}

function columnIndex(cell: string): number {
  let index = 0;
  for (const char of cell) index = index * 26 + (char.charCodeAt(0) - 64);
  return Math.max(0, index - 1);
}

function sheetRows(xml: string, strings: string[]): string[][] {
  const safe = safeXml(xml);
  if (!safe) return [];
  const rows: string[][] = [];
  for (const row of safe.split(/<row[\s>]/).slice(1)) {
    const cells: string[] = [];
    let cursor = 0;
    for (const cell of row.matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const ref = /r="([A-Z]+)/.exec(cell[1] || "");
      const at = ref ? columnIndex(ref[1] || "A") : cursor;
      while (cells.length < at) cells.push("");
      const type = /t="([^"]+)"/.exec(cell[1] || "")?.[1] || "";
      const body = cell[2] || "";
      const value = /<v>([^<]*)<\/v>/.exec(body)?.[1] ?? "";
      const inline = [...body.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((item) => decodeXml(item[1] || "")).join("");
      cells[at] = type === "s" ? strings[Number(value)] || "" : inline || decodeXml(value);
      cursor = at + 1;
      if (cursor > 12) break;
    }
    if (cells.some((item) => item.trim())) rows.push(cells.map((item) => item.trim()));
    if (rows.length >= 40) break;
  }
  return rows;
}

function pptxText(files: Record<string, Uint8Array>): string {
  const names = Object.keys(files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(/\d+/.exec(a)?.[0] || 0) - Number(/\d+/.exec(b)?.[0] || 0));
  return names
    .map((name, index) => {
      const xml = safeXml(strFromU8(files[name] || new Uint8Array()));
      const bits = [...xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)].map((item) => decodeXml(item[1] || "")).filter(Boolean);
      return bits.length ? `Слайд ${index + 1}\n${bits.join(" ")}` : "";
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function odtText(xml: string): string {
  const safe = safeXml(xml);
  if (!safe) return "";
  return safe
    .split(/<text:p[\s>]/)
    .slice(1)
    .map((part) => decodeXml((part.split("</text:p>")[0] || "").replace(/<[^>]+>/g, "")))
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function rtfText(bytes: Uint8Array): string {
  const raw = new TextDecoder("latin1").decode(bytes.subarray(0, 1_500_000));
  if (!raw.startsWith("{\\rtf")) return "";
  return raw
    .replace(/\\par[d]?/g, "\n")
    .replace(/\\tab/g, "\t")
    .replace(/\\'([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\u(-?\d+)\??/g, (_, num) => {
      const code = Number(num);
      return String.fromCharCode(code < 0 ? code + 65536 : code);
    })
    .replace(/\\[a-z]+-?\d* ?/gi, "")
    .replace(/[{}]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 12_000);
}

function utf16Text(bytes: Uint8Array): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lines: string[] = [];
  let run = "";
  const flush = () => {
    if (run.length >= 4 && /[A-Za-zА-Яа-яЁё]/.test(run)) lines.push(run.trim());
    run = "";
  };
  for (let i = 0; i + 1 < bytes.length && lines.join("\n").length < 8000; i += 2) {
    const code = view.getUint16(i, true);
    if (code >= 32 && code < 0xfffe) run += String.fromCharCode(code);
    else flush();
    if (run.length > 240) flush();
  }
  flush();
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Readable preview for office files. PDF stays a real document, not extracted text. */
export function readOffice(name: string, bytes: Uint8Array): OfficeView | null {
  const kind = officeKind(name);
  if (!kind || kind === "pdf" || bytes.length > MAX) return null;
  try {
    if (kind === "rtf") {
      const text = rtfText(bytes);
      return text ? { kind: "text", text } : null;
    }
    if (kind === "doc" || kind === "xls" || kind === "ppt") {
      const text = utf16Text(bytes);
      return text ? { kind: "text", text } : null;
    }
    const files = zipFiles(bytes);
    if (!files) return null;
    if (kind === "docx") {
      const text = docxText(strFromU8(files["word/document.xml"] || new Uint8Array()));
      return text ? { kind: "text", text } : null;
    }
    if (kind === "xlsx") {
      const rows = sheetRows(strFromU8(files["xl/worksheets/sheet1.xml"] || new Uint8Array()), sharedStrings(strFromU8(files["xl/sharedStrings.xml"] || new Uint8Array())));
      return rows.length ? { kind: "table", rows } : null;
    }
    if (kind === "pptx") {
      const text = pptxText(files);
      return text ? { kind: "text", text } : null;
    }
    const text = odtText(strFromU8(files["content.xml"] || new Uint8Array()));
    return text ? { kind: "text", text } : null;
  } catch {
    return null;
  }
}
