import assert from "node:assert/strict";
import test from "node:test";
import { AnthropicEncoder, anthropicRequestToChat, chatCompletionToAnthropic, estimateInputTokens } from "./anthropic-convert.ts";
import { errorBody } from "./errors.ts";

test("tool_result becomes a tool message and text plus image stay on the user", () => {
  const converted = anthropicRequestToChat({
    model: "demo",
    max_tokens: 200,
    system: [{ type: "text", text: "be brief" }],
    messages: [{
      role: "user",
      content: [
        { type: "text", text: "look" },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "aaaa" } },
        { type: "tool_result", tool_use_id: "toolu_1", content: "42" },
      ],
    }],
    tools: [{ name: "ping", input_schema: { type: "object", properties: {} } }],
    tool_choice: { type: "any" },
  });
  assert.equal(converted.ok, true);
  if (!converted.ok) return;
  assert.equal(converted.messages[0].role, "system");
  assert.equal(converted.messages[1].role, "user");
  assert.equal(Array.isArray(converted.messages[1].content), true);
  assert.equal(converted.messages[2].role, "tool");
  assert.equal(converted.messages[2].tool_call_id, "toolu_1");
  assert.equal(converted.toolChoice, "required");
  assert.equal((converted.tools?.[0] as { function: { name: string } }).function.name, "ping");
});

test("assistant tool_use and a broken argument string round-trip", () => {
  const converted = anthropicRequestToChat({
    model: "demo",
    max_tokens: 20,
    messages: [{ role: "assistant", content: [{ type: "tool_use", id: "toolu_9", name: "ping", input: { q: 1 } }] }],
  });
  assert.equal(converted.ok, true);
  if (!converted.ok) return;
  assert.equal(converted.messages[0].tool_calls?.[0].id, "toolu_9");
  const back = chatCompletionToAnthropic({
    id: "chatcmpl_abc",
    choices: [{ finish_reason: "tool_calls", message: { content: "", tool_calls: [{ id: "toolu_9", function: { name: "ping", arguments: "{no" } }] } }],
    usage: { prompt_tokens: 3, completion_tokens: 4 },
  }, "demo");
  assert.equal(back.stop_reason, "tool_use");
  assert.deepEqual(back.content[0], { type: "tool_use", id: "toolu_9", name: "ping", input: {} });
  assert.equal(back.usage.output_tokens, 4);
});

test("anthropic stream events keep block indexes and stop", () => {
  const encoder = new AnthropicEncoder("demo", "msg_test");
  const first = encoder.pushChunk({ choices: [{ delta: { content: "Hi" } }] });
  const second = encoder.pushChunk({ choices: [{ delta: { tool_calls: [{ index: 0, id: "toolu_1", function: { name: "ping", arguments: "{\"a\":1}" } }] }, finish_reason: "tool_calls" }] });
  const end = encoder.finish();
  const events = `${first}${second}${end}`.split("event: ").slice(1).map((part) => part.split("\n")[0]);
  assert.deepEqual(events.slice(0, 4), ["message_start", "content_block_start", "content_block_delta", "content_block_start"]);
  assert.ok(events.includes("content_block_stop"));
  assert.equal(events.at(-2), "message_delta");
  assert.equal(events.at(-1), "message_stop");
  assert.match(end, /"stop_reason":"tool_use"/);
});

test("missing max_tokens is rejected and count_tokens is an estimate", () => {
  const failed = anthropicRequestToChat({ model: "demo", messages: [] });
  assert.equal(failed.ok, false);
  assert.equal(estimateInputTokens("1234567") > 1, true);
  assert.notDeepEqual(errorBody("openai", "model_not_found"), errorBody("anthropic", "model_not_found"));
});
