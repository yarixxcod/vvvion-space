import { createServerFn } from "@tanstack/react-start";
import { setResponseStatus } from "@tanstack/react-start/server";
import { authMiddleware } from "@/lib/auth/middleware";
import { assertActive } from "@/lib/social/access";
import { storeMegaBytes } from "@/lib/social/mega";
import { clipHost, instagramTarget, pkToCode, rewriteInstagram, type ClipHost, type InstagramTarget } from "./grab-url.ts";

export { clipHost, instagramTarget, pkToCode, rewriteInstagram };
export type { ClipHost, InstagramTarget };

const MAX = 40 * 1024 * 1024;
const TTL = 300;
const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

export type Grabbed = { id: string; name: string; bytes: number; mime: string };
export type GrabTick = { phase: "open" | "fetch" | "save"; pct: number; loaded: number; total: number };

function clipFail(status: number, message: string): never {
  try {
    setResponseStatus(status);
  } catch {
    /* the message still reaches the client */
  }
  throw new Error(message);
}

function logGrab(host: string, status: number, detail: string) {
  const clean = detail.replace(/Bearer\s+\S+/gi, "Bearer •••").replace(/\s+/g, " ").trim().slice(0, 240);
  console.error("[grab]", host, status, clean);
}

function cleanUrl(input: unknown): string {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!/^https:\/\/\S{8,500}$/i.test(raw)) clipFail(400, "Нужна ссылка");
  if (!clipHost(raw)) clipFail(400, "Нужна ссылка из Instagram, YouTube, TikTok, Pinterest или VK");
  return raw;
}

