import { clipHost } from "./grab-url.ts";
export type GrabMode = "video" | "small" | "audio";
export function grabMode(value: unknown): GrabMode {
  return value === "small" || value === "audio" ? value : "video";
}
export function youtubeId(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (clipHost(raw) !== "youtube") return null;
    const parts = url.pathname.split("/").filter(Boolean);
    const id =
      url.hostname === "youtu.be"
        ? parts[0]
        : url.searchParams.get("v") ||
          (["shorts", "embed", "live"].includes(parts[0]) ? parts[1] : "");
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}
export function normalizeGrabUrl(input: unknown): string {
  const text = typeof input === "string" ? input.trim() : "";
  if (text.length > 4000) throw new Error("Ссылка слишком длинная");
  const raw = (text.match(/https:\/\/[^\s<>"']+/i)?.[0] || "").replace(/[).,!?;]+$/, "");
  if (!raw || raw.length > 500 || !clipHost(raw))
    throw new Error("Нужна ссылка из Instagram, YouTube, TikTok, Pinterest или VK");
  const url = new URL(raw);
  if (url.username || url.password || url.port) throw new Error("Нужна обычная ссылка на ролик");
  if (clipHost(raw) === "youtube") {
    const id = youtubeId(raw);
    if (!id) throw new Error("Нужна ссылка на ролик или Shorts, а не на канал или плейлист");
    return `https://www.youtube.com/watch?v=${id}`;
  }
  return url.toString();
}
export function youtubeFormat(mode: GrabMode): string {
  if (mode === "audio") return "ba[ext=m4a]/ba";
  const height = mode === "small" ? 360 : 720;
  // Single muxed format includes audio and works without an ffmpeg subprocess.
  return `b[ext=mp4][height<=${height}]/b[height<=${height}]`;
}
