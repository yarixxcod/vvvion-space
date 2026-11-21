import assert from "node:assert/strict";
import { test } from "node:test";
import { modelProfile } from "./model-profile.ts";

test("known models get native tools and unknown custom models stay on JSON", () => {
  assert.equal(modelProfile("grok-4").tools, "native");
  assert.equal(modelProfile("grok-4").core, "full");
  assert.equal(modelProfile("grok-4").reasoning.first, "medium");
  assert.equal(modelProfile("deepseek-chat").maxOutputTokens, 8192);
  assert.equal(modelProfile("ernie-4").core, "lite");
  assert.equal(modelProfile("my-local", "custom").tools, "json");
});