function unescapeUrl(value: string): string {
  return value
    .replace(/\\u0026/gi, "&")
    .replace(/\\u002f/gi, "/")
    .replace(/\\u003d/gi, "=")
    .replace(/\\\//g, "/")
    .replace(/&/g, "&");
}

function youtubeId(raw: string): string | null {
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, "");
    if (host === "youtu.be") return url.pathname.split("/").filter(Boolean)[0]?.slice(0, 11) || null;
    const fromQuery = url.searchParams.get("v");
    if (fromQuery && /^[A-Za-z0-9_-]{11}$/.test(fromQuery)) return fromQuery;
    const parts = url.pathname.split("/").filter(Boolean);
    const at = parts.findIndex((part) => part === "shorts" || part === "embed" || part === "live");
    const id = at >= 0 ? parts[at + 1] : "";
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

type YtFormat = { url?: string; mimeType?: string; height?: number };
type YtPlayer = { playabilityStatus?: { status?: string; reason?: string }; videoDetails?: { title?: string }; streamingData?: { formats?: YtFormat[] } };

function pickVideo(formats: YtFormat[] | undefined): string | null {
  const ready = (formats ?? []).filter((item) => item.url?.startsWith("http"));
  ready.sort((a, b) => (b.height || 0) - (a.height || 0));
  const picked = ready.find((item) => (item.mimeType || "").includes("mp4")) || ready[0];
  return picked?.url ?? null;
}

function playerOf(data: YtPlayer | null): { url: string; title: string } | null {
  const url = pickVideo(data?.streamingData?.formats);
  if (!url) return null;
  return { url, title: data?.videoDetails?.title || "Ролик" };
}

function jsonAfter(html: string, marker: string): unknown | null {
  const at = html.indexOf(marker);
  if (at < 0) return null;
  const start = html.indexOf("{", at);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  const end = Math.min(html.length, start + 1_800_000);
  for (let i = start; i < end; i++) {
    const ch = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

async function youtube(raw: string): Promise<{ url: string; title: string; referer: string }> {
  const id = youtubeId(raw);
  if (!id) clipFail(400, "Ссылка на YouTube не разобралась");
  const clients = [
    {
      clientName: "IOS",
      clientVersion: "19.45.4",
      deviceMake: "Apple",
      deviceModel: "iPhone16,2",
      hl: "en",
      gl: "US",
      osName: "iPhone",
      osVersion: "18.1.0.22B83",
      userAgent: "com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1 like Mac OS X)",
    },
    {
      clientName: "ANDROID_VR",
      clientVersion: "1.60.19",
      deviceMake: "Oculus",
      deviceModel: "Quest 3",
      androidSdkVersion: 32,
      osName: "Android",
      osVersion: "12L",
      hl: "en",
      gl: "US",
      userAgent: "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; Quest 3) gzip",
    },
    {
      clientName: "ANDROID",
      clientVersion: "19.44.38",
      androidSdkVersion: 30,
      hl: "en",
      gl: "US",
      userAgent: "com.google.android.youtube/19.44.38 (Linux; U; Android 11) gzip",
    },
    {
      clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
      clientVersion: "2.0",
      hl: "en",
      gl: "US",
    },
  ];
  let title = "Ролик";
  let blocked = "";
  for (const client of clients) {
    const ua = "userAgent" in client && client.userAgent ? client.userAgent : DESKTOP;
    const res = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": ua,
        origin: "https://www.youtube.com",
        referer: "https://www.youtube.com/",
      },
      body: JSON.stringify({
        videoId: id,
        context: { client },
        contentCheckOk: true,
        racyCheckOk: true,
      }),
      signal: AbortSignal.timeout(12000),
    });
    const rawBody = await res.text();
    let data: YtPlayer | null = null;
    try {
      data = JSON.parse(rawBody) as YtPlayer;
    } catch {
      data = null;
    }
    const status = data?.playabilityStatus?.status || "";
    const reason = data?.playabilityStatus?.reason || "";
    logGrab("youtube", res.status, `${client.clientName} ${status} ${reason}`.trim());
    if (status === "LOGIN_REQUIRED" || /not a bot|робот/i.test(reason)) blocked = reason || status;
    if (!res.ok || !data) continue;
    if (data.videoDetails?.title) title = data.videoDetails.title;
    const found = playerOf(data);
    if (found) return { url: found.url, title: found.title || title, referer: "https://www.youtube.com/" };
  }
  try {
    const { html } = await pageText(`https://www.youtube.com/watch?v=${id}&hl=en`);
    const embedded = playerOf(jsonAfter(html, "ytInitialPlayerResponse") as YtPlayer | null);
    if (embedded) return { url: embedded.url, title: embedded.title, referer: "https://www.youtube.com/" };
  } catch (error) {
    logGrab("youtube", 0, error instanceof Error ? error.message : "page");
  }
  if (blocked) clipFail(502, "Площадка не отдала ролик: просит проверку, что это не робот");
  clipFail(502, "По этой ссылке ролик не открылся");
}

