import assert from "node:assert/strict";
import test from "node:test";
import { publishedChatId, resolvePublishedChat } from "./model-public.ts";

test("seed slots without the owner's key stay off the public list", () => {
  assert.equal(publishedChatId("grok-4.5", "", ""), null);
  assert.equal(publishedChatId("grok-4.3", "   ", ""), null);
  assert.equal(publishedChatId("grok-4.5", "grok-4", ""), null);
  assert.equal(publishedChatId("grok-4.7", "grok-4.7", "  "), null);
});

test("the catalog ID stays stable across provider-specific model names", () => {
  assert.equal(publishedChatId("grok-4.5", "grok-4", "sk-own"), "grok-4.5");
  assert.equal(publishedChatId("DeepSeek", "deepseek-chat", "sk-own"), "DeepSeek");
});

test("an own key with no override keeps the slot name", () => {
  assert.equal(publishedChatId("DeepSeek", "", "sk-own"), "DeepSeek");
  assert.equal(publishedChatId("bad name", "nope id", "sk-own"), null);
});


test("legacy upstream aliases resolve to the enabled catalog model without ambiguity", () => {
  const models = [{ id: "DeepSeek", type: "chat", aliases: ["deepseek-chat", "vendor/deepseek"] }, { id: "Kimi", type: "chat", aliases: ["kimi-v3"] }];
  assert.equal(resolvePublishedChat(models, "DeepSeek"), "DeepSeek");
  assert.equal(resolvePublishedChat(models, "vendor/deepseek"), "DeepSeek");
  assert.equal(resolvePublishedChat(models, "missing"), null);
  assert.equal(resolvePublishedChat([...models, { id: "Other", type: "chat", aliases: ["vendor/deepseek"] }], "vendor/deepseek"), null);
});
