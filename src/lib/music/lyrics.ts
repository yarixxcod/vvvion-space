import { createServerFn } from "@tanstack/react-start";

export type Lyric = { plain: string; synced: string; instrumental: boolean };

const EMPTY: Lyric = { plain: "", synced: "", instrumental: false };
const cache = new Map<string, { at: number; value: Lyric }>();

type Hit = {
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
  instrumental?: boolean;
};

function clip(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 180) : "";
}

function shape(row: Hit | null): Lyric {
  if (!row) return EMPTY;
  return {
    plain: (row.plainLyrics || "").trim().slice(0, 20_000),
    synced: (row.syncedLyrics || "").trim().slice(0, 40_000),
    instrumental: Boolean(row.instrumental),
  };
}

function pick(rows: Hit[], artist: string, track: string, duration: number): Hit | null {
  const want = track.toLowerCase();
  const who = artist.toLowerCase();
  let best: Hit | null = null;
  let score = -1;
  for (const row of rows.slice(0, 12)) {
    const name = (row.trackName || "").toLowerCase();
    const by = (row.artistName || "").toLowerCase();
    let next = 0;
    if (name === want) next += 5;
    else if (want && (name.includes(want) || want.includes(name))) next += 2;
    if (who && by.includes(who)) next += 3;
    if (duration && row.duration) {
      const diff = Math.abs(row.duration - duration);
      if (diff < 3) next += 3;
      else if (diff < 8) next += 1;
    }
    if (row.syncedLyrics) next += 4;
    else if (row.plainLyrics) next += 1;
    if (next > score) {
      score = next;
      best = row;
    }
  }
  return score > 0 ? best : null;
}

async function remote(input: { artist: string; track: string; album: string; duration: number }): Promise<Lyric> {
  const headers = { "user-agent": "vvvion/1.0 (https://vvvion.space)", accept: "application/json" };
  const signal = AbortSignal.timeout(8000);
  let exact: Lyric | null = null;
  if (input.artist && input.duration) {
    const get = new URL("https://lrclib.net/api/get");
    get.searchParams.set("track_name", input.track);
    get.searchParams.set("artist_name", input.artist);
    if (input.album) get.searchParams.set("album_name", input.album);
    get.searchParams.set("duration", String(input.duration));
    const hit = await fetch(get, { headers, signal }).catch(() => null);
    if (hit?.ok) {
      exact = shape((await hit.json()) as Hit);
      if (exact.synced.trim()) return exact;
    }
  }
  const search = new URL("https://lrclib.net/api/search");
  search.searchParams.set("q", [input.artist, input.track].filter(Boolean).join(" "));
  const found = await fetch(search, { headers, signal }).catch(() => null);
  if (!found?.ok) return exact ?? EMPTY;
  const rows = (await found.json()) as Hit[];
  if (!Array.isArray(rows)) return exact ?? EMPTY;
  const searched = shape(pick(rows, input.artist, input.track, input.duration));
  if (searched.synced.trim()) return searched;
  if (exact && (exact.plain || exact.instrumental)) return exact;
  return searched.plain || searched.instrumental ? searched : (exact ?? searched);
}

export const findLyrics = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
    const track = clip(raw.track);
    const artist = clip(raw.artist);
    const album = clip(raw.album);
    const duration = Number(raw.duration) || 0;
    if (!track) throw new Error("Нет названия");
    return { track, artist, album, duration: duration > 0 && duration < 7200 ? Math.round(duration) : 0 };
  })
  .handler(async ({ data }): Promise<Lyric> => {
    const key = `${data.artist}\n${data.track}\n${data.duration}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < 60 * 60 * 1000) return hit.value;
    const value = await remote(data);
    cache.set(key, { at: Date.now(), value });
    if (cache.size > 200) {
      const first = cache.keys().next().value;
      if (first) cache.delete(first);
    }
    return value;
  });