async function pageText(url: string, ua = DESKTOP): Promise<{ html: string; finalUrl: string }> {
  const res = await fetch(url, {
    headers: { "user-agent": ua, accept: "text/html,application/xhtml+xml", "accept-language": "ru,en" },
    redirect: "follow",
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) {
    logGrab("page", res.status, url);
    throw new Error("Страница не открылась");
  }
  return { html: await res.text(), finalUrl: res.url || url };
}

function firstUrl(html: string, patterns: RegExp[]): string | null {
  const decoded = unescapeUrl(html);
  for (const pattern of patterns) {
    const hit = pattern.exec(decoded);
    if (hit?.[1]?.startsWith("http")) return hit[1];
    if (hit?.[0]?.startsWith("http")) return hit[0];
  }
  return null;
}

async function instagram(raw: string): Promise<{ url: string; title: string; referer: string }[]> {
  const target = instagramTarget(raw);
  if (!target) {
    const parts = (() => {
      try {
        return new URL(raw).pathname.split("/").filter(Boolean);
      } catch {
        return [];
      }
    })();
    if (parts.length === 1 && !["p", "reel", "reels", "tv", "stories", "explore", "share", "s", "accounts"].includes(parts[0] || "")) {
      clipFail(400, "Это профиль. Нужна ссылка на сторис, пост или ролик");
    }
    clipFail(400, "Ссылка на Instagram не разобралась");
  }
  const referer = "https://www.instagram.com/";
  const label = target.kind === "post" ? "Фото" : "Сторис";
  if (target.kind === "post") {
    const pages = [
      `https://www.instagram.com/reel/${target.code}/embed/`,
      `https://www.instagram.com/p/${target.code}/embed/captioned/`,
      `https://www.instagram.com/p/${target.code}/embed/`,
    ];
    for (const page of pages) {
      try {
        const { html } = await pageText(page, PHONE);
        const found = mediaFromHtml(html);
        if (!found.length) continue;
        const title = /<title>([^<]+)<\/title>/i.exec(html)?.[1]?.replace(/\s+•\s+Instagram.*/i, "").trim() || label;
        return found.map((url, index) => ({ url, title: found.length > 1 ? `${title} ${index + 1}` : title, referer }));
      } catch {
        /* try the next page */
      }
    }
  }
  const fromApi = await instagramApi(target);
  if (fromApi.urls.length) {
    return fromApi.urls.map((url, index) => ({ url, title: fromApi.urls.length > 1 ? `${label} ${index + 1}` : label, referer }));
  }
  if (target.kind === "story" || target.kind === "stories" || target.kind === "highlight") {
    clipFail(
      fromApi.missing ? 502 : 503,
      fromApi.missing
        ? "Сторис уже нет или она закрыта"
        : "Instagram не отдал сторис. Ссылка может быть живой — попробуйте ещё раз через минуту",
    );
  }
  clipFail(502, "По этой ссылке ничего не нашлось");
}

type IgItem = {
  video_versions?: { url?: string }[];
  image_versions2?: { candidates?: { url?: string; width?: number }[] };
  carousel_media?: IgItem[];
  items?: IgItem[];
};

function mediaFromHtml(html: string): string[] {
  const decoded = unescapeUrl(html);
  const videos: string[] = [];
  const images: string[] = [];
  const take = (bucket: string[], value: string | undefined) => {
    if (!value?.startsWith("http") || bucket.includes(value)) return;
    if (/profile_pic|s150x150|s320x320|s44x44/.test(value)) return;
    bucket.push(value);
  };
  for (const hit of decoded.matchAll(/"video_url":"(https:[^"]+)"/g)) take(videos, hit[1]);
  for (const hit of decoded.matchAll(/property="og:video(?::secure_url)?" content="(https:[^"]+)"/g)) take(videos, hit[1]);
  for (const hit of decoded.matchAll(/<video[^>]+src="(https:[^"]+)"/g)) take(videos, hit[1]);
  for (const hit of decoded.matchAll(/(https:\/\/[^"'\\\s]*cdninstagram\.com[^"'\\\s]+\.mp4[^"'\\\s]*)/g)) take(videos, hit[1]);
  for (const hit of decoded.matchAll(/"display_url":"(https:[^"]+)"/g)) take(images, hit[1]);
  for (const hit of decoded.matchAll(/"display_src":"(https:[^"]+)"/g)) take(images, hit[1]);
  for (const hit of decoded.matchAll(/property="og:image" content="(https:[^"]+)"/g)) take(images, hit[1]);
  for (const hit of decoded.matchAll(/<img[^>]+src="(https:\/\/[^"]*cdninstagram\.com[^"]+)"/g)) take(images, hit[1]);
  return [...videos, ...images.filter((url) => !videos.includes(url))].slice(0, 8);
}

function urlsOfItem(item: IgItem): string[] {
  if (item.carousel_media?.length) return item.carousel_media.flatMap(urlsOfItem);
  if (item.items?.length) return item.items.flatMap(urlsOfItem);
  const video = item.video_versions?.find((row) => row.url?.startsWith("http"))?.url;
  if (video) return [video];
  const images = [...(item.image_versions2?.candidates ?? [])].filter((row) => row.url?.startsWith("http"));
  images.sort((a, b) => (b.width || 0) - (a.width || 0));
  return images[0]?.url ? [images[0].url] : [];
}

function itemsOf(data: unknown): string[] {
  if (!data || typeof data !== "object") return [];
  const raw = data as { items?: IgItem[]; reels?: Record<string, IgItem>; reels_media?: IgItem[] };
  const items: IgItem[] = [];
  if (Array.isArray(raw.items)) items.push(...raw.items);
  if (Array.isArray(raw.reels_media)) items.push(...raw.reels_media);
  if (raw.reels && typeof raw.reels === "object") items.push(...Object.values(raw.reels));
  const urls = items.flatMap(urlsOfItem).filter((url, index, all) => all.indexOf(url) === index);
  return urls.slice(0, 8);
}

async function igGet(url: string): Promise<{ status: number; data: unknown | null }> {
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": DESKTOP,
        accept: "*/*",
        "x-ig-app-id": "936619743392459",
        "x-asbd-id": "359341",
        "x-ig-www-claim": "0",
        origin: "https://www.instagram.com",
        referer: "https://www.instagram.com/",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(12000),
    });
    logGrab("instagram", res.status, url.slice(0, 140));
    if (res.status >= 300 && res.status < 400) return { status: 401, data: null };
    if (!res.ok) return { status: res.status, data: null };
    const data = await res.json().catch(() => null);
    if (!data || typeof data !== "object") return { status: 401, data: null };
    return { status: 200, data };
  } catch {
    return { status: 0, data: null };
  }
}

