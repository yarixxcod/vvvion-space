import assert from "node:assert/strict";
import test from "node:test";
import { dayPart, nickOf, personaIsFree } from "./persona-free.ts";

test("greeting follows the clock and skips emails", () => {
  assert.equal(dayPart(5), "morning");
  assert.equal(dayPart(11), "morning");
  assert.equal(dayPart(12), "afternoon");
  assert.equal(dayPart(16), "afternoon");
  assert.equal(dayPart(17), "evening");
  assert.equal(dayPart(22), "evening");
  assert.equal(dayPart(23), "night");
  assert.equal(dayPart(0), "night");
  assert.equal(dayPart(4), "night");
  assert.equal(nickOf("  Аня Петрова "), "Аня");
  assert.equal(nickOf("anya@mail.com"), "");
  assert.equal(nickOf("  "), "");
  assert.equal(personaIsFree("psych"), true);
  assert.equal(personaIsFree("marketer"), true);
  assert.equal(personaIsFree("chef"), true);
  assert.equal(personaIsFree("programmer"), true);
  assert.equal(personaIsFree("lawyer"), false);
});
