import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { readFileSync } from "node:fs";
function load(path, require = () => ({})) {
  const e = {};
  new Function(
    "exports",
    "require",
    ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
  )(e, require);
  return e;
}
const helpers = load("src/lib/api/model-public.ts");
const chats = [
  { name: "DeepSeek", display_name: "DeepSeek 4.1 Flash", api_key: "", created: 123 },
  { name: "Kimi", display_name: "Kimi", api_key: "key", created: 123 },
];
const links = [
  {
    model_name: "DeepSeek",
    model_id: "vendor/deepseek",
    api_key: "key-1",
    base_url: "https://first.example/v1",
  },
  {
    model_name: "DeepSeek",
    model_id: "deepseek-chat",
    api_key: "key-2",
    base_url: "https://second.example/v1",
  },
];
const catalog = load("src/lib/api/models.server.ts", (id) =>
  id.includes("model-public")
    ? helpers
    : {
        getSql: async () => async (strings) =>
          strings.join("").includes("catalog_models")
            ? chats
            : strings.join("").includes("catalog_providers")
              ? links
              : [],
      },
);
test("one public catalog model per chat choice, not one per upstream deployment", async () => {
  const models = await catalog.listApiModels();
  assert.deepEqual(
    models.map((m) => m.id),
    ["deepseek-4.1-flash", "kimi"],
  );
  assert.equal(models[0].catalog, "DeepSeek");
  assert.equal(models[0].displayName, "DeepSeek 4.1 Flash");
  assert.deepEqual(models[0].aliases, ["DeepSeek", "vendor/deepseek", "deepseek-chat"]);
  assert.equal(await catalog.resolveApiChatModel("deepseek-4.1-flash"), "DeepSeek");
  assert.equal(await catalog.resolveApiChatModel("DeepSeek"), "DeepSeek");
  assert.equal(await catalog.resolveApiChatModel("deepseek-chat"), "DeepSeek");
  assert.equal(await catalog.resolveApiChatModel("missing"), null);
});
test("API resolves a legacy name to its catalog before building the ordered provider chain", async () => {
  let loaded = "";
  const targets = [
    { model: "vendor/deepseek", url: "https://first.example" },
    { model: "deepseek-chat", url: "https://second.example" },
  ];
  const upstream = load("src/lib/api/upstream.server.ts", (id) =>
    id.includes("models.server")
      ? catalog
      : id.includes("proxy.server")
        ? {
            loadCatalog: async (name) => ((loaded = name), {}),
            builtinTargets: () => targets,
            callChat: () => {},
          }
        : {
            failoverChat: async (received) => {
              assert.equal(received, targets);
              return { ok: true, response: Response.json({ ok: true }) };
            },
          },
  );
  assert.equal(
    (
      await upstream.runUpstream(
        "deepseek-chat",
        { model: "deepseek-chat" },
        new AbortController().signal,
      )
    ).ok,
    true,
  );
  assert.equal(loaded, "DeepSeek");
});
