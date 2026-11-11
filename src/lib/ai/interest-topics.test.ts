import assert from "node:assert/strict";
import test from "node:test";
import { personalSuggestions, topicLabel } from "./interest-topics.ts";

test("personal questions follow chosen interests and tone", () => {
  const cards = personalSuggestions(["cinema", "food"], "story");
  assert.equal(cards.length, 8);
  assert.equal(cards[0]?.title, "На вечер");
  assert.match(cards[0]?.prompt || "", /фильм/);
  assert.match(cards[0]?.prompt || "", /короткий рассказ/);
  assert.equal(cards[1]?.title, "Из трёх");
  assert.equal(topicLabel("music"), "Музыка");
});

test("unknown interests do not invent questions", () => {
  assert.deepEqual(personalSuggestions(["nope"], "clear"), []);
  assert.equal(personalSuggestions([], "short").length, 0);
});
