import { tinyfishKey } from "@/lib/ai/tinyfish.server";
import { createSearchService, SearchFailure } from "@/lib/ai/search-service";
import { formatSearch, parseDuckHtml, sourceRow, type WebSource } from "@/lib/ai/search-rank";
import type { SearchProvider } from "@/lib/ai/search-types";
export type { WebSource };
export { formatSearch };
export { searchQuery } from "@/lib/ai/search-rank";
const AGENT = "VVVionSpace/3.0 (web search)";

async function bodyText(response: Response): Promise<string> {
  if (!response.ok && response.status !== 202)
    throw new SearchFailure(response.status === 429 ? "timeout" : "error");
  const reader = response.body?.getReader();
  if (!reader) throw new SearchFailure("error");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 900000) throw new SearchFailure("error");
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
function dateOf(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\d/.test(value)) return;
  const stamp = Date.parse(value);
  return Number.isFinite(stamp) ? new Date(stamp).toISOString() : undefined;
}
export function searchRegion(query: string): { language: "ru" | "en"; location?: "KZ" | "RU" } {
  const language = /[А-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі]/.test(query) ? "ru" : "en";
  if (/алмат|астан|казахстан|қазақстан|almaty|astana|kazakhstan/i.test(query))
    return { language, location: "KZ" };
  if (/росси|москв|петербург|russia|moscow/i.test(query)) return { language, location: "RU" };
  return { language };
}
async function fetchEngine(
  engine: SearchProvider,
  query: string,
  signal: AbortSignal,
): Promise<WebSource[]> {
  const region = searchRegion(query);
  if (engine === "duck") {
    const url = new URL("https://html.duckduckgo.com/html/");
    url.searchParams.set("q", query);
    url.searchParams.set("kl", region.location === "RU" ? "ru-ru" : "wt-wt");
    const response = await fetch(url, {
      headers: { accept: "text/html", "user-agent": AGENT },
      signal,
      redirect: "error",
    });
    const html = await bodyText(response);
    if (
      response.status === 202 ||
      /anomaly\.js|anomaly-modal|bots use DuckDuckGo|challenge-form/i.test(html)
    )
      throw new SearchFailure("blocked");
    return parseDuckHtml(html);
  }
  if (engine === "wikipedia") {
    const url = new URL(`https://${region.language}.wikipedia.org/w/api.php`);
    for (const [key, value] of Object.entries({
      action: "query",
      generator: "search",
      gsrsearch: query,
      gsrlimit: "4",
      prop: "extracts|info",
      inprop: "url",
      exintro: "1",
      explaintext: "1",
      exchars: "600",
      format: "json",
    }))
      url.searchParams.set(key, value);
    const response = await fetch(url, {
      headers: { accept: "application/json", "user-agent": AGENT },
      signal,
      redirect: "error",
    });
    const json = JSON.parse(await bodyText(response));
    return Object.values(json.query?.pages ?? {}).flatMap((page: unknown) => {
      const row = page as Record<string, unknown>;
      const hit = sourceRow(row.title, row.fullurl, row.extract);
      return hit ? [hit] : [];
    });
  }
  const url = new URL(
    engine === "tinyfish" ? "https://api.search.tinyfish.ai" : "https://freeserp.ai/api.php",
  );
  const headers: Record<string, string> = { accept: "application/json", "user-agent": AGENT };
  if (engine === "tinyfish") {
    const key = tinyfishKey();
    if (!key) throw new SearchFailure("unavailable");
    headers["x-api-key"] = key;
    url.searchParams.set("query", query);
    url.searchParams.set("language", region.language);
    if (region.location) url.searchParams.set("location", region.location);
  } else {
    url.searchParams.set("index", "web");
    url.searchParams.set("q", query);
    url.searchParams.set("size", "10");
  }
  const response = await fetch(url, { headers, signal, redirect: "error" });
  const json = JSON.parse(await bodyText(response));
  if (json.ok === false || !Array.isArray(json.results)) throw new SearchFailure("error");
  return json.results.flatMap((item: unknown) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const hit = sourceRow(row.title, row.url, row.snippet);
    return hit ? [{ ...hit, publishedAt: dateOf(row.published_at ?? row.publishedAt ?? row.publicationdate) }] : [];
  });
}
export const searchWeb = createSearchService(fetchEngine, {
  tinyfishReady: () => Boolean(tinyfishKey()),
});
