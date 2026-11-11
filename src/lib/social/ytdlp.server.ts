import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { instagramTarget, pkToCode, rewriteInstagram } from "./grab-url.ts";

const MAX = 40 * 1024 * 1024;
const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export type GrabFile = { bytes: Uint8Array; title: string; mime: string };

type Fmt = { url?: string; ext?: string; vcodec?: string; acodec?: string; height?: number; protocol?: string };
type Thumb = { url?: string; width?: number };
type Info = { title?: string; url?: string; ext?: string; formats?: Fmt[]; thumbnails?: Thumb[]; entries?: Info[] };
export type RemoteLink = { url: string; title: string; mime: string };
export type GrabTick = { phase: "open" | "fetch" | "save"; pct: number; loaded: number; total: number };

function binPath(): string | null {
  const fromEnv = process.env.YTDLP_BIN?.trim();
  const candidates = [
    fromEnv || "",
    join(process.cwd(), ".bin", "yt-dlp"),
    join(process.cwd(), "yt-dlp"),
    join(process.cwd(), ".output", "server", "yt-dlp"),
    "/usr/local/bin/yt-dlp",
  ].filter(Boolean);
  return candidates.find((item) => existsSync(item)) ?? null;
}

function run(bin: string, args: string[], ms: number, maxOut = 4000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), ms);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (stdout.length < maxOut) stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < 8000) stderr += chunk;
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ code: 127, stdout, stderr });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function mimeOf(name: string): string | null {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "mp4" || ext === "m4v") return "video/mp4";
  if (ext === "webm") return "video/webm";
  if (ext === "mov") return "video/quicktime";
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "m4a") return "audio/mp4";
  return null;
}

function thumbRank(url: string, width = 0): number {
  const cap = /(?:^|[/_])s(\d{2,4})x\d{2,4}/.exec(url);
  const capN = cap ? Number(cap[1]) : 0;
  if (capN && capN < 480) return capN;
  if (capN) return 10_000 + capN + width;
  return 100_000 + width;
}

function bestThumb(list: Thumb[]): string | null {
  const rows = list.filter((item) => item.url?.startsWith("http") && !/profile_pic|s44x44|s150x150/.test(item.url));
  rows.sort((a, b) => thumbRank(b.url || "", b.width || 0) - thumbRank(a.url || "", a.width || 0));
  return rows[0]?.url ?? null;
}

function pick(info: Info): { url: string; mime: string } | null {
  const formats = (info.formats ?? []).filter((item) => item.url?.startsWith("http"));
  const videos = formats.filter((item) => {
    const codec = item.vcodec || "";
    if (!codec || codec === "none") return false;
    if ((item.protocol || "").includes("m3u8") || item.url?.includes(".m3u8")) return false;
    return true;
  });
  videos.sort((a, b) => (b.height || 0) - (a.height || 0));
  const video = videos.find((item) => item.ext === "mp4") || videos[0];
  if (video?.url) return { url: video.url, mime: video.ext === "webm" ? "video/webm" : "video/mp4" };
  const audio = formats.find((item) => item.acodec && item.acodec !== "none" && (!item.vcodec || item.vcodec === "none") && item.url && !item.url.includes(".m3u8"));
  if (audio?.url) return { url: audio.url, mime: audio.ext === "mp3" ? "audio/mpeg" : "audio/mp4" };
  const thumb = bestThumb(info.thumbnails ?? []);
  if (thumb) return { url: thumb, mime: mimeOf(`x.${thumb.split("?")[0]?.split(".").pop() || "jpg"}`) || "image/jpeg" };
  if (info.url?.startsWith("http") && info.ext && mimeOf(`x.${info.ext}`)) return { url: info.url, mime: mimeOf(`x.${info.ext}`) || "application/octet-stream" };
  return null;
}

export function linksFromDump(data: unknown, fallbackTitle = "Файл"): RemoteLink[] {
  const out: RemoteLink[] = [];
  const seen = new Set<string>();
  const walk = (node: unknown, title: string) => {
    if (!node || typeof node !== "object" || out.length >= 8) return;
    const info = node as Info;
    const name = (info.title || title || fallbackTitle).replace(/\s+/g, " ").trim().slice(0, 80) || fallbackTitle;
    if (Array.isArray(info.entries) && info.entries.length) {
      for (const entry of info.entries) walk(entry, name);
      return;
    }
    const chosen = pick(info);
    if (!chosen || seen.has(chosen.url)) return;
    seen.add(chosen.url);
    out.push({ url: chosen.url, title: name, mime: chosen.mime });
  };
  walk(data, fallbackTitle);
  return out;
}

