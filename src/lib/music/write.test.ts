import assert from "node:assert/strict";
import test from "node:test";
import { readTags } from "./tags.ts";
import { planTagWrite } from "./write.ts";

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function padded(span: number, title: string): Uint8Array {
  const body = new TextEncoder().encode(title);
  const payload = 1 + body.length;
  const frame = new Uint8Array(10 + payload);
  frame.set([84, 73, 84, 50], 0);
  frame[7] = payload;
  frame[10] = 3;
  frame.set(body, 11);
  const tag = new Uint8Array(span);
  tag.set([0x49, 0x44, 0x33, 3, 0, 0], 0);
  const size = span - 10;
  tag[6] = (size >>> 21) & 0x7f;
  tag[7] = (size >>> 14) & 0x7f;
  tag[8] = (size >>> 7) & 0x7f;
  tag[9] = size & 0x7f;
  tag.set(frame, 10);
  return tag;
}

const MP3 = Uint8Array.from([0xff, 0xfb, 0xe0, 0x00, 0xff, 0xfb, 0xe0, 0x00]);

test("title fits into the old tag without growing the file", () => {
  const file = concat(padded(400, "Ночь"), MP3);
  const plan = planTagWrite(file, { title: "День", artist: "Мара", album: "", genre: "Jazz", cover: null });
  assert.equal(plan.mode, "keep");
  if (plan.mode !== "keep") return;
  assert.equal(plan.header.length, 400);
  const next = new Uint8Array(file);
  next.set(plan.header, 0);
  assert.equal(next.length, file.length);
  const tags = readTags(next);
  assert.equal(tags.title, "День");
  assert.equal(tags.artist, "Мара");
  assert.equal(tags.genre, "Jazz");
});

test("mp3 without tags grows by a new header", () => {
  const plan = planTagWrite(MP3, { title: "Ночь", artist: "Мара feat Ли", album: "Дом", genre: "Pop", cover: null });
  assert.equal(plan.mode, "rewrite");
  if (plan.mode !== "rewrite") return;
  assert.ok(plan.file.length > MP3.length);
  const tags = readTags(plan.file);
  assert.equal(tags.title, "Ночь");
  assert.equal(tags.artist, "Мара feat Ли");
  assert.equal(tags.album, "Дом");
  assert.equal(tags.genre, "Pop");
});

test("flac is not wrapped in id3", () => {
  const flac = Uint8Array.from([0x66, 0x4c, 0x61, 0x43, 0, 0, 0, 0]);
  const plan = planTagWrite(flac, { title: "A", artist: "B", album: "", genre: "C", cover: null });
  assert.equal(plan.mode, "no");
});

test("cover roundtrip", () => {
  const jpeg = new Uint8Array(64);
  jpeg.set([0xff, 0xd8, 0xff, 0xd9], 0);
  const plan = planTagWrite(MP3, {
    title: "Ночь",
    artist: "Мара",
    album: "",
    genre: "",
    cover: { mime: "image/jpeg", bytes: jpeg },
  });
  assert.equal(plan.mode, "rewrite");
  if (plan.mode !== "rewrite") return;
  const tags = readTags(plan.file);
  assert.equal(tags.cover?.mime, "image/jpeg");
  assert.ok((tags.cover?.bytes.length ?? 0) >= 32);
});
