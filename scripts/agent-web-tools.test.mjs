import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync("src/lib/ai/agent-web.ts", "utf8").replace(/import[\s\S]*?from ["'][^"']+["'];\n/g, "");

function load() {
  const js = `const { publicFetch, searchWeb, isSearchEngine } = globalThis.__webToolsTest;\n${ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText}`;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}#${Math.random()}`);
}

test("page text drops scripts and fetch_url refuses private addresses", async () => {
  const calls = [];
  globalThis.__webToolsTest = {
    isSearchEngine: (value) => value === "duck",
    searchWeb: async (query) => {
      calls.push(query);
      return { sources: [{ title: "Цена", url: "https://example.com/p", snippet: "10", publishedAt: "2026-11-21" }] };
    },
    publicFetch: async (url) => {
      calls.push(url);
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "169.254.169.254") {
        throw new Error("Этот адрес недоступен");
      }
      return new Response("<html><script>secret()</script><nav>menu</nav><p>Цена 10</p></html>", { headers: { "content-type": "text/html" } });
    },
  };
  const { createWebTools, readablePage } = await load();
  const clean = readablePage("<html><script>secret()</script><p>Цена 10</p></html>", "text/html");
  assert.equal(clean.includes("secret"), false);
  assert.match(clean, /Цена 10/);
  const tools = createWebTools("duck", new AbortController().signal);
  assert.match(JSON.parse(await tools.invoke("fetch_url", { url: "http://127.0.0.1/secret" })).error, /недоступен/);
  assert.match(JSON.parse(await tools.invoke("fetch_url", { url: "https://169.254.169.254/meta" })).error, /недоступен/);
  const page = JSON.parse(await tools.invoke("fetch_url", { url: "https://example.com/price" }));
  assert.match(page.note, /данные/);
  assert.equal(page.text.includes("secret"), false);
  assert.match(page.text, /Цена 10/);
  const found = JSON.parse(await tools.invoke("web_search", { query: "цена кофе 2026" }));
  assert.equal(found.sources[0].url, "https://example.com/p");
  assert.match(found.note, /Недоверенные/);
  assert.equal(calls.includes("цена кофе 2026"), true);
});
