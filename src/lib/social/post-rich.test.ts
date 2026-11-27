import assert from "node:assert/strict";
import test from "node:test";
import { postLooksRich, preparePostSource, renderPostHtml, sanitizePostHtml } from "./post-rich.ts";

test("plain posts stay plain and keep line breaks", () => {
  const source = "Привет\nмир";
  assert.equal(postLooksRich(source), false);
  assert.equal(preparePostSource(source).text, source);
});

test("markdown renders headings, lists, tables, quotes, code, links and strike", () => {
  const html = renderPostHtml(
    [
      "# Заголовок",
      "",
      "- пункт",
      "",
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "> цитата",
      "",
      "~~нет~~",
      "",
      "`код`",
      "",
      "[сайт](https://example.com)",
    ].join("\n"),
  );
  assert.match(html, /<h1>Заголовок<\/h1>/);
  assert.match(html, /<li>пункт<\/li>/);
  assert.match(html, /<table>/);
  assert.match(html, /<blockquote>/);
  assert.match(html, /<code>код<\/code>/);
  assert.match(html, /<s>нет<\/s>|<del>нет<\/del>/);
  assert.match(html, /href="https:\/\/example.com"/);
  assert.match(html, /rel="noopener noreferrer nofollow"/);
  assert.match(html, /target="_blank"/);
});

test("task lists do not emit inputs", () => {
  const html = renderPostHtml("- [x] готово\n- [ ] позже");
  assert.equal(html.includes("<input"), false);
  assert.match(html, /☑/);
  assert.match(html, /☐/);
});

test("xss vectors are removed", () => {
  const dirty = [
    `<script>alert(1)</script>`,
    `<img src=x onerror="alert(1)">`,
    `<a href="javascript:alert(1)">x</a>`,
    `<div style="background:url(https://evil.test/a.png);color:red">z</div>`,
    `<div style="position:fixed;z-index:9999">z</div>`,
    `<svg><script>alert(1)</script><rect onload="alert(1)"></rect></svg>`,
    `<img src="data:image/svg+xml,<svg>" alt="d">`,
    `<img src="https://cdn.example/a.png" onerror="alert(1)">`,
  ].join("\n");
  const html = renderPostHtml(dirty);
  const stored = preparePostSource(dirty).text;
  for (const value of [html, stored]) {
    assert.equal(/<script/i.test(value), false, value);
    assert.equal(/onerror/i.test(value), false, value);
    assert.equal(/onload/i.test(value), false, value);
    assert.equal(/javascript:/i.test(value), false, value);
    assert.equal(/url\s*\(/i.test(value), false, value);
    assert.equal(/position\s*:/i.test(value), false, value);
    assert.equal(/z-index/i.test(value), false, value);
    assert.equal(/data:/i.test(value), false, value);
    assert.equal(/<svg/i.test(value), false, value);
    assert.equal(/<input/i.test(value), false, value);
  }
  assert.match(html, /https:\/\/cdn\.example\/a\.png/);
  assert.match(html, /loading="lazy"/);
  assert.match(html, /color:\s*red/);
});

test("overlay classes and javascript markdown links are removed", () => {
  const stored = preparePostSource(
    '<div class="fixed z-50 card">ok</div>\n[x](javascript:alert(1))',
  ).text;
  assert.equal(/\bfixed\b/.test(stored), false);
  assert.equal(/z-50/.test(stored), false);
  assert.match(stored, /class="card"/);
  assert.equal(/javascript:/i.test(stored), false);
  assert.match(stored, /<div class="card">ok<\/div>\nx$/);
});
test("source longer than 20000 characters is rejected", () => {
  const result = preparePostSource("а".repeat(20_001));
  assert.equal(result.text, "");
  assert.equal(result.error, "Не больше 20000 символов");
});

test("allowed html layout survives a second sanitize", () => {
  const source = `<div class="card" style="display:flex;gap:8px;background:linear-gradient(120deg,#6d5bd0,#111);border-radius:16px;padding:12px"><h2>Ночь</h2><p>Текст</p></div>`;
  assert.equal(postLooksRich(source), true);
  const html = renderPostHtml(sanitizePostHtml(source));
  assert.match(html, /display:\s*flex/);
  assert.match(html, /linear-gradient/);
  assert.match(html, /<h2>Ночь<\/h2>/);
});