function sniff(bytes: Uint8Array, fallback: string): string {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return "image/webp";
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "video/webm";
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return "video/mp4";
  return fallback;
}

async function pull(url: string, onBytes?: (loaded: number, total: number) => void): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const res = await fetch(url, {
    headers: { "user-agent": DESKTOP, referer: "https://www.instagram.com/", accept: "*/*" },
    redirect: "follow",
    signal: AbortSignal.timeout(50_000),
  });
  if (!res.ok || !res.body) return null;
  const announced = Number(res.headers.get("content-length") || 0);
  if (announced > MAX) return null;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const step = await reader.read();
    if (step.done) break;
    total += step.value.byteLength;
    if (total > MAX) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(step.value);
    onBytes?.(total, announced || 0);
  }
  if (total < 400) return null;
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const header = (res.headers.get("content-type") || "").split(";")[0]?.trim().toLowerCase() || "";
  const mime = !header || header === "application/octet-stream" || header === "binary/octet-stream" ? sniff(bytes, "application/octet-stream") : header;
  if (mime.includes("text/html") || mime.includes("json")) return null;
  if (!mime.startsWith("video/") && !mime.startsWith("image/") && !mime.startsWith("audio/")) return null;
  return { bytes, mime };
}

async function dumpJson(bin: string, url: string, impersonate: string): Promise<{ data: unknown | null; stderr: string }> {
  const args = [
    "--ignore-no-formats-error",
    "--ignore-errors",
    "--skip-download",
    "--dump-single-json",
    "--no-warnings",
    "--no-progress",
    "--no-cache-dir",
    "--socket-timeout",
    "20",
    "--retries",
    "1",
    "--playlist-end",
    "8",
    url,
  ];
  if (impersonate) args.unshift("--impersonate", impersonate);
  let result = await run(bin, args, 28_000, 2_000_000);
  if (impersonate && /impersonat/i.test(result.stderr) && result.stdout.indexOf("{") < 0) {
    result = await run(bin, args.filter((item, index) => item !== "--impersonate" && args[index - 1] !== "--impersonate"), 28_000, 2_000_000);
  }
  const start = result.stdout.indexOf("{");
  if (start < 0) return { data: null, stderr: result.stderr };
  try {
    return { data: JSON.parse(result.stdout.slice(start)), stderr: result.stderr };
  } catch {
    return { data: null, stderr: result.stderr };
  }
}

function noteFor(url: string, stderr: string): string {
  const story = instagramTarget(url);
  const isStory = story?.kind === "story" || story?.kind === "stories" || story?.kind === "highlight";
  if (/429|Too Many Requests/i.test(stderr)) {
    if (isStory) return "";
    return "Instagram сейчас не отвечает. Попробуйте ещё раз через минуту";
  }
  if (isStory) return "";
  if (!story) {
    try {
      const parts = new URL(url).pathname.split("/").filter(Boolean);
      if (parts.length === 1) return "Это профиль. Нужна ссылка на сторис, пост или ролик";
    } catch {
      /* ignore */
    }
  }
  return "";
}

async function filesFrom(bin: string, url: string, impersonate: string, onProgress?: (tick: GrabTick) => void): Promise<{ files: GrabFile[] | null; stderr: string }> {
  onProgress?.({ phase: "fetch", pct: 16, loaded: 0, total: 0 });
  const dumped = await dumpJson(bin, url, impersonate);
  const links = dumped.data ? linksFromDump(dumped.data) : [];
  if (!links.length) return { files: null, stderr: dumped.stderr };
  const files: GrabFile[] = [];
  for (const [index, link] of links.entries()) {
    const got = await pull(link.url, (loaded, total) => {
      const span = 62 / links.length;
      const inner = total > 0 ? loaded / total : 0.15;
      onProgress?.({ phase: "fetch", pct: Math.min(88, Math.round(22 + index * span + inner * span)), loaded, total });
    });
    if (!got) continue;
    files.push({
      bytes: got.bytes,
      mime: got.mime,
      title: links.length > 1 ? `${link.title} ${index + 1}` : link.title,
    });
  }
  return { files: files.length ? files : null, stderr: dumped.stderr };
}

