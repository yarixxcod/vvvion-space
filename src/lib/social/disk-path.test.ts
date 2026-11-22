import assert from "node:assert/strict";
import { test } from "node:test";
import { asDiskPath, chatShareToken, loadableImageUrl, shareReferencesDisk, withChatShare } from "./disk-path.ts";

const id = "fileid_fileid_aa";
const token = "sharetoken_share1";
const path = `/api/disk/${id}`;

test("a disk path is recognized on this site only", () => {
  assert.equal(asDiskPath(path), path);
  assert.equal(asDiskPath(`https://vvvion.space${path}`), path);
  assert.equal(asDiskPath(`https://www.vvvion.space${path}`), path);
  assert.equal(asDiskPath(`https://evil.example${path}`), null);
  assert.equal(asDiskPath(`${path}?c=${token}`), null);
  assert.equal(asDiskPath("https://cdn.example/pic.png"), null);
});

test("a shared chat can name its own pictures and not the rest of the disk", () => {
  const messages = [
    { role: "assistant", imageUrl: path, content: `смотри ${path} нет` },
    { role: "user", files: [{ url: "https://vvvion.space/api/disk/other_file_id_ok" }] },
    { role: "user", files: [{ url: `https://www.vvvion.space${path}?ignored=1` }] },
  ];
  assert.equal(shareReferencesDisk(messages, id), true);
  assert.equal(shareReferencesDisk(messages, "other_file_id_ok"), true);
  assert.equal(shareReferencesDisk([{ content: path }], id), false);
  assert.equal(shareReferencesDisk(messages, "missing_file_id_x"), false);
  assert.equal(shareReferencesDisk("nope", id), false);
});

test("a visitor gets the picture through the chat token, and a stranger url is refused", () => {
  assert.equal(withChatShare(path, token), `${path}?c=${token}`);
  assert.equal(withChatShare(`https://vvvion.space${path}`, token), `${path}?c=${token}`);
  assert.equal(withChatShare("https://cdn.example/pic.png", token), "https://cdn.example/pic.png");
  assert.equal(loadableImageUrl(path), path);
  assert.equal(loadableImageUrl(`${path}?c=${token}`), `${path}?c=${token}`);
  assert.equal(loadableImageUrl(`${path}?s=${token}`), "");
  assert.equal(loadableImageUrl("https://cdn.example/pic.png"), "https://cdn.example/pic.png");
  assert.equal(loadableImageUrl("http://cdn.example/pic.png"), "");
  assert.equal(loadableImageUrl("data:image/png;base64,aaaa"), "data:image/png;base64,aaaa");
});

test("the chat link itself is enough when the picture address has no token yet", () => {
  const file = `https://vvvion.space${path}`;
  const page = `https://vvvion.space/s/${token}`;
  assert.equal(chatShareToken(`${file}?c=${token}`, null), token);
  assert.equal(chatShareToken(file, page), token);
  assert.equal(chatShareToken(file, `https://evil.example/s/${token}`), "");
  assert.equal(chatShareToken(file, "https://vvvion.space/"), "");
});
