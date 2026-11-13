import assert from "node:assert/strict";
import { test } from "node:test";
import { bytesResponse } from "./byte-range.ts";

const body = Uint8Array.from({ length: 200 }, (_, index) => index);

function respond(range?: string, method = "GET") {
  const headers = new Headers({ "content-type": "audio/mpeg", "cache-control": "private, max-age=86400" });
  const request = new Request("https://vvvion.space/api/disk/x", { method, headers: range ? { range } : undefined });
  return bytesResponse(request, body, headers);
}

test("no range is the whole file", async () => {
  const res = respond();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("accept-ranges"), "bytes");
  assert.equal(res.headers.get("content-length"), "200");
  assert.equal((await res.arrayBuffer()).byteLength, 200);
});

test("a closed range is 206", async () => {
  const res = respond("bytes=0-99");
  assert.equal(res.status, 206);
  assert.equal(res.headers.get("content-range"), "bytes 0-99/200");
  assert.equal(res.headers.get("content-length"), "100");
  assert.equal((await res.arrayBuffer()).byteLength, 100);
});

test("an open range is the tail", async () => {
  const res = respond("bytes=100-");
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.equal(res.status, 206);
  assert.equal(res.headers.get("content-range"), "bytes 100-199/200");
  assert.equal(bytes.length, 100);
  assert.equal(bytes[0], 100);
});

test("a suffix range is the last bytes", async () => {
  const res = respond("bytes=-50");
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.equal(res.status, 206);
  assert.equal(bytes.length, 50);
  assert.equal(bytes[0], 150);
});

test("a range past the end is 416", () => {
  const res = respond("bytes=999999999-");
  assert.equal(res.status, 416);
  assert.equal(res.headers.get("content-range"), "bytes */200");
});

test("HEAD keeps the range headers and no body", async () => {
  const res = respond("bytes=0-1", "HEAD");
  assert.equal(res.status, 206);
  assert.equal(res.headers.get("content-range"), "bytes 0-1/200");
  assert.equal(res.headers.get("accept-ranges"), "bytes");
  assert.equal(await res.text(), "");
});
