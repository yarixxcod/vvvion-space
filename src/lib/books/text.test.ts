import assert from "node:assert/strict";
import test from "node:test";
import { decodeText, fileTitle, splitPlainChapters } from "./text.ts";

test("plain chapters split on headings and escape html", () => {
  const chapters = splitPlainChapters("Вступление\n\nЖил <кот>.\n\nГлава 1\n\nДальше.");
  assert.equal(chapters.length, 2);
  assert.equal(chapters[0]?.title, "Вступление");
  assert.equal((chapters[0]?.html || "").includes("<кот"), false);
  assert.match(chapters[0]?.html || "", /кот/);
  assert.equal(chapters[1]?.title, "Глава 1");
});

test("windows-1251 falls back when utf-8 is broken", () => {
  const bytes = new Uint8Array([0xff, 0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]);
  const text = decodeText(bytes);
  assert.match(text, /Привет/);
});

test("file title drops the extension", () => {
  assert.equal(fileTitle("Тихий_дон.fb2"), "Тихий дон");
});
