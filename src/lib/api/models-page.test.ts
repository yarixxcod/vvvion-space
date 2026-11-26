import assert from "node:assert/strict";
import test from "node:test";
import { catalogWindow, parseModelsQuery, renderModelsShell, sliceByCursor, wantsModelsHtml } from "./models-page.ts";
import { parsePublicModels } from "./public-models.ts";
import { apiHostDecision, hasApiHost, isApiHost } from "./api-host.ts";

const models = [
  { id: "deepseek-4.1-flash", displayName: "DeepSeek-4.1 Flash", type: "chat" as const },
  { id: "glm-5.3-flash", displayName: "GLM 5.3 Flash", type: "chat" as const },
  { id: "z-image", displayName: "Z-image <script>", type: "image" as const },
];

test("browsers without a key get HTML, clients keep JSON", () => {
  assert.equal(wantsModelsHtml({ accept: "text/html,application/xhtml+xml", authorization: null, apiKey: null }), true);
  assert.equal(wantsModelsHtml({ accept: "application/json", authorization: null, apiKey: null }), false);
  assert.equal(wantsModelsHtml({ accept: "text/html", authorization: "Bearer vvvion-sk-x", apiKey: null }), false);
  assert.equal(wantsModelsHtml({ accept: "text/html", authorization: null, apiKey: "vvvion-sk-x" }), false);
});

test("JSON stays complete unless limit and after ask for a page", () => {
  const query = parseModelsQuery(new URLSearchParams("limit=1&after=deepseek-4.1-flash"));
  const page = sliceByCursor(models, query.limit, query.after);
  assert.deepEqual(page.data.map((model) => model.id), ["glm-5.3-flash"]);
  assert.equal(page.hasMore, true);
  assert.equal(sliceByCursor(models, null, "").data.length, 3);
  assert.equal(parseModelsQuery(new URLSearchParams("limit=0")).limit, null);
  assert.equal(parseModelsQuery(new URLSearchParams("limit=500")).limit, 100);
});

test("the catalog page loads the live JSON and does not bake model names in", () => {
  const html = renderModelsShell();
  assert.match(html, /https:\/\/api\.vvvion\.space\/v1\/models/);
  assert.match(html, /application\/json/);
  assert.doesNotMatch(html, /deepseek-4\.1-flash/);
  assert.doesNotMatch(html, /DeepSeek/);
  assert.equal(html.split("<script>").length, 2);
  const many = Array.from({ length: 13 }, (_, index) => ({
    id: `model-${index + 1}`,
    displayName: `Model ${index + 1}`,
    type: "chat" as const,
  }));
  const first = catalogWindow(many, 1, "all");
  const second = catalogWindow(many, 2, "all");
  assert.equal(first.items.length, 12);
  assert.equal(second.items.length, 1);
  assert.equal(second.pages, 2);
  assert.equal(second.items[0]?.id, "model-13");
});

test("public model JSON is parsed and the API host never opens the app", () => {
  assert.deepEqual(parsePublicModels({
    data: [
      { id: "deepseek-4.1-flash", display_name: "DeepSeek-4.1 Flash", type: "chat" },
      { id: "z-image", type: "image" },
      { id: "  ", display_name: "skip" },
    ],
  }), [
    { id: "deepseek-4.1-flash", displayName: "DeepSeek-4.1 Flash", type: "chat" },
    { id: "z-image", displayName: "z-image", type: "image" },
  ]);
  assert.equal(isApiHost("api.vvvion.space"), true);
  assert.equal(isApiHost("API.vvvion.space:443"), true);
  assert.equal(isApiHost("api.vvvion.space."), true);
  assert.equal(isApiHost("https://api.vvvion.space/v1/models"), true);
  assert.equal(isApiHost("vvvion.space"), false);
  assert.equal(hasApiHost(["vvvion-space.vercel.app", "api.vvvion.space"]), true);
  assert.equal(hasApiHost(["vvvion.space, api.vvvion.space"]), true);
  assert.equal(hasApiHost(["vvvion.space", "localhost"]), false);
  assert.equal(apiHostDecision("GET", "/"), "redirect");
  assert.equal(apiHostDecision("GET", "/login"), "redirect");
  assert.equal(apiHostDecision("GET", "/v1/models"), "pass");
  assert.equal(apiHostDecision("POST", "/v1/chat/completions"), "pass");
  assert.equal(apiHostDecision("POST", "/"), "missing");
});
