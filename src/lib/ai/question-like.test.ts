import assert from "node:assert/strict";
import test from "node:test";
import { peelQuestionLike } from "./question-like.ts";

test("a trailing like mark is hidden and remembered", () => {
  const peeled = peelQuestionLike("Хороший вопрос.\n[[like]]");
  assert.equal(peeled.like, true);
  assert.equal(peeled.text, "Хороший вопрос.");
  assert.equal(peeled.text.includes("like"), false);
});

test("an ordinary answer is left untouched", () => {
  const text = "Просто ответ.";
  assert.deepEqual(peelQuestionLike(text), { text, like: false });
});