function apiHosts(path: string) {
  return [`https://www.instagram.com/api/v1${path}`, `https://i.instagram.com/api/v1${path}`];
}

function looksLikeMedia(data: unknown) {
  if (!data || typeof data !== "object") return false;
  const raw = data as Record<string, unknown>;
  if (Array.isArray(raw.items) || Array.isArray(raw.reels_media)) return true;
  if (raw.reels && typeof raw.reels === "object") return true;
  return "image_versions2" in raw || "video_versions" in raw || "carousel_media" in raw;
}

async function firstMedia(paths: string[]): Promise<{ urls: string[]; missing: boolean }> {
  let sawOk = false;
  let sawBlock = false;
  for (const path of paths) {
    for (const url of apiHosts(path)) {
      const hit = await igGet(url);
      const urls = itemsOf(hit.data);
      if (urls.length) return { urls, missing: false };
      if (hit.status === 200 && looksLikeMedia(hit.data)) {
        sawOk = true;
        break;
      }
      if (hit.status === 404) {
        sawOk = true;
        break;
      }
      sawBlock = true;
    }
  }
  return { urls: [], missing: sawOk && !sawBlock };
}

async function instagramApi(target: InstagramTarget): Promise<{ urls: string[]; missing: boolean }> {
  if (target.kind === "post") return firstMedia([`/media/shortcode/${target.code}/info/`]);
  if (target.kind === "story") {
    const code = pkToCode(target.id);
    const paths = [`/media/${target.id}/info/`];
    if (code) paths.push(`/media/shortcode/${code}/info/`);
    return firstMedia(paths);
  }
  if (target.kind === "highlight") {
    return firstMedia([`/feed/reels_media/?reel_ids=${encodeURIComponent(`highlight:${target.id}`)}`]);
  }
  const profile = await igGet(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(target.user)}`);
  const userId = profile.data && typeof profile.data === "object" ? (profile.data as { data?: { user?: { id?: string } } }).data?.user?.id : "";
  if (!userId || !/^\d{3,}$/.test(userId)) return { urls: [], missing: profile.status === 404 };
  return firstMedia([`/feed/reels_media/?reel_ids=${encodeURIComponent(userId)}`]);
}

async function tiktok(raw: string): Promise<{ url: string; title: string; referer: string }> {
  const { html, finalUrl } = await pageText(raw, PHONE);
  const url = firstUrl(html, [
    /"downloadAddr":"(https:[^"]+)"/,
    /"playAddr":"(https:[^"]+)"/,
    /"download_addr":\{[^}]{0,400}"url_list":\["(https:[^"]+)"/,
    /"play_addr":\{[^}]{0,400}"url_list":\["(https:[^"]+)"/,
    /(https:\/\/[^"'\\\s]*tiktokcdn[^"'\\\s]+)/,
    /(https:\/\/[^"'\\\s]+\/video\/tos\/[^"'\\\s]+)/,
  ]);
  if (!url) clipFail(502, "По этой ссылке ролик не открылся");
  const title = /<title>([^<]+)<\/title>/i.exec(html)?.[1]?.replace(/\s+\|\s+TikTok.*/, "").trim() || "Ролик";
  return { url, title, referer: finalUrl };
}

async function pinterest(raw: string): Promise<{ url: string; title: string; referer: string }> {
  const { html, finalUrl } = await pageText(raw);
  const url = firstUrl(html, [
    /(https:\/\/v\.pinimg\.com\/videos\/[^"'\\\s]+)/,
    /"url":"(https:[^"]*v\.pinimg\.com[^"]*\/videos\/[^"]+)"/,
    /"V_(?:720P|EXP7|HLSV4)":\{"url":"(https:[^"]+)"/,
    /property="og:video(?::secure_url)?" content="(https:[^"]+)"/,
    /property="og:image" content="(https:[^"]+)"/,
    /(https:\/\/i\.pinimg\.com\/[^"'\\\s]+\.(?:jpe?g|png|webp)[^"'\\\s]*)/,
  ]);
  if (!url || (!url.includes("/videos/") && !/\.mp4(?:\?|$)/i.test(url) && !/\.(?:jpe?g|png|webp)(?:\?|$)/i.test(url) && !url.includes("pinimg.com"))) {
    clipFail(502, "По этой ссылке ничего не нашлось");
  }
  const title = /<title>([^<]+)<\/title>/i.exec(html)?.[1]?.trim() || "Файл";
  return { url: unescapeUrl(url), title, referer: finalUrl };
}

function vkIds(raw: string): { oid: string; id: string } | null {
  const hit = /(?:video|clip|z=video)(-?\d+)_(\d+)/.exec(raw);
  if (!hit?.[1] || !hit[2]) return null;
  return { oid: hit[1], id: hit[2] };
}

async function vk(raw: string): Promise<{ url: string; title: string; referer: string }> {
  const ids = vkIds(raw);
  const pages = [
    ids ? `https://vk.com/video_ext.php?oid=${ids.oid}&id=${ids.id}&hd=2` : "",
    raw.includes("vk.com") || raw.includes("vk.ru") || raw.includes("vkvideo.ru") ? raw.replace(/^https:\/\/(?:www\.)?(?:vk\.com|vk\.ru|vkvideo\.ru)/, "https://m.vk.com") : "",
    raw,
  ].filter(Boolean);
  for (const page of pages) {
    try {
      const phone = page.includes("video_ext") || page.includes("m.vk.com");
      const { html, finalUrl } = await pageText(page, phone ? PHONE : DESKTOP);
      const url = firstUrl(html, [
        /"url720":"(https:[^"]+)"/,
        /"url480":"(https:[^"]+)"/,
        /"url360":"(https:[^"]+)"/,
        /"url240":"(https:[^"]+)"/,
        /<source[^>]+src="(https:[^"]+)"/,
        /"(https:\/\/[^"]+\.mp4[^"]*)"/,
      ]);
      if (!url || url.includes("video_ext.php")) continue;
      const title = /<title>([^<]+)<\/title>/i.exec(html)?.[1]?.trim() || "Ролик";
      return { url, title, referer: finalUrl };
    } catch {
      /* try the next page */
    }
  }
  clipFail(502, "По этой ссылке ничего не нашлось");
}

