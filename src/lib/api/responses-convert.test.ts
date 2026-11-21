import assert from "node:assert/strict";
import test from "node:test";
import { ResponsesEncoder, chatCompletionToResponse, responsesRequestToChat } from "./responses-convert.ts";

test("responses input and a custom tool become chat messages", () => {
  const converted = responsesRequestToChat({
    model: "demo",
    instructions: "brief",
    input: [
      { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
      { type: "function_call", name: "apply_patch", arguments: "{\"input\":\"x\"}", call_id: "call_1" },
      { type: "function_call_output", call_id: "call_1", output: "ok" },
    ],
    tools: [{ type: "custom", name: "apply_patch" }],
    max_output_tokens: 50,
  });
  assert.equal(converted.ok, true);
  if (!converted.ok) return;
  assert.equal(converted.messages[0].role, "system");
  assert.equal(converted.messages[1].content, "hi");
  assert.equal(converted.customTools[0], "apply_patch");
  assert.equal(converted.maxTokens, 50);
});

test("builtin response tools and stored state are rejected", () => {
  const tool = responsesRequestToChat({ model: "demo", input: "hi", tools: [{ type: "web_search", name: "web" }] });
  assert.equal(tool.ok, false);
  if (!tool.ok) assert.equal(tool.code, "unsupported_tool");
  const state = responsesRequestToChat({ model: "demo", input: "hi", previous_response_id: "resp_1" });
  assert.equal(state.ok, false);
  if (!state.ok) assert.equal(state.code, "unsupported_parameter");
});

test("a completed response carries usage and the stream ends with response.completed", () => {
  const done = chatCompletionToResponse({
    choices: [{ message: { content: "pong", tool_calls: [{ id: "call_1", function: { name: "apply_patch", arguments: "{\"input\":\"diff\"}" } }] } }],
    usage: { prompt_tokens: 2, completion_tokens: 3 },
  }, "demo", ["apply_patch"]);
  assert.equal(done.usage.total_tokens, 5);
  assert.equal(done.output[1].arguments, "diff");
  const encoder = new ResponsesEncoder("demo");
  const events = `${encoder.pushChunk({ choices: [{ delta: { content: "Hi" } }], usage: { prompt_tokens: 2, completion_tokens: 1 } })}${encoder.finish()}`;
  assert.match(events, /response\.created/);
  assert.match(events, /response\.output_text\.delta/);
  assert.match(events, /response\.completed/);
  assert.match(events, /"usage":\{"input_tokens":2,"output_tokens":1,"total_tokens":3\}/);
  assert.match(events, /sequence_number/);
});
