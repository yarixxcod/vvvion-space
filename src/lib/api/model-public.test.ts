import assert from "node:assert/strict";
import test from "node:test";
import { publishedChatId } from "./model-public.ts";

test("seed slots without the owner's key stay off the public list", () => {
  assert.equal(publishedChatId("grok-4.5", "", ""), null);
  assert.equal(publishedChatId("grok-4.3", "   ", ""), null);
  assert.equal(publishedChatId("grok-4.5", "grok-4", ""), null);
  assert.equal(publishedChatId("grok-4.7", "grok-4.7", "  "), null);
});

test("the provider model id is what clients call", () => {
  assert.equal(publishedChatId("grok-4.5", "grok-4", "sk-own"), "grok-4");
  assert.equal(publishedChatId("DeepSeek", "deepseek-chat", "sk-own"), "deepseek-chat");
});

test("an own key with no override keeps the slot name", () => {
  assert.equal(publishedChatId("DeepSeek", "", "sk-own"), "DeepSeek");
  assert.equal(publishedChatId("bad name", "nope id", "sk-own"), null);
});
