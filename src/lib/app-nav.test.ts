import assert from "node:assert/strict";
import test from "node:test";
import { destinationFor, parseSitePath } from "./app-nav.ts";

test("notification paths map onto the real home search", () => {
  assert.deepEqual(destinationFor("/chat/abcdef12"), { to: "/", search: { chat: "abcdef12" } });
  assert.deepEqual(destinationFor("/messages/room_1234"), { to: "/", search: { place: "chat", room: "room_1234" } });
  assert.deepEqual(destinationFor("/disk"), { to: "/", search: { place: "disk" } });
  assert.deepEqual(destinationFor("/c/shop"), { to: "/", search: { place: "shop" } });
  assert.equal(destinationFor("/chat/short"), null);
});

test("only this site's absolute urls are accepted", () => {
  assert.equal(parseSitePath("https://vvvion.space/disk"), "/disk");
  assert.equal(parseSitePath("https://evil.example/disk"), null);
  assert.equal(parseSitePath("//evil.example/disk"), null);
});
