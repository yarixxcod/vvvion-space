import assert from "node:assert/strict";
import test from "node:test";
import { audioStart, isMusicFile, musicBits, readTags } from "./tags.ts";
import { parseLrc } from "./lrc.ts";

function id3(title: string, artist: string, genre: string): Uint8Array {
  const frames = [frame("TIT2", title), frame("TPE1", artist), frame("TCON", genre)];
  const body = Buffer.concat(frames);
  const size = sync(body.length);
  return new Uint8Array(Buffer.concat([Buffer.from("ID3\x03\x00\x00"), size, body]));
}

function frame(id: string, text: string): Buffer {
  const payload = Buffer.concat([Buffer.from([3]), Buffer.from(text, "utf8")]);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(payload.length, 0);
  return Buffer.concat([Buffer.from(id), size, Buffer.alloc(2), payload]);
}

function sync(value: number): Buffer {
  const out = Buffer.alloc(4);
  for (let i = 3; i >= 0; i -= 1) {
    out[i] = value & 0x7f;
    value >>= 7;
  }
  return out;
}

function atomBytes(type: Buffer, body: Buffer): Buffer {
  const size = Buffer.alloc(4);
  size.writeUInt32BE(8 + body.length, 0);
  return Buffer.concat([size, type, body]);
}

function atom(type: string, body: Buffer): Buffer {
  return atomBytes(Buffer.from(type), body);
}

test("id3 title artist and genre", () => {
  const tags = readTags(id3("Ночь", "Мара", "Jazz"));
  assert.equal(tags.title, "Ночь");
  assert.equal(tags.artist, "Мара");
  assert.equal(tags.genre, "Jazz");
});

test("m4a atoms", () => {
  const data = (text: string) => {
    const payload = Buffer.from(text, "utf8");
    const head = Buffer.alloc(8);
    head.writeUInt32BE(1, 0);
    return atom("data", Buffer.concat([head, payload]));
  };
  const name = (mark: string) => Buffer.concat([Buffer.from([0xa9]), Buffer.from(mark)]);
  const ilst = Buffer.concat([atomBytes(name("nam"), data("Song")), atomBytes(name("ART"), data("Band")), atomBytes(name("gen"), data("Pop"))]);
  const meta = Buffer.concat([Buffer.alloc(4), atom("ilst", ilst)]);
  const file = atom("moov", atom("udta", atom("meta", meta)));
  const tags = readTags(new Uint8Array(file));
  assert.equal(tags.title, "Song");
  assert.equal(tags.artist, "Band");
  assert.equal(tags.genre, "Pop");
});

test("voice notes are not tracks", () => {
  assert.equal(isMusicFile("voice.webm", "audio/webm"), false);
  assert.equal(isMusicFile("night.mp3", "audio/mpeg"), true);
  assert.equal(isMusicFile("demo.m4a", ""), true);
});

test("mp3 frame bitrate", () => {
  const tags = readTags(new Uint8Array([0xff, 0xfb, 0xe0, 0x00, 0xff, 0xfb, 0xe0, 0x00]));
  assert.equal(tags.bitrate, 320);
  assert.equal(tags.sampleRate, 44100);
});

test("audio starts after a long id3 cover", () => {
  const header = new Uint8Array(10);
  header.set([0x49, 0x44, 0x33, 0x03, 0x00, 0x00]);
  const size = 600_000;
  header[6] = (size >> 21) & 0x7f;
  header[7] = (size >> 14) & 0x7f;
  header[8] = (size >> 7) & 0x7f;
  header[9] = size & 0x7f;
  assert.equal(audioStart(header), 10 + size);
});

test("m4a clock comes from mdhd", () => {
  const box = new Uint8Array(32);
  box[0] = 0;
  box[1] = 0;
  box[2] = 0;
  box[3] = 32;
  box.set([0x6d, 0x64, 0x68, 0x64], 4);
  const rate = 44100;
  const samples = rate * 180;
  box[20] = (rate >>> 24) & 0xff;
  box[21] = (rate >>> 16) & 0xff;
  box[22] = (rate >>> 8) & 0xff;
  box[23] = rate & 0xff;
  box[24] = (samples >>> 24) & 0xff;
  box[25] = (samples >>> 16) & 0xff;
  box[26] = (samples >>> 8) & 0xff;
  box[27] = samples & 0xff;
  const tags = readTags(box);
  assert.equal(tags.sampleRate, 44100);
  assert.equal(tags.duration, 180);
  assert.equal(musicBits(tags, 180 * 128_000 / 8), "128 кбит/с · 44.1 кГц");
});

test("lrc lines", () => {
  const lines = parseLrc("[00:12.00] Ночь\n[00:16.50] тише");
  assert.equal(lines.length, 2);
  assert.equal(lines[0]?.text, "Ночь");
  assert.equal(lines[1]?.at, 16.5);
});

test("lrc words follow the line", () => {
  const lines = parseLrc("[00:01.00] <00:01.00>Ночь <00:01.40>тише");
  assert.equal(lines[0]?.text, "Ночь тише");
  assert.equal(lines[0]?.words?.length, 2);
  assert.equal(lines[0]?.words?.[1]?.at, 1.4);
});
