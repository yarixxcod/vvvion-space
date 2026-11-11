import assert from "node:assert/strict";
import test from "node:test";
import { clipText, subCopy, subRef, subWindow, validPushPath, validPushToken } from "./push-policy.ts";

test("push token length and control characters", () => {
  assert.equal(validPushToken("a".repeat(99)), false);
  assert.equal(validPushToken("a".repeat(100)), true);
  assert.equal(validPushToken(`${"a".repeat(100)}\n`), false);
  assert.equal(validPushToken("a".repeat(4097)), false);
});

test("push urls stay on a relative site path", () => {
  assert.equal(validPushPath("/chat/abc"), true);
  assert.equal(validPushPath("/messages/room-1"), true);
  assert.equal(validPushPath("https://vvvion.space/chat/abc"), false);
  assert.equal(validPushPath("//evil.example/chat"), false);
  assert.equal(validPushPath("/chat/../admin"), false);
  assert.equal(validPushPath("chat/abc"), false);
});

test("subscription windows do not overlap and the end date is the dedup key", () => {
  const now = Date.parse("2026-11-10T12:00:00.000Z");
  const day = 86_400_000;
  assert.equal(subWindow(now, now + 2.5 * day), "3d");
  assert.equal(subWindow(now, now + 0.5 * day), "1d");
  assert.equal(subWindow(now, now + 1.5 * day), null);
  assert.equal(subWindow(now, now - day), null);
  const ends = new Date("2026-11-13T08:00:00.000Z");
  assert.equal(subRef(ends), "2026-11-13");
  assert.equal(subCopy("mega", "3d").url, "/disk");
  assert.equal(subCopy("premium", "1d").body, "Премиум закончится завтра");
  assert.equal(clipText("  привет\nмир  ", 20), "привет мир");
});
