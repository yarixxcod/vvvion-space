import { clipHost } from "./grab-url.ts";
export type GrabMode = "video" | "small" | "audio";
export function grabMode(value: unknown): GrabMode {
  return value === "small" || value === "audio" ? value : "video";
}

const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF\u00AD\u202A-\u202E]/g;

function openHttp(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.port) return null;
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.protocol = "https:";
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

function unwrapShare(url: URL): URL {
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const next = url.searchParams.get("q") || url.searchParams.get("u") || url.searchParams.get("url") || "";
  if (host === "l.instagram.com" && next.startsWith("http")) return openHttp(next) || url;
  if (host === "youtube.com" && (url.pathname === "/redirect" || url.pathname === "/attribution_link")) {
    if (next.startsWith("http")) return openHttp(next) || url;
    if (next.startsWith("/")) return openHttp(`https://www.youtube.com${next}`) || url;
  }
  return url;
}

function linkCandidates(text: string): string[] {
  const found = [...text.matchAll(/https?:\/\/[^\s<>"'`]+/gi)].map((hit) => hit[0].replace(/[).,!?;]+$/g, ""));
  const bare = /(?:^|\s)((?:(?:www|m|music|vm|vt)\.)?(?:youtu\.be|youtube\.com|youtube-nocookie\.com|instagram\.com|instagr\.am|ig\.me|tiktok\.com|pin\.it|pinterest\.(?:com|ru)|vk\.com|vk\.ru|vkvideo\.ru)\/[^\s<>"'`]+)/i.exec(text);
  if (bare?.[1]) found.push(`https://${bare[1].replace(/[).,!?;]+$/g, "")}`);
  return found;
}

export function youtubeId(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (clipHost(raw) !== "youtube") return null;
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    const parts = url.pathname.split("/").filter(Boolean);
    const fromPath = ["shorts", "embed", "live", "v"].includes(parts[0] || "")
      ? parts[1]
      : parts[0] === "watch"
        ? parts[1]
        : "";
    const id = host === "youtu.be" ? parts[0] : url.searchParams.get("v") || fromPath || "";
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}
export function normalizeGrabUrl(input: unknown): string {
  const text = typeof input === "string" ? input.replace(INVISIBLE, "").replace(/\u00A0/g, " ").trim() : "";
  if (text.length > 4000) throw new Error("Ссылка слишком длинная");
  let chosen: URL | null = null;
  for (const raw of linkCandidates(text)) {
    const url = openHttp(raw);
    if (!url) continue;
    const open = unwrapShare(unwrapShare(url));
    if (!clipHost(open.toString())) continue;
    chosen = open;
    break;
  }
  if (!chosen) throw new Error("Нужна ссылка из Instagram, YouTube, TikTok, Pinterest или VK");
  if (clipHost(chosen.toString()) === "youtube") {
    const id = youtubeId(chosen.toString());
    if (!id) throw new Error("Нужна ссылка на ролик или Shorts, а не на канал или плейлист");
    return `https://www.youtube.com/watch?v=${id}`;
  }
  const out = chosen.toString();
  if (out.length > 2000) throw new Error("Ссылка слишком длинная");
  return out;
}
export function youtubeFormat(mode: GrabMode): string {
  if (mode === "audio") return "ba[ext=m4a]/ba";
  const height = mode === "small" ? 360 : 720;
  // Single muxed format includes audio and works without an ffmpeg subprocess.
  return `b[ext=mp4][height<=${height}]/b[height<=${height}]/b[ext=mp4]/b`;
}