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

test("a half-written like mark stays out of the answer", () => {
  const peeled = peelQuestionLike("Смотрю дальше\n[[lik");
  assert.equal(peeled.like, false);
  assert.equal(peeled.text, "Смотрю дальше");
});
