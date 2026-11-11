import assert from "node:assert/strict";
import test from "node:test";
import { explainApiError, readApiFailure } from "./api-error.ts";

test("openai key and quota errors become short russian", () => {
  const key = explainApiError(401, JSON.stringify({ error: { message: "Incorrect API key provided: sk-live-secret", code: "invalid_api_key" } }), "sk-live-secret");
  assert.match(key, /Ключ не принят/);
  assert.equal(key.includes("sk-live"), false);
  const quota = explainApiError(429, JSON.stringify({ error: { message: "You exceeded your current quota", type: "insufficient_quota" } }));
  assert.match(quota, /квота/);
});

test("context length, missing model and html stay readable", () => {
  assert.match(
    explainApiError(400, JSON.stringify({ error: { message: "This model's maximum context length is 8192 tokens" } })),
    /слишком длинный/i,
  );
  assert.match(explainApiError(404, JSON.stringify({ error: "The model `grok-x` does not exist" })), /нет у провайдера/);
  assert.match(explainApiError(502, "<html><body>bad gateway</body></html>"), /недоступен/);
});

test("validation details and stream error objects are pulled out", () => {
  const detail = explainApiError(422, JSON.stringify({ detail: [{ msg: "field required", type: "missing" }] }));
  assert.match(detail, /field required|не принял/);
  assert.equal(readApiFailure({ choices: [{ delta: { content: "ok" } }] }), undefined);
  assert.match(String(readApiFailure({ error: { message: "Rate limit reached for requests" } })), /минуту/);
});
