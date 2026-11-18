import assert from "node:assert/strict";
import test from "node:test";
import { zipSync, strToU8 } from "fflate";
import { officeKind, readOffice } from "./office-preview.ts";

test("office kinds cover pdf, word, sheets and slides", () => {
  assert.equal(officeKind("2_file.pdf"), "pdf");
  assert.equal(officeKind("Отчёт.docx"), "docx");
  assert.equal(officeKind("book.xls"), "xls");
  assert.equal(officeKind("deck.pptx"), "pptx");
  assert.equal(officeKind("note.txt"), null);
});

test("docx and xlsx previews keep the readable text", () => {
  const docx = zipSync({
    "word/document.xml": strToU8("<w:document><w:p><w:t>Первый абзац</w:t></w:p><w:p><w:t>Второй</w:t></w:p></w:document>"),
  });
  const word = readOffice("a.docx", docx);
  assert.equal(word?.kind, "text");
  assert.match(word && word.kind === "text" ? word.text : "", /Первый абзац\nВторой/);

  const xlsx = zipSync({
    "xl/sharedStrings.xml": strToU8("<sst><si><t>Имя</t></si><si><t>Аня</t></si></sst>"),
    "xl/worksheets/sheet1.xml": strToU8('<sheet><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>2</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c></row></sheet>'),
  });
  const sheet = readOffice("a.xlsx", xlsx);
  assert.equal(sheet?.kind, "table");
  assert.deepEqual(sheet && sheet.kind === "table" ? sheet.rows[0] : [], ["Имя", "2"]);
  assert.deepEqual(sheet && sheet.kind === "table" ? sheet.rows[1] : [], ["Аня"]);
});

test("rtf preview drops the control words", () => {
  const bytes = new TextEncoder().encode("{\\rtf1\\ansi \\b Hello\\b0\\par Second line}");
  const view = readOffice("letter.rtf", bytes);
  assert.equal(view?.kind, "text");
  assert.match(view && view.kind === "text" ? view.text : "", /Hello/);
  assert.match(view && view.kind === "text" ? view.text : "", /Second line/);
  const word = readOffice("letter.rtf", new TextEncoder().encode("{\\rtf1 \\u1055?\\u1088?\\u1080?\\u1074?\\u1077?\\u1090?}"));
  assert.match(word && word.kind === "text" ? word.text : "", /Привет/);
});
