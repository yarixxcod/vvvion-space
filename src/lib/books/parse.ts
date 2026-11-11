import { unzipSync } from "fflate";
import type { ParsedBook } from "@/lib/books/types";
import { countWords, decodeText, escapeHtml, fileTitle, pdfTitle, splitPlainChapters } from "@/lib/books/text";

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_COVER = 500_000;

export function parseBookFile(file: File): Promise<ParsedBook> {
  if (file.size > MAX_BYTES) return Promise.reject(new Error("Книга больше 25 МБ"));
  if (file.size < 16) return Promise.reject(new Error("Файл пустой"));
  return file.arrayBuffer().then((buffer) => parseBookBytes(new Uint8Array(buffer), file.name));
}

export function parseBookBytes(bytes: Uint8Array, name: string): ParsedBook {
  const kind = sniff(bytes, name);
  if (kind === "pdf") return parsePdf(bytes, name);
  if (kind === "epub") return parseEpub(bytes, name);
  if (kind === "fb2") return parseFb2(bytes, name);
  if (kind === "zip") {
    const files = unzip(bytes);
    const hasEpub = Object.keys(files).some((key) => key.toLowerCase().endsWith("meta-inf/container.xml") || key.toLowerCase() === "mimetype");
    if (hasEpub) return parseEpubArchive(files, name);
    const fb2 = Object.keys(files).find((path) => path.toLowerCase().endsWith(".fb2"));
    if (fb2 && files[fb2]) return parseFb2(files[fb2], name);
    throw new Error("В архиве нет книги. Подойдут EPUB, FB2, TXT и PDF.");
  }
  return parseTxt(bytes, name);
}

function sniff(bytes: Uint8Array, name: string): "pdf" | "epub" | "fb2" | "zip" | "txt" {
  const lower = name.toLowerCase();
  if (starts(bytes, "%PDF") || lower.endsWith(".pdf")) return "pdf";
  if (starts(bytes, "PK")) {
    if (lower.endsWith(".epub")) return "epub";
    return "zip";
  }
  const head = decodeText(bytes.subarray(0, Math.min(bytes.length, 400))).toLowerCase();
  if (head.includes("<fictionbook") || lower.endsWith(".fb2")) return "fb2";
  return "txt";
}