type Remote = { url: string; title: string; referer: string };

async function resolve(raw: string): Promise<Remote[]> {
  const host = clipHost(raw);
  if (host === "youtube") return [await youtube(raw)];
  if (host === "instagram") return instagram(raw);
  if (host === "tiktok") return [await tiktok(raw)];
  if (host === "pinterest") return [await pinterest(raw)];
  if (host === "vk") return [await vk(raw)];
  clipFail(400, "Нужна ссылка из Instagram, YouTube, TikTok, Pinterest или VK");
}

async function takeBytes(url: string, referer: string): Promise<{ bytes: Uint8Array; mime: string }> {
  const res = await fetch(url, {
    headers: { "user-agent": DESKTOP, referer, accept: "*/*" },
    redirect: "follow",
    signal: AbortSignal.timeout(50000),
  });
  if (!res.ok || !res.body) {
    logGrab("file", res.status, url.slice(0, 120));
    clipFail(502, "Файл не скачался");
  }
  const announced = Number(res.headers.get("content-length") || 0);
  if (announced > MAX) clipFail(413, "Файл слишком большой для временного файла");
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const step = await reader.read();
    if (step.done) break;
    total += step.value.byteLength;
    if (total > MAX) {
      await reader.cancel().catch(() => undefined);
      clipFail(413, "Файл слишком большой для временного файла");
    }
    chunks.push(step.value);
  }
  if (total < 400) clipFail(502, "По ссылке файл не пришёл");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let mime = (res.headers.get("content-type") || "").split(";")[0]?.trim().toLowerCase() || "";
  if (!mime || mime === "application/octet-stream" || mime === "binary/octet-stream") mime = sniff(bytes);
  if (mime.includes("text/html") || mime.includes("json")) clipFail(502, "По этой ссылке ничего не нашлось");
  if (!mime.startsWith("video/") && !mime.startsWith("image/") && !mime.startsWith("audio/")) clipFail(502, "По этой ссылке ничего не нашлось");
  return { bytes, mime };
}

