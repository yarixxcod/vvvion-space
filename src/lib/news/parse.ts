export const NEWS_COUNTRIES = ["KZ", "RU", "UZ", "KG", "BY"] as const;

export type NewsCode = (typeof NEWS_COUNTRIES)[number];

export type NewsItem = {
  id: string;
  title: string;
  url: string;
  source: string;
  country: NewsCode | "";
  publishedAt: string;
  image: string | null;
  description: string | null;
};

const CODES = new Set<string>(NEWS_COUNTRIES);

export function cleanCountries(value: unknown): NewsCode[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const picked = new Set<NewsCode>();
  for (const item of raw) {
    const code = String(item).trim().toUpperCase();
    if (CODES.has(code)) picked.add(code as NewsCode);
  }
  return NEWS_COUNTRIES.filter((code) => picked.has(code));
}

function pageUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 8 || value.length > 2000) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function imageUrl(value: unknown): string | null {
  const raw =
    typeof value === "string"
      ? value
      : value && typeof value === "object" && typeof (value as { url?: unknown }).url === "string"
        ? (value as { url: string }).url
        : "";
  if (!raw.startsWith("https://") || raw.length > 500) return null;
  return raw;
}

function clip(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function parseNews(payload: unknown): NewsItem[] {
  const results = payload && typeof payload === "object" ? (payload as { results?: unknown }).results : null;
  if (!Array.isArray(results)) return [];
  const items: NewsItem[] = [];
  const seen = new Set<string>();
  for (const row of results) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const url = pageUrl(item.url);
    const title = clip(item.title, 220);
    if (!url || title.length < 2 || seen.has(url)) continue;
    seen.add(url);
    const country = typeof item.country === "string" && CODES.has(item.country.toUpperCase()) ? (item.country.toUpperCase() as NewsCode) : "";
    const published = typeof item.published_at === "string" && !Number.isNaN(Date.parse(item.published_at)) ? item.published_at : "";
    const description = clip(item.description, 240);
    const id = clip(item.id, 64) || url;
    items.push({
      id,
      title,
      url,
      source: clip(item.sitename, 80) || clip(item.host, 80) || "Источник",
      country,
      publishedAt: published,
      image: imageUrl(item.image),
      description: description || null,
    });
    if (items.length >= 20) break;
  }
  return items;
}

function xmlText(block: string, tag: string): string {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(block);
  if (!match) return "";
  return match[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&/g, "&")
    .replace(/"/g, '"')
    .replace(/&#39;|'/g, "'")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Google News RSS items. The headline is "title - source". */
export function parseRss(xml: string, country: NewsCode): NewsItem[] {
  const items: NewsItem[] = [];
  const seen = new Set<string>();
  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const block = match[1] || "";
    const rawTitle = xmlText(block, "title");
    const url = pageUrl(xmlText(block, "link"));
    if (!rawTitle || !url || seen.has(url)) continue;
    seen.add(url);
    const split = rawTitle.lastIndexOf(" - ");
    const title = (split > 0 ? rawTitle.slice(0, split) : rawTitle).trim();
    const source = split > 0 ? rawTitle.slice(split + 3).trim() : "Новости";
    const published = xmlText(block, "pubDate");
    const publishedAt = published && !Number.isNaN(Date.parse(published)) ? new Date(published).toISOString() : "";
    if (title.length < 2) continue;
    items.push({
      id: xmlText(block, "guid") || url,
      title: title.slice(0, 220),
      url,
      source: source.slice(0, 80) || "Новости",
      country,
      publishedAt,
      image: null,
      description: null,
    });
  }
  return items;
}
