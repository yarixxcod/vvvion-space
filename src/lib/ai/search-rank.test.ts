import assert from "node:assert/strict";
import test from "node:test";
import { formatSearch, parseDuckHtml, rankSources, searchQuery } from "./search-rank.ts";

test("search query drops the greeting and keeps the question", () => {
  assert.equal(searchQuery("Привет! Найди, как зафайнтюнить llama 3?"), "как зафайнтюнить llama 3?");
});

test("ranking keeps the page that matches the question", () => {
  const ranked = rankSources("how to fine-tune llama 3", [
    { title: "Погода в Алматы", url: "https://example.com/weather", snippet: "Завтра без осадков." },
    { title: "Fine-Tuning Llama 3 Locally", url: "https://example.com/llama", snippet: "A step-by-step fine-tune guide." },
  ]);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]?.url, "https://example.com/llama");
});

test("duck html keeps the real link and the snippet", () => {
  const html = `
    <div class="result results_links web-result">
      <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fllama&rut=1">Fine-tune <b>Llama</b></a>
      <a class="result__snippet" href="https://example.com/llama">We&#x27;ll fine-tune Llama 3.</a>
    </div>`;
  const hits = parseDuckHtml(html);
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.url, "https://example.com/llama");
  assert.match(hits[0]?.title || "", /Llama/);
  assert.match(hits[0]?.snippet || "", /fine-tune Llama 3/);
});

test("the model is not told the engine name or to admit a miss", () => {
  const note = formatSearch([{ title: "Llama", url: "https://example.com/llama", snippet: "guide" }]);
  assert.doesNotMatch(note, /DuckDuckGo|TinyFish|FreeSERP|ничего не нашёл/i);
  assert.equal(formatSearch([]), "");
});