function starts(bytes: Uint8Array, text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    if (bytes[i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

function unzip(bytes: Uint8Array): Record<string, Uint8Array> {
  try {
    const raw = unzipSync(bytes);
    const files: Record<string, Uint8Array> = {};
    for (const [path, data] of Object.entries(raw)) {
      if (path.endsWith("/")) continue;
      const key = normalizeZipPath(path);
      if (key) files[key] = data;
    }
    return files;
  } catch {
    throw new Error("Архив не открылся");
  }
}

function parseTxt(bytes: Uint8Array, name: string): ParsedBook {
  const chapters = splitPlainChapters(decodeText(bytes));
  if (!chapters.length) throw new Error("В файле не нашлось текста");
  return finish({
    title: fileTitle(name),
    author: "",
    language: "",
    format: "txt",
    cover: "",
    chapters,
    words: 0,
  });
}

function parsePdf(bytes: Uint8Array, name: string): ParsedBook {
  return finish({
    title: pdfTitle(bytes) || fileTitle(name),
    author: "",
    language: "",
    format: "pdf",
    cover: "",
    chapters: [],
    words: 0,
  });
}

function parseFb2(bytes: Uint8Array, name: string): ParsedBook {
  const xml = xmlString(bytes);
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("FB2 не разобрать");
  const title = textOf(first(doc, "book-title")) || fileTitle(name);
  const author = [...byLocal(doc, "author")]
    .slice(0, 3)
    .map((node) =>
      ["first-name", "middle-name", "last-name"]
        .map((part) => textOf(first(node, part)))
        .filter(Boolean)
        .join(" "),
    )
    .filter(Boolean)
    .join(", ");
  const language = textOf(first(doc, "lang"));
  const cover = fb2Cover(doc);
  const annotation = first(doc, "annotation");
  const chapters = [];
  if (annotation) {
    const html = renderBlocks(annotation);
    if (html.trim()) chapters.push({ title: "О книге", html });
  }
  const bodies = byLocal(doc, "body").filter((node) => node.getAttribute("name") !== "notes");
  for (const body of bodies) {
    const sections = [...body.children].filter((node) => localName(node) === "section");
    if (sections.length === 0) {
      const html = renderBlocks(body);
      if (html.trim()) chapters.push({ title: "Текст", html });
    } else {
      for (const section of sections) walkSection(section, chapters, "Часть");
    }
  }
  if (!chapters.length) throw new Error("В книге не нашлось текста");
  return finish({ title, author, language, format: "fb2", cover, chapters, words: 0 });
}

function walkSection(section: Element, chapters: { title: string; html: string }[], fallback: string) {
  const titleNode = [...section.children].find((node) => localName(node) === "title");
  const title = titleNode ? plain(titleNode) : fallback;
  const body = renderBlocks(section);
  const html = body.trim() ? `<h1>${escapeHtml(title || fallback)}</h1>${body}` : "";
  if (html.trim()) chapters.push({ title: title || fallback, html });
  const nested = [...section.children].filter((node) => localName(node) === "section");
  nested.forEach((child, index) => walkSection(child, chapters, `${title || fallback} · ${index + 1}`));
}

function fb2Cover(doc: Document): string {
  const page = first(doc, "coverpage");
  const image = page ? first(page, "image") : null;
  const href = image ? hrefOf(image).replace(/^#/, "") : "";
  if (!href) return "";
  const binary = byLocal(doc, "binary").find((node) => node.getAttribute("id") === href);
  if (!binary) return "";
  const type = binary.getAttribute("content-type") || "image/jpeg";
  if (!type.startsWith("image/")) return "";
  const data = (binary.textContent || "").replace(/\s/g, "");
  if (!data || data.length > MAX_COVER) return "";
  return `data:${type};base64,${data}`;
}

function renderBlocks(el: Element): string {
  let html = "";
  for (const child of el.children) {
    const name = localName(child);
    if (name === "title" || name === "section" || name === "binary" || name === "image") continue;
    if (name === "p" || name === "subtitle" || name === "text-author" || name === "v") {
      const inner = inline(child);
      if (inner.trim()) html += `<p>${inner}</p>`;
    } else if (name === "empty-line") {
      html += "<br>";
    } else {
      html += renderBlocks(child);
    }
  }
  return html;
}

function inline(el: Element): string {
  let out = "";
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) out += escapeHtml(node.textContent || "");
    else if (node.nodeType === Node.ELEMENT_NODE) {
      const child = node as Element;
      const name = localName(child);
      const inner = inline(child);
      if (name === "emphasis" || name === "strong" || name === "style") out += `<em>${inner}</em>`;
      else if (name === "a") {
        const href = hrefOf(child);
        out += /^https?:/i.test(href) ? `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${inner}</a>` : inner;
      } else out += inner;
    }
  }
  return out;
}

function parseEpub(bytes: Uint8Array, name: string): ParsedBook {
  const files = unzip(bytes);
  if (!Object.keys(files).some((key) => key.toLowerCase().endsWith("meta-inf/container.xml"))) {
    const fb2 = Object.keys(files).find((key) => key.toLowerCase().endsWith(".fb2"));
    if (fb2 && files[fb2]) return parseFb2(files[fb2], name);
    throw new Error("Это не EPUB");
  }
  return parseEpubArchive(files, name);
}

function parseEpubArchive(files: Record<string, Uint8Array>, name: string): ParsedBook {
  const located = locateContainer(files);
  if (!located) throw new Error("Это не EPUB");
  const opfRel = /full-path\s*=\s*["']([^"']+)["']/i.exec(xmlString(files[located.key] || new Uint8Array()))?.[1];
  if (!opfRel) throw new Error("В EPUB нет оглавления");
  const opfKey = findKey(files, joinZip(located.prefix, opfRel), normalizeZipPath(opfRel), opfRel);
  if (!opfKey || !files[opfKey]) throw new Error("В EPUB нет оглавления");
  const doc = parseXmlLoose(xmlString(files[opfKey]));
  if (!doc) throw new Error("EPUB не разобрать");
  const title = textOf(meta(doc, "title")) || fileTitle(name);
  const author = byLocal(doc, "creator")
    .map((node) => plain(node))
    .filter(Boolean)
    .slice(0, 3)
    .join(", ");
  const language = textOf(meta(doc, "language"));
  const base = opfKey.includes("/") ? opfKey.slice(0, opfKey.lastIndexOf("/") + 1) : "";
  const manifest = takeManifest(doc);
  const coverHref = epubCoverHref(doc, manifest);
  const coverKey = coverHref ? findKey(files, resolvePath(base, coverHref), coverHref) : undefined;
  const cover = coverKey && files[coverKey] ? dataUrl(files[coverKey], guessType(coverKey)) : "";
  const linear = spineItems(doc, manifest, false);
  const withHidden = linear.length ? linear : spineItems(doc, manifest, true);
  let chapters = loadChapters(files, withHidden, base, name);
  if (!richText(chapters)) chapters = prefer(chapters, loadChapters(files, ncxItems(files, doc, manifest, base), base, name));
  if (!richText(chapters)) chapters = prefer(chapters, loadChapters(files, navItems(files, manifest, base), base, name));
  if (!richText(chapters)) chapters = prefer(chapters, loadChapters(files, scanItems(files), "", name));
  const visible = chapters.filter((chapter) => textLen(chapter.html) > 0 || chapter.html.includes("<img"));
  if (!visible.length) {
    if (shopLocked(files)) throw new Error("Книга с защитой магазина: текст закрыт, здесь её не открыть.");
    throw new Error("В книге не нашлось текста");
  }
  return finish({ title, author, language, format: "epub", cover, chapters: visible.slice(0, 500), words: 0 });
}

type SpineItem = { href: string; type: string; title?: string };

function takeManifest(doc: Document): Map<string, SpineItem> {
  const map = new Map<string, SpineItem>();
  for (const item of byLocal(doc, "item")) {
    const id = (item.getAttribute("id") || item.getAttribute("xml:id") || "").trim();
    const href = safeDecode((item.getAttribute("href") || hrefOf(item) || "").split("#")[0] || "");
    if (!id || !href.trim()) continue;
    map.set(id, { href: href.trim(), type: (item.getAttribute("media-type") || "").trim() });
  }
  return map;
}

function manifestGet(map: Map<string, SpineItem>, id: string): SpineItem | undefined {
  const key = id.trim();
  if (!key) return undefined;
  const direct = map.get(key);
  if (direct) return direct;
  const lower = key.toLowerCase();
  for (const [name, item] of map) {
    if (name.toLowerCase() === lower) return item;
  }
  return undefined;
}

function spineItems(doc: Document, manifest: Map<string, SpineItem>, keepNonLinear: boolean): SpineItem[] {
  return byLocal(doc, "itemref")
    .filter((node) => keepNonLinear || (node.getAttribute("linear") || "").toLowerCase() !== "no")
    .map((node) => manifestGet(manifest, node.getAttribute("idref") || ""))
    .filter((item): item is SpineItem => Boolean(item))
    .filter(isContentItem);
}

function isContentItem(item: SpineItem): boolean {
  const href = item.href.toLowerCase().split("?")[0] || "";
  const type = item.type.toLowerCase();
  if (!href || href.endsWith(".ncx") || type.includes("dtbncx")) return false;
  if (type.includes("css") || href.endsWith(".css")) return false;
  if (type.includes("font") || /\.(otf|ttf|woff2?)$/.test(href)) return false;
  if (type.startsWith("image/") && !href.endsWith(".svg")) return false;
  if (type.includes("octet-stream")) return /\.(xhtml|html|htm|xml|svg|txt|fb2)$/.test(href);
  if (/html|xml|svg|text\/plain|fictionbook/.test(type)) return true;
  return /\.(xhtml|html|htm|xml|svg|txt|fb2)$/.test(href);
}

function ncxItems(files: Record<string, Uint8Array>, doc: Document, manifest: Map<string, SpineItem>, base: string): SpineItem[] {
  const spine = byLocal(doc, "spine")[0];
  const fromId = manifestGet(manifest, spine?.getAttribute("toc") || "");
  const hinted = fromId?.href || [...manifest.values()].find((item) => item.href.toLowerCase().endsWith(".ncx"))?.href || "";
  const key = findKey(files, hinted ? resolvePath(base, hinted) : "", hinted, ...Object.keys(files).filter((item) => item.toLowerCase().endsWith(".ncx")));
  if (!key || !files[key]) return [];
  const ncx = parseXmlLoose(xmlString(files[key]));
  if (!ncx) return [];
  const ncxBase = key.includes("/") ? key.slice(0, key.lastIndexOf("/") + 1) : base;
  const items: SpineItem[] = [];
  for (const point of byLocal(ncx, "navPoint")) {
    const label = textOf(first(point, "text"));
    const src = (first(point, "content")?.getAttribute("src") || "").split("#")[0] || "";
    if (!src) continue;
    items.push({ href: resolvePath(ncxBase, safeDecode(src)), type: "application/xhtml+xml", title: label });
  }
  return items;
}

function navItems(files: Record<string, Uint8Array>, manifest: Map<string, SpineItem>, base: string): SpineItem[] {
  const nav = [...manifest.values()].find((item) => /(^|\/)nav[^/]*\.(?:xhtml|html|htm)$/i.test(item.href));
  const hinted = nav?.href || "";
  const key = findKey(
    files,
    hinted ? resolvePath(base, hinted) : "",
    hinted,
    ...Object.keys(files).filter((item) => /(^|\/)nav[^/]*\.(?:xhtml|html|htm)$/i.test(item)),
  );
  if (!key || !files[key]) return [];
  const page = new DOMParser().parseFromString(xmlString(files[key]), "text/html");
  const navBase = key.includes("/") ? key.slice(0, key.lastIndexOf("/") + 1) : base;
  const items: SpineItem[] = [];
  for (const link of page.querySelectorAll("a[href]")) {
    const href = (link.getAttribute("href") || "").split("#")[0] || "";
    if (!href || /^(?:https?:|mailto:)/i.test(href)) continue;
    const title = (link.textContent || "").replace(/\s+/g, " ").trim();
    items.push({ href: resolvePath(navBase, safeDecode(href)), type: "application/xhtml+xml", title });
  }
  return items;
}

function scanItems(files: Record<string, Uint8Array>): SpineItem[] {
  return Object.keys(files)
    .filter((key) => /\.(xhtml|html|htm)$/i.test(key))
    .filter((key) => !/(^|\/)(toc|nav|navigation|cover|wrap\d*|title[-_]?page)\b/i.test(key))
    .sort((a, b) => a.localeCompare(b, "ru"))
    .map((key) => ({ href: key, type: "application/xhtml+xml" }));
}

function loadChapters(files: Record<string, Uint8Array>, items: SpineItem[], base: string, bookName: string) {
  const chapters: { title: string; html: string }[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const key = findKey(files, resolvePath(base, item.href), item.href, joinZip(base, item.href));
    if (!key || !files[key] || seen.has(key)) continue;
    seen.add(key);
    const raw = files[key];
    const head = xmlString(raw.subarray(0, 240)).toLowerCase();
    if (item.type.toLowerCase().includes("fictionbook") || head.includes("<fictionbook")) {
      try {
        chapters.push(...parseFb2(raw, bookName).chapters);
        continue;
      } catch {
        /* html below */
      }
    }
    let html = "";
    try {
      html = chapterHtml(xmlString(raw), key, files);
    } catch {
      html = plainParagraphs(xmlString(raw));
    }
    if (textLen(html) < 1 && !html.includes("<img")) continue;
    const heading = chapterTitle(html, chapters.length);
    const fallback = `Глава ${chapters.length + 1}`;
    chapters.push({ title: heading === fallback ? item.title || fallback : heading, html });
  }
  return chapters;
}

function richText(chapters: { html: string }[]): boolean {
  return chapters.some((chapter) => textLen(chapter.html) >= 40);
}

function scoreText(chapters: { html: string }[]): number {
  return chapters.reduce((sum, chapter) => sum + textLen(chapter.html), 0);
}

function prefer(current: { title: string; html: string }[], alt: { title: string; html: string }[]) {
  if (!richText(current) && scoreText(alt) > scoreText(current)) return alt;
  return current;
}

function shopLocked(files: Record<string, Uint8Array>): boolean {
  const key = findKey(files, "META-INF/encryption.xml");
  if (!key || !files[key]) return false;
  const text = xmlString(files[key]);
  if (!/encrypteddata/i.test(text)) return false;
  const uris = [...text.matchAll(/URI="([^"]+)"/gi)].map((match) => match[1] || "");
  if (!uris.length) return true;
  return uris.some((uri) => !/\.(otf|ttf|woff2?|eot)$/i.test(uri.split("?")[0] || ""));
}

function locateContainer(files: Record<string, Uint8Array>): { key: string; prefix: string } | null {
  const keys = Object.keys(files);
  const hit = keys.find((key) => key.toLowerCase() === "meta-inf/container.xml") ?? keys.find((key) => key.toLowerCase().endsWith("/meta-inf/container.xml"));
  if (!hit) return null;
  const at = hit.toLowerCase().lastIndexOf("meta-inf/container.xml");
  return { key: hit, prefix: hit.slice(0, at) };
}

function findKey(files: Record<string, Uint8Array>, ...cands: string[]): string | undefined {
  const keys = Object.keys(files);
  const wanted = cands.map(normalizeZipPath).filter(Boolean);
  for (const cand of wanted) {
    if (files[cand]) return cand;
    const lower = cand.toLowerCase();
    const exact = keys.find((key) => key.toLowerCase() === lower);
    if (exact) return exact;
  }
  const tails = [...wanted].sort((a, b) => a.length - b.length);
  for (const tail of tails) {
    const lower = tail.toLowerCase();
    const hits = keys.filter((key) => {
      const item = key.toLowerCase();
      return item === lower || item.endsWith(`/${lower}`);
    });
    if (hits.length === 1) return hits[0];
  }
  return undefined;
}

function joinZip(base: string, rel: string): string {
  return normalizeZipPath(`${base}${rel}`);
}

function safeDecode(value: string): string {
  const clean = value.trim();
  try {
    return decodeURIComponent(clean);
  } catch {
    return clean;
  }
}

function normalizeZipPath(path: string): string {
  let value = path.trim();
  if (!value) return "";
  try {
    value = decodeURIComponent(value);
  } catch {
    /* keep the raw name */
  }
  value = value.replace(/\\/g, "/").replace(/^\/+/, "").normalize("NFC");
  const parts: string[] = [];
  for (const part of value.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function epubCoverHref(doc: Document, manifest: Map<string, SpineItem>): string {
  const metaCover = byLocal(doc, "meta").find((node) => (node.getAttribute("name") || "").toLowerCase() === "cover");
  const fromMeta = metaCover ? manifestGet(manifest, metaCover.getAttribute("content") || "") : undefined;
  if (fromMeta) return fromMeta.href;
  for (const item of byLocal(doc, "item")) {
    if ((item.getAttribute("properties") || "").includes("cover-image")) {
      return safeDecode(item.getAttribute("href") || "");
    }
  }
  return "";
}

const KEEP_TAG = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "ul",
  "ol",
  "li",
  "em",
  "strong",
  "i",
  "b",
  "code",
  "pre",
  "sup",
  "sub",
  "table",
  "thead",
  "tbody",
  "tr",
  "td",
  "th",
  "figcaption",
]);

function chapterHtml(source: string, chapterPath: string, files: Record<string, Uint8Array>): string {
  const xml = xhtmlDoc(source);
  const htmlDoc = new DOMParser().parseFromString(source, "text/html");
  const xmlHtml = xml ? emitNodes(bodyNodes(xml), chapterPath, files) : "";
  const htmlHtml = emitNodes(htmlDoc.body?.childNodes ?? [], chapterPath, files);
  let html = textLen(xmlHtml) >= textLen(htmlHtml) ? xmlHtml : htmlHtml;
  if (textLen(html) < 40 && !html.includes("<img")) {
    const plain = plainParagraphs(source);
    if (textLen(plain) > textLen(html)) html = plain;
  }
  return html;
}

function xhtmlDoc(source: string): Document | null {
  const start = source.trimStart();
  if (!start.startsWith("<")) return null;
  try {
    const doc = new DOMParser().parseFromString(source, "application/xhtml+xml");
    if (doc.querySelector("parsererror")) return null;
    return doc;
  } catch {
    return null;
  }
}

function bodyNodes(doc: Document): NodeListOf<ChildNode> | ChildNode[] {
  const body = byLocal(doc, "body")[0];
  if (body) return body.childNodes;
  return doc.documentElement?.childNodes ?? [];
}

function emitNodes(nodes: NodeListOf<ChildNode> | ChildNode[], chapterPath: string, files: Record<string, Uint8Array>): string {
  let html = "";
  for (const node of [...nodes]) html += emitNode(node, chapterPath, files);
  return html;
}

function emitNode(node: Node, chapterPath: string, files: Record<string, Uint8Array>): string {
  if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) {
    return escapeHtml(node.textContent || "");
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as Element;
  const name = el.localName.toLowerCase();
  if (name === "script" || name === "style" || name === "iframe" || name === "link" || name === "meta" || name === "noscript") return "";
  if (name === "br" || name === "hr") return `<${name}>`;
  if (name === "img" || name === "image") return imageTag(el, chapterPath, files);
  if (name === "a") {
    const inner = emitNodes(el.childNodes, chapterPath, files);
    const href = hrefOf(el);
    if (inner.trim() && /^https?:/i.test(href)) {
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${inner}</a>`;
    }
    return inner;
  }
  const inner = emitNodes(el.childNodes, chapterPath, files);
  if (!inner.trim()) return "";
  if (KEEP_TAG.has(name)) return `<${name}>${inner}</${name}>`;
  if (name === "div" || name === "section" || name === "article" || name === "figure") {
    if (!/<(?:p|h1|h2|h3|ul|ol|blockquote|table|pre)\b/i.test(inner)) return `<p>${inner}</p>`;
    return inner;
  }
  return inner;
}

function imageTag(el: Element, chapterPath: string, files: Record<string, Uint8Array>): string {
  const src = el.getAttribute("src") || hrefOf(el);
  if (!src || /^\s*javascript:/i.test(src)) return "";
  if (/^data:image\/(?:png|jpeg|jpg|gif|webp);base64,[a-z0-9+/=]+$/i.test(src) && src.length <= MAX_COVER) {
    return `<img src="${src}" alt="">`;
  }
  const key = findKey(files, resolvePath(chapterPath, src), src);
  const bytes = key ? files[key] : undefined;
  const url = bytes ? dataUrl(bytes, guessType(key || src)) : "";
  return url ? `<img src="${url}" alt="">` : "";
}

function plainParagraphs(source: string): string {
  const cut = source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
  const text = decodeEntities(cut.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(?:p|div|h[1-6]|li|tr|blockquote|section)>/gi, "\n\n").replace(/<[^>]+>/g, " "));
  const parts = text
    .split(/\n{2,}/)
    .map((part) => part.replace(/[ \t]{2,}/g, " ").trim())
    .filter((part) => part.length > 1);
  return parts.map((part) => `<p>${escapeHtml(part).replace(/\n/g, "<br>")}</p>`).join("");
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeChar(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => safeChar(Number.parseInt(dec, 10)))
    .replace(/&nbsp;/gi, " ")
    .replace(/"/gi, '"')
    .replace(/'/gi, "'")
    .replace(/</gi, "<")
    .replace(/>/gi, ">")
    .replace(/&/gi, "&");
}

function safeChar(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
  if (code < 32 && code !== 9 && code !== 10) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

function parseXmlLoose(source: string): Document | null {
  const prepared = source
    .replace(/&nbsp;/gi, "&#160;")
    .replace(/&mdash;/gi, "&#8212;")
    .replace(/&ndash;/gi, "&#8211;")
    .replace(/&laquo;/gi, "&#171;")
    .replace(/&raquo;/gi, "&#187;")
    .replace(/&hellip;/gi, "&#8230;")
    .replace(/&copy;/gi, "&#169;")
    .replace(/\u0026quot;/gi, "&#34;");
  try {
    const doc = new DOMParser().parseFromString(prepared, "application/xml");
    if (doc.querySelector("parsererror")) return null;
    return doc;
  } catch {
    return null;
  }
}

function textLen(html: string): number {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length;
}

function chapterTitle(html: string, index: number): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const heading = doc.querySelector("h1, h2, h3");
  const text = heading?.textContent?.replace(/\s+/g, " ").trim() || "";
  return text.slice(0, 80) || `Глава ${index + 1}`;
}

function finish(book: ParsedBook): ParsedBook {
  const words = book.chapters.reduce((sum, chapter) => sum + countWords(chapter.html), 0);
  return { ...book, title: book.title.slice(0, 180), author: book.author.slice(0, 180), words };
}

function dataUrl(bytes: Uint8Array, type: string): string {
  if (!bytes.length || bytes.length > MAX_COVER || !type.startsWith("image/")) return "";
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${type};base64,${btoa(binary)}`;
}

function guessType(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return "image/jpeg";
}

export function resolvePath(base: string, rel: string): string {
  if (!rel || /^(?:data|https?|blob):/i.test(rel)) return rel;
  const clean = safeDecode((rel.split("#")[0]?.split("?")[0] || rel).trim());
  if (!clean) return "";
  if (clean.startsWith("/")) return normalizeZipPath(clean);
  const root = base.endsWith("/") ? base : base.includes("/") ? base.slice(0, base.lastIndexOf("/") + 1) : "";
  return normalizeZipPath(`${root}${clean}`);
}

function xmlString(bytes: Uint8Array): string {
  if (bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) {
    return decodeText(bytes);
  }
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 240)).toLowerCase();
  if (/encoding\s*=\s*["'][^"']*1251|charset\s*=\s*[^"'>\s]*1251/.test(head)) {
    try {
      return new TextDecoder("windows-1251").decode(bytes);
    } catch {
      /* utf-8 below */
    }
  }
  if (/encoding\s*=\s*["'][^"']*koi8-r/.test(head)) {
    try {
      return new TextDecoder("koi8-r").decode(bytes);
    } catch {
      /* utf-8 below */
    }
  }
  return decodeText(bytes);
}

function localName(el: Element): string {
  return el.localName.toLowerCase();
}

function byLocal(root: ParentNode, name: string): Element[] {
  return [...root.querySelectorAll("*")].filter((el) => el.localName.toLowerCase() === name);
}

function first(root: ParentNode, name: string): Element | null {
  return byLocal(root, name)[0] ?? null;
}

function meta(doc: Document, name: string): Element | null {
  return byLocal(doc, name).find((node) => !node.closest("manifest")) ?? first(doc, name);
}

function textOf(el: Element | null): string {
  return plain(el);
}

function plain(el: Element | null): string {
  return (el?.textContent || "").replace(/\s+/g, " ").trim();
}

function hrefOf(el: Element): string {
  return (
    el.getAttribute("href") ||
    el.getAttribute("l:href") ||
    el.getAttribute("xlink:href") ||
    el.getAttributeNS("http://www.w3.org/1999/xlink", "href") ||
    ""
  );
}
