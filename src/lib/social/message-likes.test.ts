import { test, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { setMessageLike } from "./message-likes-core.ts";
import {
  STICKER_PACKS,
  stickerBody,
  stickerCode,
  isKnownSticker,
  stickerMeaning,
  splitStickerContent,
  stickersAllowed,
  stickerLabel,
  stickerUrl,
} from "../stickers.ts";
const pg = new PGlite();
await pg.exec(`create table "user"(id text primary key);insert into "user" values('alice'),('bob'),('outsider');
create table room_messages(id text primary key,room_id text);insert into room_messages values('message-one','room-one'),('message-two','room-two');
create table room_members(user_id text,room_id text);insert into room_members values('alice','room-one'),('bob','room-one');`);
await pg.exec(readFileSync("migrations/0055_message_likes.sql", "utf8"));
const change = (userId: string, liked: boolean, roomId = "room-one", messageId = "message-one") =>
  pg.transaction((tx) =>
    setMessageLike(
      { query: async <T>(q: string, v?: unknown[]) => tx.query<T>(q, v).then((r) => r.rows) },
      userId,
      { roomId, messageId, liked },
    ),
  );
after(() => pg.close());
test("likes are idempotent and unique per person", async () => {
  assert.deepEqual(await change("alice", true), { likes: 1, liked: true });
  assert.deepEqual(await change("alice", true), { likes: 1, liked: true });
  assert.deepEqual(await change("bob", true), { likes: 2, liked: true });
});
test("unlike removes only the current persons like", async () => {
  assert.deepEqual(await change("alice", false), { likes: 1, liked: false });
  assert.deepEqual(await change("alice", false), { likes: 1, liked: false });
});
test("foreign rooms, outsiders and nonexistent messages cannot be liked", async () => {
  await assert.rejects(change("outsider", true));
  await assert.rejects(change("alice", true, "room-two", "message-two"));
  await assert.rejects(change("alice", true, "room-one", "missing"));
  assert.equal((await pg.query("select * from room_message_likes")).rows.length, 1);
});
test("deleting a message clears its reactions", async () => {
  await pg.exec("delete from room_messages where id='message-one'");
  assert.equal((await pg.query("select * from room_message_likes")).rows.length, 0);
});
test("every sticker has a label and an actual local file, old marker roundtrips remain valid", () => {
  const codes = STICKER_PACKS.flatMap((p) => [...p.codes]);
  assert.equal(codes.length, 104);
  assert.equal(new Set(codes).size, 104);
  for (const code of codes) {
    assert.equal(stickerCode(stickerBody(code)), code);
    assert.equal(isKnownSticker(code), true);
    assert.notEqual(stickerLabel(code), "Стикер");
    const url = stickerUrl(code);
    assert.ok(url.startsWith("/stickers/"));
    assert.ok(readFileSync("public" + url).length > 50);
  }
  assert.equal(stickerCode("[[sticker:1F600]]"), "1F600");
});
test("unknown IDs and injected markup never become URLs or images", () => {
  assert.equal(stickerUrl("../../private"), "");
  assert.deepEqual(splitStickerContent("Hello [[sticker:no-such-id]]"), {
    text: "Hello [[sticker:no-such-id]]",
    stickers: [],
  });
  assert.equal(stickerCode("[[sticker:<script>]]"), null);
});
test("AI gets descriptive meaning; sticker suffix stays separate from prose and is bounded", () => {
  assert.match(stickerMeaning("[[sticker:cosmo-sad]]"), /Грустно/);
  assert.deepEqual(splitStickerContent("Привет!\n[[sticker:cosmo-hello]]"), {
    text: "Привет!",
    stickers: ["cosmo-hello"],
  });
  assert.equal(splitStickerContent("[[sticker:cosmo-love]]".repeat(20)).stickers.length, 2);
  assert.equal(stickersAllowed([{ role: "assistant", content: "[[sticker:cosmo-love]]" }]), false);
  assert.equal(
    stickersAllowed(
      Array.from({ length: 4 }, (_, i) => ({
        role: "assistant",
        content: i ? "text" : "[[sticker:cosmo-love]]",
      })),
    ),
    true,
  );
});
