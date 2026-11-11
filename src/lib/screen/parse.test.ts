import assert from "node:assert/strict";
import test from "node:test";
import { parseVideoLink } from "./parse.ts";

test("youtube watch, short and youtu.be", () => {
  const id = "dQw4w9WgXcQ";
  assert.equal(parseVideoLink(`https://www.youtube.com/watch?v=${id}`)?.externalId, id);
  assert.equal(parseVideoLink(`https://youtu.be/${id}`)?.provider, "youtube");
  assert.equal(parseVideoLink(`https://www.youtube.com/shorts/${id}`)?.embedUrl.includes("youtube-nocookie.com/embed/"), true);
  assert.equal(parseVideoLink("https://example.com/watch?v=dQw4w9WgXcQ"), null);
});

test("rutube and vk", () => {
  const id = "a".repeat(32);
  assert.equal(parseVideoLink(`https://rutube.ru/video/${id}/`)?.provider, "rutube");
  const vk = parseVideoLink("https://vk.com/video-123_456");
  assert.equal(vk?.provider, "vk");
  assert.equal(vk?.externalId, "-123_456");
  assert.match(vk?.embedUrl || "", /oid=-123/);
  assert.equal(parseVideoLink("https://vk.com/video_ext.php?oid=9&id=8")?.externalId, "9_8");
});
