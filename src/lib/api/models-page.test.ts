import assert from "node:assert/strict";
import test from "node:test";
import { catalogWindow, parseModelsQuery, renderModelsPage, sliceByCursor, wantsModelsHtml } from "./models-page.ts";

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

test("the catalog page groups models, escapes names and paginates", () => {
  const html = renderModelsPage(models, 1, "all");
  assert.match(html, /deepseek-4\.1-flash/);
  assert.match(html, /glm-5\.3-flash/);
  assert.match(html, /z-image/);
  assert.match(html, new RegExp("Z-image " + "\u0026lt;script\u0026gt;"));
  assert.equal(html.split("<script>").length, 2);
  assert.doesNotMatch(html, /grok-4/);
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
  assert.match(renderModelsPage(many, 2, "chat"), /model-13/);
  assert.match(renderModelsPage(many, 1, "chat"), /page=2/);
});
