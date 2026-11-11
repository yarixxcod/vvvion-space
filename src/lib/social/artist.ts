import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";

export type ArtistNote = {
  title: string;
  text: string;
  url: string;
};

type Page = { title?: string; extract?: string; fullurl?: string; missing?: string };

function cleanName(input: unknown): string {
  const raw = typeof input === "string" ? input : "";
  const name = raw.replace(/\s+/g, " ").trim().slice(0, 80);
  if (name.length < 2) throw new Error("Имя слишком короткое");
  return name;
}

const HOSTS = ["https://ru.ruwiki.ru/w/api.php", "https://ru.wikipedia.org/w/api.php"];
let hostAt = 0;

function sourceUrl(value: string | undefined): string {
  if (!value) return "";
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return "";
    if (parsed.hostname === "ru.ruwiki.ru" || parsed.hostname === "ru.wikipedia.org") return parsed.toString();
  } catch {
    return "";
  }
  return "";
}

async function readPages(base: string, params: Record<string, string>): Promise<Page[] | null> {
  const search = new URLSearchParams({ action: "query", format: "json", ...params });
  try {
    const res = await fetch(`${base}?${search}`, {
      headers: {
        accept: "application/json",
        "user-agent": "VVVionSpace/1.0 (https://vvvion.space; artist-note)",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { query?: { pages?: Record<string, Page> } };
    return Object.values(body.query?.pages ?? {});
  } catch {
    return null;
  }
}

async function pages(params: Record<string, string>): Promise<Page[]> {
  const order = HOSTS.slice(hostAt).concat(HOSTS.slice(0, hostAt));
  for (const base of order) {
    const found = await readPages(base, params);
    if (!found) continue;
    hostAt = Math.max(0, HOSTS.indexOf(base));
    return found;
  }
  throw new Error("Карточка сейчас не открылась");
}

function usable(page: Page | undefined): page is Page {
  return Boolean(page && page.extract && !page.missing);
}

function noteOf(page: Page, fallback: string): ArtistNote | null {
  const text = (page.extract || "").replace(/\s+/g, " ").trim().slice(0, 520);
  if (text.length < 40) return null;
  if (/может означать|другие значения/i.test(text) && text.length < 280) return null;
  const url = sourceUrl(page.fullurl);
  return { title: (page.title || fallback).slice(0, 120), text, url };
}

function best(list: Page[], name: string): ArtistNote | null {
  const key = name.toLocaleLowerCase("ru");
  const ranked = list.filter(usable).sort((a, b) => {
    const left = (a.title || "").toLocaleLowerCase("ru");
    const right = (b.title || "").toLocaleLowerCase("ru");
    const score = (title: string) => (title === key ? 0 : title.startsWith(key) ? 1 : title.includes(key) ? 2 : 3);
    return score(left) - score(right);
  });
  for (const page of ranked) {
    const note = noteOf(page, name);
    if (note) return note;
  }
  return null;
}

export const artistCard = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(cleanName)
  .handler(async ({ data }): Promise<ArtistNote> => {
    const titles = [data, `${data} (певец)`, `${data} (певица)`, `${data} (группа)`, `${data} (музыкант)`];
    for (const title of titles) {
      const found = best(await pages({
        titles: title,
        redirects: "1",
        prop: "extracts|info",
        exintro: "1",
        explaintext: "1",
        exchars: "520",
        inprop: "url",
      }), data);
      if (found) return found;
    }
    const searched = best(await pages({
      generator: "search",
      gsrsearch: data,
      gsrlimit: "3",
      gsrnamespace: "0",
      prop: "extracts|info",
      exintro: "1",
      explaintext: "1",
      exchars: "520",
      inprop: "url",
    }), data);
    return searched ?? { title: data, text: "", url: "" };
  });
