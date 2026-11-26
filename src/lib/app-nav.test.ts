import assert from "node:assert/strict";
import test from "node:test";
import { circleUnderlay, destinationFor, parseSitePath } from "./app-nav.ts";

test("notification paths map onto the real home search", () => {
  assert.deepEqual(destinationFor("/chat/abcdef12"), { to: "/", search: { chat: "abcdef12" } });
  assert.deepEqual(destinationFor("/messages/room_1234"), { to: "/", search: { place: "chat", room: "room_1234" } });
  assert.deepEqual(destinationFor("/disk"), { to: "/", search: { place: "disk" } });
  assert.deepEqual(destinationFor("/c/shop"), { to: "/", search: { place: "shop" } });
  assert.deepEqual(destinationFor("/?place=services&svc=weather"), { to: "/", search: { place: "services", svc: "weather" } });
  assert.deepEqual(destinationFor("/c/services?svc=api"), { to: "/", search: { place: "services", svc: "api" } });
});

test("a service deep link is not rewritten back to the services grid", () => {
  assert.equal(circleUnderlay("https://vvvion.space/?place=services&svc=weather"), null);
  assert.equal(circleUnderlay("https://vvvion.space/?place=services&svc=api&lang=en"), null);
  assert.equal(circleUnderlay("/?place=services&svc=calendar&event=abcdef12"), null);
  assert.equal(circleUnderlay("https://vvvion.space/?place=services"), "/");
  assert.equal(circleUnderlay("https://vvvion.space/?place=services&lang=en"), "/?lang=en");
  assert.equal(circleUnderlay("https://vvvion.space/?place=services&svc=nope"), "/");
  assert.equal(circleUnderlay("https://vvvion.space/?place=disk"), "/");
});

test("only this site's absolute urls are accepted", () => {
  assert.equal(parseSitePath("https://vvvion.space/disk"), "/disk");
  assert.equal(parseSitePath("https://evil.example/disk"), null);
  assert.equal(parseSitePath("//evil.example/disk"), null);
});
