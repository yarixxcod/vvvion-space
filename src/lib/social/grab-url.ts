export type ClipHost = "youtube" | "instagram" | "tiktok" | "pinterest" | "vk";

export type InstagramTarget =
  | { kind: "post"; code: string }
  | { kind: "story"; user: string; id: string }
  | { kind: "stories"; user: string }
  | { kind: "highlight"; id: string };

const ALPH = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function clipHost(raw: string): ClipHost | null {
  let host = "";
  try {
    host = new URL(raw).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
  if (host === "youtu.be" || host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) return "youtube";
  if (host === "instagr.am" || host.endsWith("instagram.com")) return "instagram";
  if (host.endsWith("tiktok.com")) return "tiktok";
  if (host.endsWith("pinterest.com") || host === "pin.it" || host.endsWith("pinterest.ru")) return "pinterest";
  if (host.endsWith("vk.com") || host.endsWith("vk.ru") || host.endsWith("vkvideo.ru")) return "vk";
  return null;
}

function decodeShare(token: string): string {
  try {
    const pad = token.replace(/-/g, "+").replace(/_/g, "/");
    const extra = pad.length % 4 === 0 ? "" : "=".repeat(4 - (pad.length % 4));
    return Buffer.from(pad + extra, "base64").toString("utf8");
  } catch {
    return "";
  }
}

export function pkToCode(id: string): string {
  let n = 0n;
  try {
    n = BigInt((id.split("_")[0] || "").replace(/\D/g, "") || "0");
  } catch {
    return "";
  }
  if (n <= 0n) return "";
  let out = "";
  while (n > 0n) {
    out = ALPH[Number(n % 64n)] + out;
    n /= 64n;
  }
  return out;
}

export function codeToPk(code: string): string {
  let n = 0n;
  for (const ch of code) {
    const at = ALPH.indexOf(ch);
    if (at < 0) return "";
    n = n * 64n + BigInt(at);
  }
  return n.toString();
}

export function rewriteInstagram(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  if (host === "instagr.am" || host === "ig.me") url.hostname = "www.instagram.com";
  if (host === "l.instagram.com") {
    const next = url.searchParams.get("u");
    if (next?.startsWith("http")) return rewriteInstagram(next);
  }
  if (!url.hostname.replace(/^www\./, "").toLowerCase().endsWith("instagram.com") && url.hostname !== "www.instagram.com") return url.toString();
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] === "s" && parts[1]) {
    const text = decodeShare(parts[1]);
    const nested = /https?:\/\/\S+/.exec(text)?.[0];
    if (nested) return rewriteInstagram(nested);
    const highlight = /highlight:(\d{5,})/.exec(text);
    if (highlight?.[1]) return `https://www.instagram.com/stories/highlights/${highlight[1]}/`;
    const story = /stories\/([A-Za-z0-9._]{1,40})\/(\d{5,})/.exec(text);
    if (story?.[1] && story[2]) return `https://www.instagram.com/stories/${story[1]}/${story[2]}/`;
  }
  if (parts[0] === "share" && parts[1] === "stories" && parts[2]) {
    return `https://www.instagram.com/stories/${parts.slice(2).join("/")}/`;
  }
  if (parts[0] === "share" && parts[1] && parts[2] && /^(?:reel|reels|p|tv)$/i.test(parts[1])) {
    const kind = parts[1].toLowerCase() === "reels" ? "reel" : parts[1].toLowerCase();
    return `https://www.instagram.com/${kind}/${parts[2]}/`;
  }
  return url.toString();
}

export function instagramTarget(raw: string): InstagramTarget | null {
  let url: URL;
  try {
    url = new URL(rewriteInstagram(raw));
  } catch {
    return null;
  }
  if (!url.hostname.replace(/^www\./, "").toLowerCase().endsWith("instagram.com")) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  const storyQuery = (url.searchParams.get("story_media_id") || "").split("_")[0] || "";
  if (parts[0] === "stories" && parts[1] === "highlights" && /^\d{5,}$/.test(parts[2] || "")) return { kind: "highlight", id: parts[2] || "" };
  if (parts[0] === "stories" && parts[1] && parts[1] !== "highlights") {
    const user = parts[1].replace(/[^\w.]/g, "").slice(0, 40);
    if (!user) return null;
    const id = /^\d{5,}$/.test(parts[2] || "") ? parts[2] || "" : /^\d{5,}$/.test(storyQuery) ? storyQuery : "";
    if (id) return { kind: "story", user, id };
    return { kind: "stories", user };
  }
  const code = /\/(?:[\w.]+\/)?(?:share\/)?(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i.exec(url.pathname)?.[1];
  if (code) return { kind: "post", code };
  if (/^\d{5,}$/.test(storyQuery) && parts[0] && !["explore", "accounts", "share", "s"].includes(parts[0])) {
    return { kind: "story", user: parts[0].replace(/[^\w.]/g, "").slice(0, 40), id: storyQuery };
  }
  return null;
}
