import { readTags, readTailTags, type MusicTags } from "@/lib/music/tags";

const cache = new Map<string, Promise<MusicTags>>();

export function dropTags(src: string): void {
  const path = src.split("?")[0];
  for (const key of cache.keys()) {
    if (key.split("?")[0] === path) cache.delete(key);
  }
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

async function read(src: string, name: string): Promise<MusicTags> {
  const head = await pull(src, "bytes=0-524287");
  const tags = readTags(head);
  if (tags.title || tags.artist || tags.cover) return tags;
  if (!/\.(m4a|mp4|aac)$/i.test(name)) return tags;
  const tail = await pull(src, "bytes=-1048575");
  return readTailTags(tail);
}

async function pull(src: string, range: string): Promise<Uint8Array> {
  const tail = range.startsWith("bytes=-");
  const cap = tail ? 1_048_576 : 524_288;
  const headers = src.startsWith("blob:") ? undefined : { Range: range };
  const res = await fetch(src, { headers, credentials: "same-origin" });
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
