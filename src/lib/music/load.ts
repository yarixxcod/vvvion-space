import { audioStart, readTags, readTailTags, type MusicTags } from "@/lib/music/tags";

const cache = new Map<string, Promise<MusicTags>>();
const STAMP_KEY = "vvvion.tag-rev";

export function dropTags(src: string): void {
  const path = src.split("?")[0];
  for (const key of cache.keys()) {
    if (key.split("?")[0] === path) cache.delete(key);
  }
}

function stampMap(): Record<string, string> {
  if (typeof localStorage === "undefined") return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(STAMP_KEY) || "{}") as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const next: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string" && value) next[key] = value;
    }
    return next;
  } catch {
    return {};
  }
}

/** Survives a reload, so the browser does not keep yesterday's audio bytes. */
export function bumpFileStamp(id: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    const map = stampMap();
    map[id] = String(Date.now());
    const keys = Object.keys(map);
    if (keys.length > 240) {
      for (const key of keys.slice(0, keys.length - 240)) delete map[key];
    }
    localStorage.setItem(STAMP_KEY, JSON.stringify(map));
  } catch {
    /* private mode */
  }
}

export function withStamp(url: string, id: string): string {
  const stamp = stampMap()[id];
  if (!stamp) return url;
  const hashAt = url.indexOf("#");
  const hash = hashAt === -1 ? "" : url.slice(hashAt);
  const base = hashAt === -1 ? url : url.slice(0, hashAt);
  const queryAt = base.indexOf("?");
  const path = queryAt === -1 ? base : base.slice(0, queryAt);
  const params = new URLSearchParams(queryAt === -1 ? "" : base.slice(queryAt + 1));
  params.set("r", stamp);
  const query = params.toString();
  return `${path}${query ? `?${query}` : ""}${hash}`;
}

export function loadTags(src: string, name: string): Promise<MusicTags> {
  const hit = cache.get(src);
  if (hit) return hit;
  const job = read(src, name).catch((error) => {
    cache.delete(src);
    throw error;
  });
  cache.set(src, job);
  return job;
}

function hasTech(tags: MusicTags): boolean {
  return tags.bitrate > 0 || (tags.sampleRate >= 8000 && tags.duration > 1);
}

function mergeTech(base: MusicTags, extra: MusicTags): MusicTags {
  return {
    title: base.title || extra.title,
    artist: base.artist || extra.artist,
    album: base.album || extra.album,
    genre: base.genre || extra.genre,
    cover: base.cover ?? extra.cover,
    bitrate: base.bitrate || extra.bitrate,
    sampleRate: base.sampleRate || extra.sampleRate,
    bits: base.bits || extra.bits,
    duration: base.duration || extra.duration,
  };
}

async function read(src: string, name: string): Promise<MusicTags> {
  const head = await pull(src, "bytes=0-524287");
  let tags = readTags(head);
  const span = audioStart(head);
  if (!hasTech(tags) && span > head.length - 16 && span < 40_000_000) {
    try {
      const frames = await pull(src, `bytes=${span}-${span + 131071}`);
      tags = mergeTech(tags, readTags(frames));
    } catch {
      /* title and cover from the header still stand */
    }
  }
  const needTail = !hasTech(tags) && (span > head.length || /\.(m4a|mp4|aac)$/i.test(name) || !(tags.title || tags.artist || tags.cover));
  if (needTail) {
    try {
      tags = mergeTech(tags, readTailTags(await pull(src, "bytes=-1048575")));
    } catch {
      /* keep whatever the head already had */
    }
  }
  return tags;
}

async function pull(src: string, range: string): Promise<Uint8Array> {
  const tail = range.startsWith("bytes=-");
  const cap = tail ? 1_048_576 : 524_288;
  const headers = src.startsWith("blob:") ? undefined : { Range: range, "cache-control": "no-cache" };
  const res = await fetch(src, { headers, credentials: "same-origin", cache: "no-store" });
  if (!res.ok && res.status !== 206) throw new Error("Теги не прочитались");
  if (!res.body) {
    const bytes = new Uint8Array(await res.arrayBuffer());
    return tail && res.status !== 206 ? bytes.subarray(Math.max(0, bytes.length - cap)) : bytes.subarray(0, cap);
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  while (got < cap) {
    const step = await reader.read();
    if (step.done) break;
    chunks.push(step.value);
    got += step.value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  const merged = new Uint8Array(Math.min(got, cap));
  let offset = 0;
  for (const chunk of chunks) {
    const take = Math.min(chunk.byteLength, merged.length - offset);
    if (take < 1) break;
    merged.set(chunk.subarray(0, take), offset);
    offset += take;
  }
  const filled = merged.subarray(0, offset);
  return tail && res.status !== 206 ? filled.subarray(Math.max(0, filled.length - cap)) : filled;
}
