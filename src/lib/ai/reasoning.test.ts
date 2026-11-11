import assert from "node:assert/strict";
import test from "node:test";
import { ThinkGate, extractPieces, reasoningFields, softenReasoning } from "./reasoning.ts";

test("reasoning_content stays out of the answer", () => {
  const pieces = extractPieces({
    choices: [{ delta: { reasoning_content: "сначала сложу", content: "36" } }],
  });
  assert.equal(pieces.reason, "сначала сложу");
  assert.equal(pieces.text, "36");
});

test("responses reasoning events are traces, not answers", () => {
  const reason = extractPieces({ type: "response.reasoning_summary_text.delta", delta: "шаг" });
  const text = extractPieces({ type: "response.output_text.delta", delta: "готово" });
  assert.equal(reason.reason, "шаг");
  assert.equal(reason.text, "");
  assert.equal(text.text, "готово");
  assert.equal(text.reason, "");
});

test("think tags split across chunks", () => {
  const gate = new ThinkGate();
  const a = gate.push("До <thi");
  const b = gate.push("nk>тихо");
  const c = gate.push("</think>ясно");
  const end = gate.flush();
  assert.equal(a.answer + b.answer + c.answer + end.answer, "До ясно");
  assert.equal(a.reason + b.reason + c.reason + end.reason, "тихо");
});

test("grok cannot take none, so off is the lowest accepted effort", () => {
  assert.equal(reasoningFields("grok-4.7", true).reasoning_effort, "high");
  assert.equal(reasoningFields("grok-4.5", false).reasoning_effort, "low");
  assert.equal(reasoningFields("gpt-4.1", false).reasoning_effort, "none");
  assert.deepEqual(reasoningFields("deepseek-chat", false).thinking, { type: "disabled" });
});

test("a rejected none is retried as low, an unknown field is dropped", () => {
  const none = { reasoning_effort: "none" };
  assert.equal(softenReasoning(none, "reasoning_effort must be one of low, medium, high"), true);
  assert.equal(none.reasoning_effort, "low");
  const extra = { reasoning_effort: "high", messages: [] };
  assert.equal(softenReasoning(extra, "unknown parameter reasoning_effort"), true);
  assert.equal("reasoning_effort" in extra, false);
});
