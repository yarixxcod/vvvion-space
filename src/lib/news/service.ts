import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { assertActive } from "@/lib/social/access";
import { cleanCountries, parseNews, parseRss, type NewsCode, type NewsItem } from "@/lib/news/parse";

const TTL = 5 * 60 * 1000;

const cache = new Map<string, { at: number; items: NewsItem[] }>();

const GOOGLE: Record<NewsCode, string> = {
  KZ: "https://news.google.com/rss/search?q=%D0%9A%D0%B0%D0%B7%D0%B0%D1%85%D1%81%D1%82%D0%B0%D0%BD+when:1d&hl=ru&gl=KZ&ceid=KZ:ru",
  RU: "https://news.google.com/rss/search?q=%D0%A0%D0%BE%D1%81%D1%81%D0%B8%D1%8F+when:1d&hl=ru&gl=RU&ceid=RU:ru",
  UZ: "https://news.google.com/rss/search?q=%D0%A3%D0%B7%D0%B1%D0%B5%D0%BA%D0%B8%D1%81%D1%82%D0%B0%D0%BD+when:1d&hl=ru&gl=UZ&ceid=UZ:ru",
  KG: "https://news.google.com/rss/search?q=%D0%9A%D1%8B%D1%80%D0%B3%D1%8B%D0%B7%D1%81%D1%82%D0%B0%D0%BD+when:1d&hl=ru&gl=KG&ceid=KG:ru",
  BY: "https://news.google.com/rss/search?q=%D0%91%D0%B5%D0%BB%D0%B0%D1%80%D1%83%D1%81%D1%8C+when:1d&hl=ru&gl=BY&ceid=BY:ru",
};

async function fetchFreeNews(countries: NewsCode[], token: string): Promise<NewsItem[]> {
  const url = `https://freenewsapi.ai/v1/search?country=${countries.join(",")}&lang=ru&date=today&size=20`;
  const response = await fetch(url, {
    headers: { accept: "application/json", authorization: `Bearer ${token}`, "user-agent": "vvvion.space" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error("Новости сейчас не отвечают");
  const text = await response.text();
  if (text.length > 1_500_000 || text.trim().startsWith("<")) throw new Error("Новости сейчас не отвечают");
  return parseNews(JSON.parse(text) as unknown);
}

async function fetchGoogle(countries: NewsCode[]): Promise<NewsItem[]> {
  const settled = await Promise.all(
    countries.map(async (country) => {
      const response = await fetch(GOOGLE[country], {
        headers: { accept: "application/rss+xml, application/xml, text/xml", "user-agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) return [] as NewsItem[];
      const xml = await response.text();
      if (!xml.includes("<item")) return [];
      return parseRss(xml, country).slice(0, 8);
    }),
  );
  const seen = new Set<string>();
  return settled
    .flat()
    .filter((item) => {
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    })
    .sort((a, b) => Date.parse(b.publishedAt || "") - Date.parse(a.publishedAt || ""))
    .slice(0, 24);
}

async function fetchNews(countries: NewsCode[]): Promise<NewsItem[]> {
  const key = countries.join(",");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.items;
  const token = (process.env.FREENEWS_API_KEY || "").trim();
  let items: NewsItem[] = [];
  if (token) {
    try {
      items = await fetchFreeNews(countries, token);
    } catch {
      items = [];
    }
  }
  if (!items.length) {
    try {
      items = await fetchGoogle(countries);
    } catch {
      if (hit) return hit.items;
      throw new Error("Новости сейчас не отвечают");
    }
  }
  if (!items.length) {
    if (hit) return hit.items;
    throw new Error("Новости сейчас не отвечают");
  }
  cache.set(key, { at: Date.now(), items });
  return items;
}

export const loadNews = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = input && typeof input === "object" ? (input as { countries?: unknown }).countries : input;
    const countries = cleanCountries(raw);
    if (!countries.length) throw new Error("Выберите страну");
    return { countries };
  })
  .handler(async ({ context, data }): Promise<NewsItem[]> => {
    await assertActive(context.userId);
    return fetchNews(data.countries);
  });
