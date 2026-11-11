export type WebSource = {
  title: string;
  url: string;
  snippet: string;
};

const STOPS = new Set(
  `a an the and or of to for in on at by from with as is are was were be this that it its you your we they i me my not no yes how what who when where why which can could would should please just
и в во на с со к ко о об от до по за из у а но или да не ни же ли бы то это эта эти тот та те как что кто где когда чем чему для при про без над под уже ещё еще мне мой моя мои вас вам нас нам тебя тебе себя свой своей своем свою своих своим своего своя свое свои если можно нужно надо скажи найди поищи`
    .split(/\s+/)
    .filter(Boolean),
);

function clean(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

export function decodeHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num: string) => String.fromCodePoint(Number(num)))
    .replace(/&nbsp;/g, " ")
    .replace(/&/g, "&")
    .replace(/"/g, '"')
    .replace(/&#39;|'/g, "'")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function httpUrl(value: unknown): string {
  const raw = clean(value, 500);
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (url.hostname === "duckduckgo.com" || url.hostname.endsWith(".duckduckgo.com")) {
      const wrapped = url.searchParams.get("uddg");
      if (wrapped) return httpUrl(wrapped);
      if (url.pathname === "/l/" || url.pathname === "/l") return "";
    }
    return url.toString();
  } catch {
    return "";
  }
}

export function sourceRow(title: unknown, url: unknown, snippet: unknown): WebSource | null {
  const link = httpUrl(url);
  const name = clean(title, 180) || link;
  const text = clean(snippet, 480);
  if (!link || !name) return null;
  return { title: name, url: link, snippet: text };
}

const LEAD =
  /^(?:привет|здравствуй(?:те)?|добрый\s+(?:день|вечер|утро)|пожалуйста|будь\s+добр(?:а|ы)?|можешь(?:\s+ли)?(?:\s+ты)?|не\s+мог(?:ла)?\s+бы(?:\s+ты)?|скажи(?:те)?(?:\s+мне)?|расскажи(?:те)?(?:\s+мне)?|объясни(?:те)?(?:\s+мне)?|подскажи(?:те)?|найди(?:те)?(?:\s+в\s+(?:сети|интернете))?|поищи(?:те)?|погугли(?:те)?|загугли(?:те)?|узнай(?:те)?|search(?:\s+for)?|look\s+up|google|please|can\s+you|could\s+you|tell\s+me|i\s+need|help\s+me)(?=$|[\s,!.:—-])[\s,!.:—-]*/iu;

function stripLead(text: string): string {
  let next = text.trim();
  for (let i = 0; i < 4; i += 1) {
    const stripped = next.replace(LEAD, "").trim();
    if (stripped === next || stripped.length < 2) break;
    next = stripped;
  }
  return next.replace(/^[«"']+|[»"']+$/g, "").trim();
}

/** Turn a chat line into a search query. Politeness and greetings are not the topic. */
export function searchQuery(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return "";
  const parts = flat.split(/(?<=[?!.])\s+/).map((part) => part.trim()).filter(Boolean);
  const asked = parts.find((part) => part.includes("?") && part.length <= 200) || parts.find((part) => part.length <= 200) || parts[0] || flat;
  return stripLead(asked).replace(/\s+/g, " ").trim().slice(0, 160);
}

export function queryTokens(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.toLowerCase().replace(/ё/g, "е").split(/[^a-z0-9а-я]+/i)) {
    if (raw.length < 3 || STOPS.has(raw) || seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
  }
  return out;
}

function related(word: string, token: string): boolean {
  if (word.includes(token) || token.includes(word)) return true;
  const size = Math.min(5, word.length, token.length);
  return size >= 4 && word.slice(0, size) === token.slice(0, size);
}

function hitScore(tokens: string[], phrase: string, item: WebSource): { score: number; hits: number } {
  const title = queryTokens(item.title);
  const snippet = queryTokens(item.snippet);
  const host = item.url.toLowerCase();
  let score = 0;
  let hits = 0;
  for (const token of tokens) {
    const inTitle = title.some((word) => related(word, token));
    const inSnippet = snippet.some((word) => related(word, token));
    const inHost = host.includes(token);
    if (inTitle || inSnippet || inHost) hits += 1;
    if (inTitle) score += 5;
    else if (inSnippet) score += 2;
    else if (inHost) score += 2;
  }
  const head = phrase.toLowerCase().slice(0, 48);
  if (head.length >= 8 && item.title.toLowerCase().includes(head)) score += 6;
  return { score, hits };
}

export function rankSources(query: string, items: WebSource[], limit = 5): WebSource[] {
  const seen = new Set<string>();
  const unique: WebSource[] = [];
  for (const item of items) {
    const key = item.url.replace(/\/$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  const tokens = queryTokens(query);
  if (!tokens.length) return unique.slice(0, limit);
  const need = tokens.length >= 2 ? 2 : 1;
  return unique
    .map((item) => ({ item, ...hitScore(tokens, query, item) }))
    .filter((row) => row.score > 0 && row.hits >= need)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((row) => row.item);
}

export function keywordQuery(query: string): string {
  return queryTokens(query).slice(0, 8).join(" ");
}

export function parseDuckHtml(html: string): WebSource[] {
  const out: WebSource[] = [];
  const chunks = html.split(/class="result results_links/i).slice(1);
  for (const chunk of chunks) {
    const title = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(chunk);
    if (!title) continue;
    const snippet = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i.exec(chunk);
    const hit = sourceRow(decodeHtml(title[2] || ""), decodeHtml(title[1] || ""), snippet ? decodeHtml(snippet[1] || "") : "");
    if (hit) out.push(hit);
  }
  return out;
}

/** Context for the model. Never names a search engine and never asks it to announce a miss. */
export function formatSearch(sources: WebSource[]): string {
  if (!sources.length) return "";
  const lines = sources.map(
    (source, index) => `[${index + 1}] ${source.title}\n${source.url}\n${source.snippet || ""}`,
  );
  return [
    "Ниже страницы из сети по вопросу пользователя. Ответь по существу, как обычно, на языке пользователя.",
    "Факт, который берёшь отсюда, подтверждай обычной markdown-ссылкой на страницу.",
    "Не называй способ, которым страницы нашлись, и не комментируй сам факт просмотра сети.",
    "Если страница не про вопрос — не используй её и ответь из своих знаний, без оговорок.",
    "",
    ...lines,
  ].join("\n");
}
