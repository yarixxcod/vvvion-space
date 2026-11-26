import assert from "node:assert/strict";
import test from "node:test";
import { apiModelSlug, publishedChatId, resolvePublishedChat, uniquePublicId } from "./model-public.ts";

test("seed slots without the owner's key stay off the public list", () => {
  assert.equal(publishedChatId("DeepSeek-4.1 Flash", "DeepSeek", ""), null);
  assert.equal(publishedChatId("GLM 5.3 Flash", "glm", "   "), null);
  assert.equal(publishedChatId("grok-4.5", "grok-4", ""), null);
});

test("display names become request ids and vendor ids do not", () => {
  assert.equal(apiModelSlug("DeepSeek-4.1 Flash"), "deepseek-4.1-flash");
  assert.equal(apiModelSlug("GLM 5.3 Flash"), "glm-5.3-flash");
  assert.equal(apiModelSlug("Ernie-5.5-flash"), "ernie-5.5-flash");
  assert.equal(apiModelSlug("Mistral 3 Small"), "mistral-3-small");
  assert.equal(apiModelSlug("GPT-6"), "gpt-6");
  assert.equal(apiModelSlug("Z-image"), "z-image");
  assert.equal(apiModelSlug("Flux 2 Klein"), "flux-2-klein");
  assert.equal(apiModelSlug("Recraft-v4.1"), "recraft-v4.1");
  assert.equal(publishedChatId("DeepSeek-4.1 Flash", "vendor/deepseek", "sk-own"), "deepseek-4.1-flash");
  assert.equal(publishedChatId("DeepSeek", "", "sk-own"), "deepseek");
  assert.equal(publishedChatId("!!!", "not a name", "sk-own"), null);
  assert.equal(publishedChatId("!!!", "grok-4.5", "sk-own"), "grok-4.5");
});

test("colliding slugs fall back to a free catalog slug, then a number", () => {
  const taken = new Set<string>(["flux"]);
  assert.equal(uniquePublicId("Flux", "flux-klein", taken), "flux-klein");
  assert.equal(uniquePublicId("Flux", "flux", taken), "flux-2");
});

test("slug, catalog name and a unique alias resolve to the internal catalog", () => {
  const models = [
    { id: "deepseek-4.1-flash", catalog: "DeepSeek", type: "chat", aliases: ["DeepSeek", "deepseek-chat", "vendor/deepseek"] },
    { id: "kimi", catalog: "Kimi", type: "chat", aliases: ["kimi-v3"] },
  ];
  assert.equal(resolvePublishedChat(models, "deepseek-4.1-flash"), "DeepSeek");
  assert.equal(resolvePublishedChat(models, "DeepSeek"), "DeepSeek");
  assert.equal(resolvePublishedChat(models, "vendor/deepseek"), "DeepSeek");
  assert.equal(resolvePublishedChat(models, "missing"), null);
  assert.equal(
    resolvePublishedChat([...models, { id: "other", catalog: "Other", type: "chat", aliases: ["vendor/deepseek"] }], "vendor/deepseek"),
    null,
  );
});
