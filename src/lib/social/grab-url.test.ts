import assert from "node:assert/strict";
import { test } from "node:test";
import { clipHost } from "./grab-url.ts";

test("clip hosts are exact and lookalikes are refused", () => {
  assert.equal(clipHost("https://www.tiktok.com/@a/video/1"), "tiktok");
  assert.equal(clipHost("https://vm.tiktok.com/Z/"), "tiktok");
  assert.equal(clipHost("https://evil-tiktok.com/v"), null);
  assert.equal(clipHost("https://tiktok.com.evil.com/v"), null);
  assert.equal(clipHost("https://instagram.com.attacker.test/p/1"), null);
  assert.equal(clipHost("https://www.instagram.com/reel/abc/"), "instagram");
  assert.equal(clipHost("https://youtu.be/abc"), "youtube");
  assert.equal(clipHost("https://m.youtube.com/watch?v=abc"), "youtube");
  assert.equal(clipHost("https://vk.com/video1_2"), "vk");
  assert.equal(clipHost("https://pin.it/abc"), "pinterest");
});
