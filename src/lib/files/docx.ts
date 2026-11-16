import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export function readDocx(bytes: Uint8Array) {
  let total = 0;
  let count = 0;
  const files = unzipSync(bytes, {
    filter(entry) {
      total += entry.originalSize;
      if (++count > 2000 || total > 40 * 1024 * 1024)
        throw new Error("DOCX слишком сложный или распаковывается больше 40 МБ");
      return true;
    },
  });
  if (!files["word/document.xml"]) throw new Error("Это не документ Word DOCX");
  if (/<!DOCTYPE|<!ENTITY/i.test(strFromU8(files["word/document.xml"])))
    throw new Error("DOCX содержит неподдерживаемые XML-объявления");
  const xml = new DOMParser().parseFromString(
    strFromU8(files["word/document.xml"]),
    "application/xml",
  );
  if (xml.querySelector("parsererror")) throw new Error("Документ повреждён");
  const paragraphs = Array.from(xml.getElementsByTagNameNS(W, "p")).filter(
    (p) => p.getElementsByTagNameNS(W, "t").length > 0,
  );
  if (paragraphs.length > 2000) throw new Error("В документе больше 2000 абзацев");
  const text = paragraphs.map((p) =>
    Array.from(p.getElementsByTagNameNS(W, "t"))
      .map((t) => t.textContent ?? "")
      .join(""),
  );
  return { files, xml, paragraphs, text };
}
export type WordDocument = ReturnType<typeof readDocx>;
/** Change only edited text ranges. Preserve ZIP parts, paragraph styles, images and unaffected runs. */
export function writeDocx(doc: WordDocument, next: string[]) {
  if (next.length < doc.paragraphs.length) throw new Error("Изменилась структура документа");
  const xml = doc.xml.cloneNode(true) as XMLDocument;
  const paragraphs = Array.from(xml.getElementsByTagNameNS(W, "p")).filter(
    (p) => p.getElementsByTagNameNS(W, "t").length > 0,
  );
  paragraphs.forEach((p, index) => {
    const before = doc.text[index],
      after = next[index];
    if (before === after) return;
    if (after.includes("\n") || after.includes("\r"))
      throw new Error(
        "Для нового абзаца используйте другой существующий абзац: переносы внутри строки пока не поддерживаются",
      );
    let prefix = 0;
    while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix])
      prefix++;
    let suffix = 0;
    while (
      suffix < before.length - prefix &&
      suffix < after.length - prefix &&
      before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
    )
      suffix++;
    const end = before.length - suffix;
    const insert = after.slice(prefix, after.length - suffix);
    let offset = 0;
    let inserted = false;
    for (const t of Array.from(p.getElementsByTagNameNS(W, "t"))) {
      const old = t.textContent ?? "";
      const start = offset;
      offset += old.length;
      if (offset < prefix || start > end) continue;
      const left = old.slice(0, Math.max(0, prefix - start));
      const right = old.slice(Math.max(0, end - start));
      t.textContent = left + (!inserted ? insert : "") + right;
      inserted = true;
      t.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve");
    }
  });
  const body = xml.getElementsByTagNameNS(W, "body")[0];
  if (!body) throw new Error("В документе нет тела");
  for (const text of next.slice(doc.paragraphs.length)) {
    const p = xml.createElementNS(W, "w:p"),
      r = xml.createElementNS(W, "w:r"),
      t = xml.createElementNS(W, "w:t");
    t.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve");
    t.textContent = text.replace(/[\r\n]+/g, " ");
    r.appendChild(t);
    p.appendChild(r);
    const section = Array.from(body.children).find(
      (node) => node.namespaceURI === W && node.localName === "sectPr",
    );
    body.insertBefore(p, section ?? null);
  }
  return zipSync(
    { ...doc.files, "word/document.xml": strToU8(new XMLSerializer().serializeToString(xml)) },
    { level: 6 },
  );
}