function sniff(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return "image/webp";
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "video/webm";
  return "video/mp4";
}

function fileName(title: string, mime: string): string {
  const clean = title.replace(/[^\p{L}\p{N}._ ()\-]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : mime.includes("gif") ? "gif" : mime.startsWith("image/") ? "jpg" : mime.includes("webm") ? "webm" : mime.startsWith("audio/") ? "m4a" : "mp4";
  return `${clean || "Файл"}.${ext}`;
}

export async function runGrab(userId: string, raw: string, onProgress?: (tick: GrabTick) => void): Promise<Grabbed[]> {
  const data = cleanUrl(raw);
  await assertActive(userId);
  const link = clipHost(data) === "instagram" ? rewriteInstagram(data) : data;
  onProgress?.({ phase: "open", pct: 8, loaded: 0, total: 0 });
  try {
    const { grabWithYtDlp } = await import("@/lib/social/ytdlp.server");
    const via = await grabWithYtDlp(link, (tick) => onProgress?.(tick));
    let files = via.files;
    if (!files?.length && via.note && /не отдал|не отвечает/.test(via.note)) clipFail(503, via.note);
    if (!files?.length) {
      try {
        onProgress?.({ phase: "fetch", pct: 30, loaded: 0, total: 0 });
        files = await Promise.all((await resolve(link)).map(async (item) => ({ ...(await takeBytes(item.url, item.referer)), title: item.title })));
      } catch (error) {
        if (error instanceof Error && error.message) throw error;
        if (via.note) clipFail(/не отвечает|не отдал/.test(via.note) ? 503 : 502, via.note);
        throw error;
      }
    }
    if (!files?.length) clipFail(502, via.note || "По этой ссылке ничего не нашлось");
    const saved: Grabbed[] = [];
    for (const [index, file] of files.slice(0, 8).entries()) {
      onProgress?.({ phase: "save", pct: 90 + index, loaded: index, total: Math.min(files.length, 8) });
      try {
        const row = await storeMegaBytes(userId, fileName(file.title, file.mime), file.mime, file.bytes, TTL);
        saved.push({ id: row.id, name: row.name, bytes: file.bytes.byteLength, mime: file.mime });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        logGrab("save", 0, message);
        if (/подписк|не действует|не поставлен/i.test(message)) clipFail(402, "Для временного файла нужен мегадиск");
        if (!saved.length) throw error instanceof Error ? error : new Error("Файл не сохранился");
      }
    }
    onProgress?.({ phase: "save", pct: 100, loaded: saved.length, total: saved.length });
    return saved;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "Страница не открылась") clipFail(502, message);
    if (message) throw error;
    logGrab("grab", 0, "unknown");
    clipFail(502, "Файл не скачался");
  }
}

export const saveGrab = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(cleanUrl)
  .handler(async ({ context, data }): Promise<Grabbed[]> => runGrab(context.userId, data));
