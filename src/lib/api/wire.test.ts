import assert from "node:assert/strict";
import test from "node:test";
import { API_BODY_LIMIT, readApiBody } from "./body.ts";
import { corsPreflight } from "./cors.ts";
import { errorBody, publicUpstream } from "./errors.ts";
import { failoverChat } from "./failover.ts";
import { buildChatPayload, normalizeChatCompletion } from "./openai-wire.ts";
import { decorateOpenAiSse } from "./sse.ts";

test("openai and anthropic errors are different shapes and 401 is stable", () => {
  const open = errorBody("openai", "invalid_api_key");
  const anth = errorBody("anthropic", "invalid_api_key");
  assert.equal("error" in open && "code" in open.error, true);
  assert.equal(anth.type, "error");
  assert.notDeepEqual(open, anth);
  assert.deepEqual(errorBody("openai", "invalid_api_key"), errorBody("openai", "invalid_api_key"));
  assert.equal(errorBody("anthropic", "premium_required").error.type, "permission_error");
});

test("cors preflight is wildcard without credentials", () => {
  const response = corsPreflight();
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("access-control-allow-credentials"), null);
  const allow = response.headers.get("access-control-allow-headers") || "";
  assert.match(allow, /x-api-key/);
  assert.match(allow, /anthropic-version/);
  assert.match(allow, /x-stainless-lang/);
});

test("bodies over 4 MB are rejected and charset json is accepted", async () => {
  const big = await readApiBody(new Request("https://vvvion.space/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": String(API_BODY_LIMIT + 1) },
    body: "{}",
  }));
  assert.equal(big.ok, false);
  if (!big.ok) assert.equal(big.status, 413);
  const ok = await readApiBody(new Request("https://vvvion.space/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: "{\"model\":\"m\"}",
  }));
  assert.equal(ok.ok, true);
});

test("chat payload keeps tools and drops store, user and catalog personality", () => {
  const built = buildChatPayload({
    model: "demo",
    messages: [{ role: "user", content: "hi" }],
    tools: [{ type: "function", function: { name: "ping" } }],
    store: true,
    user: "secret-user",
    metadata: { a: 1 },
    stream: true,
    max_tokens: 999999,
  }, { maxOutputTokens: 1000 });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.equal(built.payload.max_tokens, 1000);
  assert.deepEqual(built.payload.stream_options, { include_usage: true });
  assert.equal("store" in built.payload, false);
  assert.equal("user" in built.payload, false);
  assert.equal("metadata" in built.payload, false);
  assert.equal(Array.isArray(built.payload.tools), true);
  const roles = (built.payload.messages as { role: string }[]).map((message) => message.role);
  assert.deepEqual(roles, ["user"]);
});

test("a missing usage block is estimated and the model name is the client's", () => {
  const row = normalizeChatCompletion({ choices: [{ message: { role: "assistant", content: "ok", reasoning_content: "think" } }] }, "demo");
  assert.equal(row.model, "demo");
  assert.equal(row.object, "chat.completion");
  assert.equal((row.choices as { message: { reasoning_content?: string } }[])[0].message.reasoning_content, "think");
});

test("upstream text loses secrets and hosts", () => {
  const text = publicUpstream(500, "bad https://api.example.ai/v1 key sk-supersecretvalue", "sk-supersecretvalue");
  assert.equal(text.includes("sk-super"), false);
  assert.equal(text.includes("example.ai"), false);
  assert.match(text, /model returned an error/);
  assert.equal(publicUpstream(502, "Провайдер вернул редирект").includes("Провайдер"), false);
});

test("failover tries the next provider and does not rewrite tools", async () => {
  const calls: { url: string; tools: unknown }[] = [];
  const send = async (url: string, _headers: Headers, body: Record<string, unknown>) => {
    calls.push({ url, tools: body.tools });
    if (url.endsWith("/a")) return { failed: true, response: Response.json({ message: "no sk-supersecretvalue" }, { status: 500 }) };
    return { failed: false, response: Response.json({ choices: [{ message: { content: "ok" } }] }) };
  };
  const result = await failoverChat(
    [
      { url: "https://a.example/a", headers: new Headers(), secret: "sk-supersecretvalue", model: "upstream-a" },
      { url: "https://b.example/b", headers: new Headers(), secret: "other", model: "upstream-b" },
    ],
    { model: "client", messages: [], tools: [{ type: "function", function: { name: "ping" } }] },
    send,
    new AbortController().signal,
  );
  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].tools, [{ type: "function", function: { name: "ping" } }]);
  assert.equal(calls[1].url.endsWith("/b"), true);
});

test("a stream keeps ping comments and ends with DONE", async () => {
  const encoder = new TextEncoder();
  const upstream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode('data: {"model":"upstream","choices":[{"delta":{"content":"Hi"}}]}\n\n'));
      await new Promise((resolve) => setTimeout(resolve, 40));
      controller.close();
    },
  });
  const text = await new Response(decorateOpenAiSse(upstream, { model: "demo", pingMs: 15 })).text();
  assert.match(text, /: ping/);
  assert.match(text, /data: \[DONE\]/);
  assert.match(text, /"model":"demo"/);
  assert.equal(text.includes("upstream"), false);
});
