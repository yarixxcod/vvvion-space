import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
const require = createRequire(import.meta.url),
  cache = new Map();
function load(path) {
  path = resolve(path);
  if (cache.has(path)) return cache.get(path);
  const mod = { exports: {} };
  cache.set(path, mod.exports);
  const js = ts.transpileModule(readFileSync(path, "utf8") + (path.endsWith("/markdown.tsx") ? "\nexport {SettledMarkdown};" : ""), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const local = (id) => {
    if (id === "react-markdown") return { __esModule: true, default: ReactMarkdown };
    if (id === "remark-gfm") return { __esModule: true, default: remarkGfm };
    if (id.includes("/back-button")) return { BackButton: () => null };
    if (id.includes("/question-card")) return { QuestionCard: () => null };
    if (id === "@/lib/app-back") return { pushBackLayer: () => () => {} };
    if (id.startsWith("@/") || id.startsWith(".")) {
      const base = id.startsWith("@/") ? resolve("src", id.slice(2)) : resolve(dirname(path), id);
      const filename = [base, base + ".ts", base + ".tsx"].find((p) => existsSync(p));
      return load(filename);
    }
    return require(id);
  };
  new Function("require", "module", "exports", js)(local, mod, mod.exports);
  return mod.exports;
}
const { Markdown } = load("src/components/yaronetic/markdown.tsx");
const render = (text) => renderToStaticMarkup(React.createElement(Markdown, { text }));
test("all plain fences and single-line anonymous fences use a copyable card, inline code stays inline", () => {
  for (const language of ["plain", "text", "txt", "plaintext", "md", ""]) {
    const html = render("```" + language + "\n**literal**\n```");
    assert.match(html, /class="code-frame"/);
    assert.match(html, /Копировать/);
    assert.doesNotMatch(html, /<strong>/);
  }
  assert.doesNotMatch(render("A `literal` snippet"), /code-frame/);
  assert.match(render("```calc\n2+2\n```"), /4/);
});
test("GFM structure remains semantic and unsafe links/raw HTML cannot execute", () => {
  const html = render(
    "## Heading\n\n**bold**\n\n1. one\n2. two\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n[good](https://example.com) [bad](javascript:alert%281%29)\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>",
  );
  for (const tag of ["h2", "strong", "ol", "table"])
    assert.match(html, new RegExp("<" + tag + "[ >]"));
  assert.match(html, /rel="noreferrer noopener nofollow"/);
  assert.doesNotMatch(html, /<script|<img[^>]*onerror|href="javascript:|href="data:/);
});

test("real streaming renderer keeps completed prose and closes partial code fences", () => {
  const {SettledMarkdown}=load('src/components/yaronetic/markdown.tsx');
  const renderLive=text=>renderToStaticMarkup(React.createElement(SettledMarkdown,{text,live:true}));
  const prefix='## Finished heading\n\nCompleted paragraph\n\n';
  for(const tail of ['**bold','**bold*','```pla','```plain\n**literal**','```plain\n**literal**\n`']){
    const html=renderLive(prefix+tail);
    assert.match(html,/<h2>Finished heading<\/h2>/);
    assert.match(html,/<p>Completed paragraph<\/p>/);
    if(tail.startsWith('**')){assert.match(html,/<strong>bold<\/strong>/);assert.doesNotMatch(html,/\*\*/);}
    if(tail.includes('\n'))assert.match(html,/class="code-frame"/);
  }
  const table=renderLive('| A | B |\n| --- | --- |\n| 1 | 2 |');
  assert.match(table,/<table/);
});
