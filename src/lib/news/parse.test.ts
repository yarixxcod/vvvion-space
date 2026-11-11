import assert from "node:assert/strict";
import test from "node:test";
import { cleanCountries, parseNews, parseRss } from "./parse.ts";

test("keeps only the five countries, in a stable order", () => {
  assert.deepEqual(cleanCountries(["by", "xx", "KZ", "ru"]), ["KZ", "RU", "BY"]);
  assert.deepEqual(cleanCountries("uz,kg"), ["UZ", "KG"]);
  assert.deepEqual(cleanCountries(null), []);
});

test("keeps a safe article and drops a bad link", () => {
  const items = parseNews({
    results: [
      {
        id: "a1",
        url: "https://example.com/one",
        title: "  Заголовок  ",
        sitename: "Пример",
        country: "kz",
        published_at: "2026-10-31T02:00:00Z",
        description: "Коротко",
        image: "https://cdn.example.com/a.jpg",
      },
      { url: "javascript:alert(1)", title: "Плохо" },
      { url: "https://example.com/one", title: "Повтор" },
    ],
  });
  assert.equal(items.length, 1);
  assert.equal(items[0]?.title, "Заголовок");
  assert.equal(items[0]?.country, "KZ");
  assert.equal(items[0]?.image, "https://cdn.example.com/a.jpg");
});

test("rss keeps the headline and the source after the dash", () => {
  const items = parseRss(
    `<rss><channel><item><title>Пенсии вырастут - Forbes.ru</title><link>https://news.google.com/rss/articles/abc</link><pubDate>Mon, 02 Nov 2026 05:28:13 GMT</pubDate></item></channel></rss>`,
    "RU",
  );
  assert.equal(items.length, 1);
  assert.equal(items[0]?.title, "Пенсии вырастут");
  assert.equal(items[0]?.source, "Forbes.ru");
  assert.equal(items[0]?.country, "RU");
});
