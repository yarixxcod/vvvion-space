import assert from "node:assert/strict";
import test from "node:test";
import { ThinkGate, applyChatReasoning, extractPieces, reasoningFields, softenReasoning, thinkKind, toolReasoningFields, wantsThought } from "./reasoning.ts";

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

test("grok cannot take none, and an easy question stays on the lowest effort", () => {
  assert.equal(reasoningFields("grok-4.7", true, "Докажи теорему по шагам").reasoning_effort, "high");
  assert.equal(reasoningFields("grok-4.5", true, "привет").reasoning_effort, "low");
  assert.equal(reasoningFields("grok-4.5", false, "Докажи теорему по шагам").reasoning_effort, "low");
  assert.equal(thinkKind("gpt-4.1"), "never");
  assert.deepEqual(reasoningFields("gpt-4.1", true, "Докажи теорему по шагам"), {});
  assert.deepEqual(reasoningFields("deepseek-chat", false, "почему так").thinking, { type: "disabled" });
  assert.deepEqual(reasoningFields("deepseek-chat", true, "привет").thinking, { type: "disabled" });
  assert.deepEqual(reasoningFields("deepseek-chat", true, "Сравни два алгоритма и объясни разницу").thinking, { type: "enabled" });
  assert.equal(wantsThought("ок"), false);
  assert.equal(wantsThought("Напиши функцию groupBy и разбери крайние случаи"), true);
  assert.deepEqual(toolReasoningFields("ernie-5.5-flash"), {});
  assert.equal(toolReasoningFields("grok-4").reasoning_effort, "low");
});

test("the catalog alias does not decide the provider switch", () => {
  const easy = applyChatReasoning({ model: "grok-4.3", vvReason: true, vvUser: "привет" }, "deepseek-chat");
  assert.equal("vvReason" in easy, false);
  assert.equal("vvUser" in easy, false);
  assert.deepEqual(easy.thinking, { type: "disabled" });
  const hard = applyChatReasoning(
    { model: "GPT-5.2", vvReason: true, vvUser: "Почему этот алгоритм квадратичный? Объясни по шагам.", tools: [{ type: "function" }] },
    "deepseek-chat",
  );
  assert.equal("thinking" in hard, false);
  assert.equal(Array.isArray(hard.tools), true);
});

test("a rejected none is retried as low, an unknown field is dropped", () => {
  const none = { reasoning_effort: "none" };
  assert.equal(softenReasoning(none, "reasoning_effort must be one of low, medium, high"), true);
  assert.equal(none.reasoning_effort, "low");
  const extra = { reasoning_effort: "high", messages: [] };
  assert.equal(softenReasoning(extra, "unknown parameter reasoning_effort"), true);
  assert.equal("reasoning_effort" in extra, false);
});
