import assert from "node:assert/strict";
import test from "node:test";
import { codeToPk, clipHost, instagramTarget, pkToCode, rewriteInstagram } from "./grab-url.ts";
import { linksFromDump } from "./ytdlp.server.ts";

test("clip links stay on the five sites", () => {
  assert.equal(clipHost("https://youtu.be/dQw4w9WgXcQ"), "youtube");
  assert.equal(clipHost("https://www.youtube.com/shorts/dQw4w9WgXcQ"), "youtube");
  assert.equal(clipHost("https://www.instagram.com/reel/abc/"), "instagram");
  assert.equal(clipHost("https://instagr.am/p/abc/"), "instagram");
  assert.equal(clipHost("https://vm.tiktok.com/Zabc/"), "tiktok");
  assert.equal(clipHost("https://pin.it/abc"), "pinterest");
  assert.equal(clipHost("https://vk.com/video-1_2"), "vk");
  assert.equal(clipHost("https://example.com/watch"), null);
});

test("instagram posts, photos and stories all count", () => {
  assert.deepEqual(instagramTarget("https://www.instagram.com/p/AbC123/"), { kind: "post", code: "AbC123" });
  assert.deepEqual(instagramTarget("https://www.instagram.com/reel/AbC123/?igsh=1"), { kind: "post", code: "AbC123" });
  assert.deepEqual(instagramTarget("https://www.instagram.com/pcloud/p/AbC123/"), { kind: "post", code: "AbC123" });
  assert.deepEqual(instagramTarget("https://www.instagram.com/share/reel/AbC123/"), { kind: "post", code: "AbC123" });
  assert.deepEqual(instagramTarget("https://www.instagram.com/share/p/AbC123/?igsh=1"), { kind: "post", code: "AbC123" });
  assert.deepEqual(instagramTarget("https://www.instagram.com/stories/rina/17890123456789012/"), { kind: "story", user: "rina", id: "17890123456789012" });
  assert.deepEqual(instagramTarget("https://www.instagram.com/stories/rina/"), { kind: "stories", user: "rina" });
  assert.deepEqual(instagramTarget("https://www.instagram.com/stories/highlights/18000111222/"), { kind: "highlight", id: "18000111222" });
  assert.deepEqual(instagramTarget("https://www.instagram.com/rina/?story_media_id=17890123456789012"), { kind: "story", user: "rina", id: "17890123456789012" });
  assert.equal(instagramTarget("https://www.instagram.com/rina/"), null);
  assert.equal(rewriteInstagram("https://www.instagram.com/share/reel/AbC123/"), "https://www.instagram.com/reel/AbC123/");
  assert.equal(rewriteInstagram("https://www.instagram.com/share/p/AbC123/"), "https://www.instagram.com/p/AbC123/");
  assert.equal(pkToCode(codeToPk("aye83DjauH")), "aye83DjauH");
  const token = Buffer.from("highlight:18090946048123978").toString("base64").replace(/=+$/, "");
  assert.equal(token.startsWith("aGlnaGxp"), true);
  assert.deepEqual(instagramTarget(`https://www.instagram.com/s/${token}?igsh=1`), { kind: "highlight", id: "18090946048123978" });
});

test("photo posts are kept, not dropped as video-only", () => {
  const links = linksFromDump({
    _type: "playlist",
    title: "Post by pcloud",
    entries: [
      { id: "a", title: "Video by pcloud", formats: [], thumbnails: [
        { url: "https://cdn.example/a.jpg?stp=dst-jpg_e35_s150x150", width: 150 },
        { url: "https://cdn.example/a.jpg?stp=dst-jpg_e35_tt6", width: 1080 },
      ] },
      { id: "b", title: "Video by pcloud", formats: [{ url: "https://cdn.example/b.mp4", ext: "mp4", vcodec: "avc1", height: 720 }], thumbnails: [{ url: "https://cdn.example/b.jpg", width: 720 }] },
    ],
  });
  assert.equal(links.length, 2);
  assert.equal(links[0]?.mime, "image/jpeg");
  assert.equal(links[0]?.url, "https://cdn.example/a.jpg?stp=dst-jpg_e35_tt6");
  assert.equal(links[1]?.mime, "video/mp4");
});
