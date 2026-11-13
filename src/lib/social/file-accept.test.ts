import assert from "node:assert/strict";
import { test } from "node:test";
import { acceptUpload, serveFile } from "./file-accept.ts";

const svg = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'></svg>");
const html = Buffer.from("<!DOCTYPE html><script>alert(1)</script>");
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test("svg and html are refused even when the browser claims a safe mime", () => {
  assert.equal(acceptUpload("image/svg+xml", svg), null);
  assert.equal(acceptUpload("image/jpeg", svg), null);
  assert.equal(acceptUpload("image/png", html), null);
  assert.equal(acceptUpload("text/html", html), null);
  assert.deepEqual(serveFile("image/svg+xml"), { type: "application/octet-stream", inline: false });
});

test("a real image is accepted from its signature, not the claimed mime", () => {
  assert.equal(acceptUpload("application/octet-stream", jpeg), "image/jpeg");
  assert.equal(acceptUpload("text/plain", png), "image/png");
  assert.equal(acceptUpload("text/plain", Buffer.from("hello note")), "text/plain");
});
