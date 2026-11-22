import assert from "node:assert/strict";
import test from "node:test";
import { PASTE_FILE_AT, pasteAsFile } from "./attach.ts";

test("a short paste stays in the composer and a huge one becomes a file", () => {
  assert.equal(pasteAsFile("привет"), false);
  assert.equal(pasteAsFile("a".repeat(PASTE_FILE_AT - 1)), false);
  assert.equal(pasteAsFile("a".repeat(PASTE_FILE_AT)), true);
});
