import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { readFileSync } from "node:fs";

function load(name) {
  const cache = {};
  function inner(file) {
    if (cache[file]) return cache[file];
    const output = ts.transpileModule(readFileSync(`src/lib/ai/${file}.ts`, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const exports = {};
    const req = (spec) => inner(spec.split("/").pop().replace(/\.(ts|js)$/, ""));
    new Function("exports", "require", output)(exports, req);
    cache[file] = exports;
    return exports;
  }
  return inner(name);
}

const { closeoutChatPayload, inspectChatWire } = load("chat-wire");
const tools = [
  { type: "function", function: { name: "web_search" } },
  { type: "function", function: { name: "fetch_url" } },
];
const page = "Цена и характеристики. ".repeat(700).slice(0, 12_000);
const same = "https://example.com/phone";

function call(id, name, args) {
  return { id, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

const searches = ["москва", "казань", "официал", "обзор"].map((query, index) =>
  call(`search-${index}`, "web_search", { query }),
);
const fetches = [
  call("fetch-1", "fetch_url", { url: same }),
  call("fetch-2", "fetch_url", { url: same }),
  call("fetch-3", "fetch_url", { url: "https://example.com/other" }),
];
const wire = [
  { role: "system", content: "Ты помощник. Отвечай по источникам." },
  { role: "user", content: "Сколько стоит телефон?" },
  { role: "assistant", content: null, tool_calls: searches },
  ...searches.map((item) => ({
    role: "tool",
    tool_call_id: item.id,
    content: JSON.stringify({ results: [{ title: item.id, url: same }] }),
  })),
  { role: "assistant", content: null, tool_calls: fetches },
  ...fetches.map((item) => ({
    role: "tool",
    tool_call_id: item.id,
    content: JSON.stringify({ url: JSON.parse(item.function.arguments).url, text: page }),
  })),
];

test("four searches and three fetches keep distinct tool ids, including one repeated url", () => {
  const ids = wire.filter((item) => item.role === "tool").map((item) => item.tool_call_id);
  assert.equal(ids.length, 7);
  assert.equal(new Set(ids).size, 7);
  const urls = fetches.map((item) => JSON.parse(item.function.arguments).url);
  assert.deepEqual(urls, [same, same, "https://example.com/other"]);
  const rawTokens = JSON.stringify(wire).length / 4;
  assert.ok(rawTokens < 32_000, rawTokens);
});

test("the old closeout without tools is rejected, the new one is a valid final answer", () => {
  const payload = {
    model: "DeepSeek-4.1 Flash",
    stream: true,
    vvReason: true,
    vvUser: "Сколько стоит телефон?",
    max_tokens: 8192,
  };
  const broken = {
    ...payload,
    messages: wire.map((item) => (item.role === "assistant" ? { ...item, content: "" } : item)),
  };
  assert.deepEqual(inspectChatWire(broken).sort(), ["empty_assistant_content", "tools_missing"]);
  const thinking = { ...broken, tools, thinking: { type: "enabled" }, reasoning_effort: "high" };
  assert.ok(inspectChatWire(thinking).includes("missing_reasoning_content"));
  assert.ok(!inspectChatWire(thinking).includes("tools_missing"));

  const next = closeoutChatPayload(payload, wire, "DeepSeek-4.1 Flash", tools);
  assert.deepEqual(inspectChatWire(next), []);
  assert.equal(next.tool_choice, "none");
  assert.equal(next.stream, true);
  assert.deepEqual(next.thinking, { type: "disabled" });
  assert.equal("vvReason" in next, false);
  assert.equal("vvUser" in next, false);
  assert.equal(next.tools, tools);
  assert.ok(next.messages.filter((item) => item.role === "assistant").every((item) => item.content === null));
});

test("a plain chat without tools is not flagged", () => {
  assert.deepEqual(inspectChatWire({ stream: true, messages: [{ role: "user", content: "привет" }] }), []);
});