async function grabInstagram(bin: string, raw: string, onProgress?: (tick: GrabTick) => void): Promise<{ files: GrabFile[] | null; note: string }> {
  const url = rewriteInstagram(raw);
  const target = instagramTarget(url);
  const attempts: { url: string; who: string }[] = [];
  if (target?.kind === "story") {
    const code = pkToCode(target.id);
    if (code) attempts.push({ url: `https://www.instagram.com/p/${code}/`, who: "Chrome-136:Macos-15" });
  }
  attempts.push({ url, who: "Chrome-136:Macos-15" });
  let stderr = "";
  const seen = new Set<string>();
  for (const attempt of attempts) {
    if (seen.has(attempt.url)) continue;
    seen.add(attempt.url);
    const found = await filesFrom(bin, attempt.url, attempt.who, onProgress);
    stderr = found.stderr || stderr;
    if (found.files?.length) return { files: found.files, note: "" };
  }
  if (/429|Too Many Requests/i.test(stderr)) {
    onProgress?.({ phase: "fetch", pct: 20, loaded: 0, total: 0 });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const again = await filesFrom(bin, url, "Safari-18.4:Ios-18.4", onProgress);
    if (again.files?.length) return { files: again.files, note: "" };
    stderr = again.stderr || stderr;
  }
  return { files: null, note: noteFor(url, stderr) };
}

export async function grabWithYtDlp(url: string, onProgress?: (tick: GrabTick) => void): Promise<{ files: GrabFile[] | null; note: string }> {
  const bin = binPath();
  if (!bin) {
    console.error("[grab] yt-dlp missing");
    return { files: null, note: "" };
  }
  if (/instagram\.com|instagr\.am/i.test(url)) return grabInstagram(bin, url, onProgress);
  const dir = await mkdtemp(join(tmpdir(), "vv-grab-"));
  const out = join(dir, "%(autonumber)02d.%(ext)s");
  const args = [
    "--no-warnings",
    "--no-progress",
    "--ignore-config",
    "--no-cache-dir",
    "--no-playlist",
    "--max-filesize",
    "40M",
    "--socket-timeout",
    "20",
    "--retries",
    "2",
    "--fragment-retries",
    "2",
    "--print",
    "after_move:%(title)s",
    "-o",
    out,
    "-f",
    "b[ext=mp4]/b",
  ];
  if (/youtu\.be|youtube\.com|youtube-nocookie\.com/i.test(url)) {
    args.push("--extractor-args", "youtube:player_client=android_vr,ios,web_safari");
  }
  const cookies = process.env.YTDLP_COOKIES?.trim();
  if (cookies && existsSync(cookies)) args.push("--cookies", cookies);
  args.push(url);
  const result = await run(bin, args, 70_000);
  if (/max-filesize|File is larger/i.test(result.stderr) && result.code !== 0) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    throw new Error("Файл слишком большой для временного файла");
  }
  try {
    const names = (await readdir(dir)).filter((name) => mimeOf(name) && !name.endsWith(".part"));
    const title = result.stdout.split("\n").map((line) => line.trim()).filter(Boolean)[0] || "Файл";
    const files: GrabFile[] = [];
    for (const [index, name] of names.slice(0, 8).entries()) {
      const info = await stat(join(dir, name));
      const mime = mimeOf(name);
      if (!mime || info.size < 400 || info.size > MAX) continue;
      files.push({
        bytes: new Uint8Array(await readFile(join(dir, name))),
        title: names.length > 1 ? `${title} ${index + 1}` : title,
        mime,
      });
    }
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    if (!files.length) {
      if (result.code !== 0) console.error("[grab] yt-dlp", result.code);
      return { files: null, note: "" };
    }
    return { files, note: "" };
  } catch (error) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    if (error instanceof Error && /слишком большой/.test(error.message)) throw error;
    return { files: null, note: "" };
  }
}
