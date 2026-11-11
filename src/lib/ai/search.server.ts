import { tinyfishKey } from "@/lib/ai/tinyfish.server";
import type { SearchEngine } from "@/lib/ai/search-engine";
import {
  formatSearch,
  keywordQuery,
  parseDuckHtml,
  rankSources,
  searchQuery,
  sourceRow,
  type WebSource,
} from "@/lib/ai/search-rank";

export type { WebSource };
export { formatSearch, searchQuery };

const AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

async function wiki(query: string, lang: "ru" | "en"): Promise<WebSource[]> {
  const url = new URL(`https://${lang}.wikipedia.org/w/api.php`);
  url.searchParams.set("action", "query");
  url.searchParams.set("generator", "search");
  url.searchParams.set("gsrsearch", query);
  url.searchParams.set("gsrlimit", "4");
  url.searchParams.set("prop", "extracts|info");
  url.searchParams.set("inprop", "url");
  url.searchParams.set("exintro", "1");
  url.searchParams.set("explaintext", "1");
  url.searchParams.set("exchars", "420");
  url.searchParams.set("format", "json");
  url.searchParams.set("utf8", "1");
  const res = await fetch(url, {
    headers: { accept: "application/json", "user-agent": AGENT },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { query?: { pages?: Record<string, Record<string, unknown>> } };
  const pages = json.query?.pages;
  if (!pages) return [];
  return Object.values(pages).flatMap((page) => {
    const hit = sourceRow(page.title, page.fullurl, page.extract);
    return hit ? [hit] : [];
  });
}

async function duckHtml(query: string): Promise<WebSource[]> {
  const cyr = /[А-Яа-яЁё]/.test(query);
  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set("q", query);
  url.searchParams.set("kl", cyr ? "ru-ru" : "wt-wt");
  const res = await fetch(url, {
    headers: {
      accept: "text/html",
      "user-agent": AGENT,
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok && res.status !== 202) return [];
  const html = await res.text();
  return parseDuckHtml(html);
}

async function duck(query: string): Promise<WebSource[]> {
  const raw = await duckHtml(query);
  const primary = rankSources(query, raw);
  if (primary.length >= 2 || raw.length === 0) return primary;
  const short = keywordQuery(query);
  if (!short || short === query.toLowerCase()) return primary;
  return rankSources(query, [...primary, ...(await duckHtml(short))]);
}

async function collect(engine: SearchEngine, query: string): Promise<WebSource[]> {
  if (engine === "tinyfish") return rankSources(query, await tinyfish(query));
  if (engine === "freeserp") return rankSources(query, await freeserp(query));
  return duck(query);
}

export async function searchWeb(query: string, engine: SearchEngine = "duck"): Promise<WebSource[]> {
  const q = searchQuery(query);
  if (q.length < 2) return [];
  const backups: SearchEngine[] =
    engine === "tinyfish" ? ["freeserp", "duck"] : engine === "freeserp" ? ["tinyfish", "duck"] : ["tinyfish", "freeserp"];
  let found: WebSource[] = [];
  try {
    found = await collect(engine, q);
  } catch {
    found = [];
  }
  for (const next of backups) {
    if (found.length >= 2) break;
    try {
      found = rankSources(q, [...found, ...(await collect(next, q))]);
    } catch {
      /* the next index can still answer */
    }
  }
  if (found.length) return found;
  try {
    return rankSources(q, await wiki(q, /[А-Яа-яЁё]/.test(q) ? "ru" : "en"));
  } catch {
    return [];
  }
}

async function tinyfish(query: string): Promise<WebSource[]> {
  const key = tinyfishKey();
  if (!key) return [];
  const cyr = /[А-Яа-яЁё]/.test(query);
  const url = new URL("https://api.search.tinyfish.ai");
  url.searchParams.set("query", query);
  url.searchParams.set("language", cyr ? "ru" : "en");
  url.searchParams.set("location", cyr ? "RU" : "US");
  const res = await fetch(url, {
    headers: { accept: "application/json", "user-agent": AGENT, "x-api-key": key },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { results?: unknown };
  const results = Array.isArray(json.results) ? json.results : [];
  return results.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const hit = sourceRow(
      (item as { title?: unknown }).title,
      (item as { url?: unknown }).url,
      (item as { snippet?: unknown }).snippet,
    );
    return hit ? [hit] : [];
  });
}

async function freeserp(query: string): Promise<WebSource[]> {
  const url = new URL("https://freeserp.ai/api.php");
  url.searchParams.set("index", "web");
  url.searchParams.set("q", query);
  url.searchParams.set("size", "8");
  const res = await fetch(url, {
    headers: { accept: "application/json", "user-agent": AGENT },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { ok?: unknown; results?: unknown };
  if (json.ok === false) return [];
  const results = Array.isArray(json.results) ? json.results : [];
  return results.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const hit = sourceRow(
      (item as { title?: unknown }).title,
      (item as { url?: unknown }).url,
      (item as { snippet?: unknown }).snippet,
    );
    return hit ? [hit] : [];
  });
}
