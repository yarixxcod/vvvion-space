import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import { Captions, ChevronDown, Music2, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, X } from "lucide-react";
import { ArtistNames } from "@/components/yaronetic/artist-card";
import { useTx } from "@/lib/lang";
import { coverUrl, musicBits, type MusicTags } from "@/lib/music/tags";
import { loadTags } from "@/lib/music/load";
import { parseLrc, type LrcLine } from "@/lib/music/lrc";
import { findLyrics } from "@/lib/music/lyrics";
import { setTrackEnded, setTrackFailed, trackFormat, trackIsPlaying, trackLength, trackPlay, trackSeek, trackStart, trackStop, trackToggle, watchTrack } from "@/lib/sounds";
import { initMediaSessionHandlers, syncMediaSession } from "@/lib/player/media-session";
import {
  nativeAttach,
  nativeDuration,
  nativeMeta,
  nativeNext,
  nativeOpen,
  nativeOwns,
  nativePause,
  nativePlay,
  nativePlaying,
  nativePosition,
  nativePrev,
  nativeRepeat,
  nativeSeek,
  nativeShuffle,
  nativeState,
  nativeStop,
  nativeWatch,
  type NativePlayerState,
} from "@/lib/player/native";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptic";

export type Track = {
  src: string;
  file: string;
  title: string;
  artist: string;
  album: string;
  genre: string;
  cover: string | null;
  bitrate: number;
  sampleRate: number;
  bits: number;
};

type Mode = "full" | "mini";
type RepeatMode = "off" | "all" | "one";

type Deck = {
  track: Track | null;
  mode: Mode;
  shuffle: boolean;
  repeat: RepeatMode;
  lyrics: boolean;
  index: number;
  total: number;
};

const listeners = new Set<() => void>();
let queue: Track[] = [];
let index = 0;
let mode: Mode = "full";
let shuffle = false;
let repeat: RepeatMode = "off";
let lyricsOn = false;
let history: number[] = [];
let shuffleBag: number[] = [];
let ticket = 0;

function blank(src: string, name: string): Track {
  return {
    src,
    file: name,
    title: name.replace(/\.[^.]+$/, "") || name,
    artist: "",
    album: "",
    genre: "",
    cover: null,
    bitrate: 0,
    sampleRate: 0,
    bits: 0,
  };
}

function paint(src: string, name: string, tags: MusicTags): Track {
  return {
    src,
    file: name,
    title: tags.title || name.replace(/\.[^.]+$/, "") || name,
    artist: tags.artist,
    album: tags.album,
    genre: tags.genre,
    cover: coverUrl(tags.cover),
    bitrate: tags.bitrate,
    sampleRate: tags.sampleRate,
    bits: tags.bits,
  };
}

function view(): Deck {
  return {
    track: queue[index] ?? null,
    mode,
    shuffle,
    repeat,
    lyrics: lyricsOn,
    index,
    total: queue.length,
  };
}

let snapshot: Deck = view();
const SERVER_DECK: Deck = {
  track: null,
  mode: "full",
  shuffle: false,
  repeat: "off",
  lyrics: false,
  index: 0,
  total: 0,
};

const SAVE_KEY = "vvvion.player";
const MAX_QUEUE = 80;
let readyToSave = false;
let shieldAt = 0;
let shieldDur = 0;
let pendingPlay = false;

function allowedSrc(src: string) {
  return src.startsWith("/api/") || src.startsWith("/sounds/") || src.startsWith("blob:");
}

function playingNow() {
  return nativeOwns() ? nativePlaying() : trackIsPlaying();
}

function positionNow() {
  if (nativeOwns()) return nativePosition();
  const now = trackSeek();
  if (shieldAt > 0.2 && now < shieldAt - 0.2) return shieldAt;
  shieldAt = 0;
  return Number.isFinite(now) ? now : 0;
}

function lengthNow() {
  if (nativeOwns()) {
    const length = nativeDuration();
    if (length > 0) shieldDur = length;
    return length || shieldDur;
  }
  const length = trackLength();
  if (length > 0) {
    shieldDur = length;
    return length;
  }
  return shieldDur;
}

function heardAt() {
  return positionNow();
}

function heardDur() {
  return lengthNow();
}

function syncMedia() {
  if (nativeOwns()) return;
  const track = queue[index] ?? null;
  syncMediaSession(
    track ? { title: track.title, artist: track.artist, album: track.album, cover: track.cover } : null,
    Boolean(track) && (trackIsPlaying() || pendingPlay),
    heardAt(),
    heardDur(),
  );
}

function savePlayer() {
  if (!readyToSave || typeof window === "undefined") return;
  try {
    if (!queue.length) {
      pendingPlay = false;
      sessionStorage.removeItem(SAVE_KEY);
      return;
    }
    const livePlay = playingNow();
    if (livePlay) pendingPlay = false;
    const items = queue.filter((item) => allowedSrc(item.src)).slice(0, MAX_QUEUE);
    if (!items.length) {
      sessionStorage.removeItem(SAVE_KEY);
      return;
    }
    const current = queue[index];
    let savedIndex = current ? items.findIndex((item) => item.src === current.src && item.file === current.file) : 0;
    if (savedIndex < 0) savedIndex = 0;
    const pos = heardAt();
    sessionStorage.setItem(
      SAVE_KEY,
      JSON.stringify({
        items: items.map((item) => ({ src: item.src, file: item.file.slice(0, 180) })),
        index: savedIndex,
        mode,
        shuffle,
        repeat,
        lyrics: lyricsOn,
        at: pos,
        dur: heardDur(),
        playing: livePlay || pendingPlay,
      }),
    );
  } catch {
    /* quota or private mode */
  }
}

function emit() {
  snapshot = view();
  for (const fn of listeners) fn();
  savePlayer();
  syncMedia();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function fillBag() {
  const rest = queue.map((_, at) => at).filter((at) => at !== index);
  for (let i = rest.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const swap = rest[i]!;
    rest[i] = rest[j]!;
    rest[j] = swap;
  }
  shuffleBag = rest;
}

async function pool<T>(items: T[], size: number, job: (item: T, at: number) => Promise<void>) {
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const at = cursor;
      cursor += 1;
      const item = items[at];
      if (!item) return;
      await job(item, at);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, () => worker()));
}

export function openAlbum(items: { src: string; name: string; bytes?: number }[], start = 0) {
  const songs = items.filter((item) => item.src);
  if (!songs.length) return;
  const mine = ++ticket;
  queue = songs.map((item) => blank(item.src, item.name));
  index = Math.min(Math.max(0, start), queue.length - 1);
  mode = "full";
  lyricsOn = false;
  history = [];
  shuffleBag = [];
  shieldAt = 0;
  shieldDur = 0;
  pendingPlay = true;
  emit();
  const first = queue[index];
  trackStop();
  if (!nativeOpen(queue, index, { shuffle, repeat, autoplay: true }) && first) trackStart(first.src, trackFormat(first.file));
  void pool(songs, 3, async (item, at) => {
    const parsed = await loadTags(item.src, item.name);
    if (mine !== ticket) return;
    const current = queue[at];
    if (!current || current.src !== item.src) return;
    queue[at] = paint(item.src, item.name, parsed);
    if (nativeOwns()) nativeMeta(at, queue[at]);
    emit();
  });
}

function arm() {
  shieldAt = 0;
  shieldDur = 0;
  pendingPlay = true;
  if (nativeOwns()) return;
  const chosen = queue[index];
  if (chosen) trackStart(chosen.src, trackFormat(chosen.file));
}

export function skip(step: 1 | -1): boolean {
  if (!queue.length) return false;
  if (nativeOwns()) {
    if (step < 0) nativePrev();
    else nativeNext();
    return true;
  }
  if (step < 0) {
    const prev = history.pop();
    if (prev != null && prev !== index && prev >= 0 && prev < queue.length) {
      index = prev;
      emit();
      arm();
      return true;
    }
  }
  if (shuffle && queue.length > 1 && step > 0) {
    if (!shuffleBag.length) fillBag();
    const pick = shuffleBag.pop();
    if (pick == null) return false;
    history.push(index);
    index = pick;
    emit();
    arm();
    return true;
  }
  let next = index + step;
  if (next >= queue.length) next = repeat === "off" ? -1 : 0;
  if (next < 0) next = repeat === "off" ? -1 : queue.length - 1;
  if (next < 0) return false;
  if (step > 0) history.push(index);
  index = next;
  emit();
  arm();
  return true;
}

function toggleShuffle() {
  shuffle = !shuffle;
  shuffleBag = [];
  if (nativeOwns()) nativeShuffle(shuffle);
  emit();
}

function cycleRepeat() {
  repeat = repeat === "off" ? "all" : repeat === "all" ? "one" : "off";
  if (nativeOwns()) nativeRepeat(repeat);
  emit();
}

function setMode(next: Mode) {
  mode = next;
  emit();
}

function toggleLyrics() {
  lyricsOn = !lyricsOn;
  emit();
}

function clearTrack() {
  ticket += 1;
  queue = [];
  index = 0;
  lyricsOn = false;
  history = [];
  shuffleBag = [];
  shieldAt = 0;
  shieldDur = 0;
  pendingPlay = false;
  nativeStop();
  trackStop();
  emit();
}

function playCurrent() {
  if (!queue[index]) return;
  if (nativeOwns()) {
    pendingPlay = true;
    haptic("light");
    nativePlay();
    savePlayer();
    return;
  }
  if (trackIsPlaying()) {
    syncMedia();
    return;
  }
  pendingPlay = true;
  haptic("light");
  trackPlay();
  savePlayer();
  syncMedia();
}

function pauseCurrent() {
  haptic("light");
  pendingPlay = false;
  if (nativeOwns()) {
    nativePause();
    savePlayer();
    return;
  }
  if (trackIsPlaying()) trackToggle();
  savePlayer();
  syncMedia();
}

function seekSeconds(sec: number) {
  if (!Number.isFinite(sec)) return;
  shieldAt = 0;
  if (nativeOwns()) {
    nativeSeek(sec);
    savePlayer();
    return;
  }
  const length = trackLength() || shieldDur;
  const next = length > 0 ? Math.min(length, Math.max(0, sec)) : Math.max(0, sec);
  trackSeek(next);
  savePlayer();
  syncMedia();
}

function seekRatio(value: number) {
  const length = lengthNow();
  if (!length) return;
  seekSeconds(Math.min(1, Math.max(0, value)) * length);
}

function goPrev() {
  haptic("light");
  if (nativeOwns()) {
    nativePrev();
    return;
  }
  const pos = trackSeek();
  const mark = pos >= 0.25 ? pos : shieldAt;
  if (mark > 3) {
    shieldAt = 0;
    trackSeek(0);
    savePlayer();
    syncMedia();
    return;
  }
  if (!skip(-1)) {
    trackSeek(0);
    savePlayer();
    syncMedia();
  }
}

function goNext() {
  haptic("light");
  if (nativeOwns()) {
    nativeNext();
    return;
  }
  if (!queue.length) return;
  if (queue.length === 1 && repeat !== "off") {
    shieldAt = 0;
    trackSeek(0);
    pendingPlay = true;
    trackPlay();
    savePlayer();
    syncMedia();
    return;
  }
  if (!skip(1) && repeat === "one") {
    shieldAt = 0;
    trackSeek(0);
    pendingPlay = true;
    trackPlay();
    savePlayer();
    syncMedia();
  }
}

export function forgetTrack(id: string) {
  if (!id) return;
  const current = queue[index];
  const left = queue.filter((item) => !item.src.includes(id));
  if (left.length === queue.length) return;
  const droppedCurrent = current ? !left.some((item) => item.src === current.src) : true;
  queue = left;
  if (!queue.length || droppedCurrent) {
    clearTrack();
    return;
  }
  index = Math.min(index, queue.length - 1);
  emit();
}

function handleEnd() {
  if (repeat === "one" || (queue.length === 1 && repeat === "all")) {
    trackSeek(0);
    trackPlay();
    return;
  }
  if (!skip(1)) trackSeek(0);
}

setTrackEnded(handleEnd);
setTrackFailed(() => {
  clearTrack();
});

function applyNative(state: NativePlayerState) {
  if (state.event === "progress" || state.event === "buffering" || state.event === "ready" || state.event === "seek" || state.event === "state") return;
  if (state.event === "error") {
    const chosen = (state.index >= 0 ? queue[state.index] : undefined) ?? queue.find((item) => item.src === state.id);
    if (!chosen) return;
    const at = state.positionMs > 0 ? state.positionMs / 1000 : 0;
    nativeStop();
    pendingPlay = true;
    trackStart(chosen.src, trackFormat(chosen.file), true, at);
    emit();
    return;
  }
  if (state.event === "stop") {
    pendingPlay = false;
    emit();
    return;
  }
  if (state.event === "ended") {
    pendingPlay = false;
    index = 0;
    emit();
    return;
  }
  if (state.index >= 0 && state.index < queue.length) index = state.index;
  else if (state.id) {
    const found = queue.findIndex((item) => item.src === state.id);
    if (found >= 0) index = found;
  }
  if (state.event === "play") pendingPlay = true;
  if (state.event === "pause") pendingPlay = false;
  if (state.repeat === "off" || state.repeat === "one" || state.repeat === "all") repeat = state.repeat;
  shuffle = state.shuffle;
  emit();
}

nativeWatch(applyNative);

function restorePlayer() {
  if (typeof window === "undefined") return;
  type SavedDeck = {
    items?: { src?: unknown; file?: unknown }[];
    index?: unknown;
    mode?: unknown;
    shuffle?: unknown;
    repeat?: unknown;
    lyrics?: unknown;
    at?: unknown;
    dur?: unknown;
    playing?: unknown;
  };
  let saved: SavedDeck | null = null;
  try {
    const raw = sessionStorage.getItem(SAVE_KEY);
    if (raw) saved = JSON.parse(raw) as SavedDeck;
  } catch {
    saved = null;
  }
  const items = (saved?.items ?? [])
    .filter((item): item is { src: string; file: string } => Boolean(item) && typeof item?.src === "string" && typeof item?.file === "string" && allowedSrc(item.src))
    .slice(0, MAX_QUEUE);
  readyToSave = true;
  if (nativeAttach()) {
    const live = nativeState();
    if (live && !items.length) {
      const lone = blank(live.url || live.id, live.title || "Трек");
      lone.title = live.title || lone.title;
      lone.artist = live.artist;
      lone.album = live.album;
      queue = [lone];
      index = 0;
    } else if (items.length) {
      queue = items.map((item) => blank(item.src, item.file));
      const found = live?.id ? queue.findIndex((item) => item.src === live.id) : -1;
      index = found >= 0 ? found : Math.min(Math.max(0, Number(saved?.index) || 0), queue.length - 1);
    }
    mode = saved?.mode === "mini" ? "mini" : "full";
    shuffle = live?.shuffle === true;
    repeat = live?.repeat === "one" || live?.repeat === "all" ? live.repeat : "off";
    lyricsOn = saved?.lyrics === true;
    history = [];
    shuffleBag = [];
    pendingPlay = live?.playWhenReady === true;
    emit();
    if (items.length) {
      const mine = ++ticket;
      void pool(items, 3, async (item, atIndex) => {
        const parsed = await loadTags(item.src, item.file);
        if (mine !== ticket) return;
        const current = queue[atIndex];
        if (!current || current.src !== item.src) return;
        queue[atIndex] = paint(item.src, item.file, parsed);
        if (nativeOwns()) nativeMeta(atIndex, queue[atIndex]);
        emit();
      });
    }
    return;
  }
  if (!items.length) return;
  queue = items.map((item) => blank(item.src, item.file));
  index = Math.min(Math.max(0, Number(saved?.index) || 0), queue.length - 1);
  mode = saved?.mode === "mini" ? "mini" : "full";
  shuffle = saved?.shuffle === true;
  repeat = saved?.repeat === "one" || saved?.repeat === "all" ? saved.repeat : "off";
  lyricsOn = saved?.lyrics === true;
  history = [];
  shuffleBag = [];
  const at = Number(saved?.at);
  const dur = Number(saved?.dur);
  shieldAt = Number.isFinite(at) && at > 0 ? at : 0;
  shieldDur = Number.isFinite(dur) && dur > 0 ? dur : 0;
  pendingPlay = saved?.playing === true;
  emit();
  const mine = ++ticket;
  void pool(
    items,
    3,
    async (item, atIndex) => {
      const parsed = await loadTags(item.src, item.file);
      if (mine !== ticket) return;
      const current = queue[atIndex];
      if (!current || current.src !== item.src) return;
      queue[atIndex] = paint(item.src, item.file, parsed);
      if (nativeOwns()) nativeMeta(atIndex, queue[atIndex]);
      emit();
    },
  );
}

if (typeof window !== "undefined") {
  restorePlayer();
  window.addEventListener("pagehide", () => savePlayer());
  window.setInterval(() => {
    savePlayer();
    if (queue.length) syncMedia();
  }, 2000);
  watchTrack(() => syncMedia());
  if (!nativeAttach()) {
    initMediaSessionHandlers({
      play: playCurrent,
      pause: pauseCurrent,
      next: goNext,
      prev: goPrev,
      seek: seekSeconds,
      stop: clearTrack,
    });
  }
}

let resumed = false;

function resumeSaved() {
  if (resumed) return;
  resumed = true;
  if (nativeOwns()) return;
  const chosen = queue[index];
  if (!chosen) return;
  trackStart(chosen.src, trackFormat(chosen.file), pendingPlay, shieldAt);
}

function clock(value: number) {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const total = Math.floor(value);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

const WAVE_W = 360;
const PERIOD = 48;

function ribbonPath(): string {
  const top: string[] = [];
  const bot: string[] = [];
  const span = WAVE_W + PERIOD;
  const mid = 24;
  const thick = 5.5;
  for (let x = 0; x <= span; x += 4) {
    const y = Math.sin((x / PERIOD) * Math.PI * 2) * 7 + Math.sin((x / PERIOD) * Math.PI * 4) * 2.4;
    top.push(`${x.toFixed(1)} ${(mid + y - thick).toFixed(1)}`);
    bot.push(`${x.toFixed(1)} ${(mid + y + thick).toFixed(1)}`);
  }
  return `M ${top.join(" L ")} L ${[...bot].reverse().join(" L ")} Z`;
}

const RIBBON = ribbonPath();

function WaveSeek({ progress, onSeek }: { progress: number; onSeek: (value: number) => void }) {
  const [motion, setMotion] = useState(true);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setMotion(!media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);
  function at(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = rect.width ? (event.clientX - rect.left) / rect.width : 0;
    onSeek(Math.min(1, Math.max(0, ratio)));
  }
  const width = Math.max(0, Math.min(WAVE_W, progress * WAVE_W));
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Место в треке"
      aria-valuemin={0}
      aria-valuemax={1000}
      aria-valuenow={Math.round(progress * 1000)}
      className="relative h-12 touch-none outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        at(event);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) at(event);
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") onSeek(Math.min(1, progress + 0.02));
        if (event.key === "ArrowLeft") onSeek(Math.max(0, progress - 0.02));
      }}
    >
      <svg viewBox={`0 0 ${WAVE_W} 48`} preserveAspectRatio="none" className="h-full w-full overflow-hidden" aria-hidden="true">
        <defs>
          <clipPath id="vvvion-played">
            <rect x="0" y="0" width={width} height="48" />
          </clipPath>
        </defs>
        <g>
          {motion ? <animateTransform attributeName="transform" type="translate" from="0 0" to={`-${PERIOD} 0`} dur="1.8s" repeatCount="indefinite" /> : null}
          <path d={RIBBON} fill="rgb(255 255 255 / 0.28)" />
        </g>
        <g clipPath="url(#vvvion-played)">
          <g>
            {motion ? <animateTransform attributeName="transform" type="translate" from="0 0" to={`-${PERIOD} 0`} dur="1.8s" repeatCount="indefinite" /> : null}
            <path d={RIBBON} fill="#c4b5e8" />
          </g>
        </g>
      </svg>
      <span
        className="pointer-events-none absolute top-1/2 size-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-[#c4b5e8] bg-white shadow-[0_0_0_6px_rgb(196_181_232_/_0.28)]"
        style={{ left: `${Math.min(100, Math.max(0, progress * 100))}%` }}
      />
    </div>
  );
}

function lineTone(index: number, current: number): string {
  const gap = Math.abs(index - current);
  if (index === current) return "font-serif text-[1.85rem] leading-tight text-white";
  if (gap === 1) return "text-xl leading-snug text-white/70";
  if (gap === 2) return "text-lg leading-snug text-white/40";
  return "text-base leading-snug text-white/25";
}

function Lyrics({ track, at, duration }: { track: Track; at: number; duration: number }) {
  const scroller = useRef<HTMLDivElement>(null);
  const synced = useRef(false);
  const [lines, setLines] = useState<LrcLine[] | null>(null);
  const [plain, setPlain] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    synced.current = false;
    setLines(null);
    setPlain("");
    setNote("");
  }, [track.src]);

  useEffect(() => {
    if (!track.title) return;
    let dead = false;
    void findLyrics({ data: { track: track.title, artist: track.artist, album: track.album, duration } })
      .then((lyric) => {
        if (dead) return;
        if (lyric.instrumental) {
          if (!synced.current) setNote("Инструментал, текста нет.");
          return;
        }
        const next = lyric.synced ? parseLrc(lyric.synced) : [];
        if (next.length) {
          synced.current = true;
          setLines(next);
          setPlain("");
          setNote("");
          return;
        }
        if (synced.current) return;
        if (lyric.plain) setPlain(lyric.plain);
        else setNote("Текст не нашёлся.");
      })
      .catch(() => {
        if (!dead && !synced.current) setNote("Текст не нашёлся.");
      });
    return () => {
      dead = true;
    };
  }, [duration, track.album, track.artist, track.src, track.title]);

  let current = -1;
  if (lines) {
    for (let i = 0; i < lines.length; i += 1) {
      if ((lines[i]?.at ?? 0) <= at + 0.12) current = i;
    }
  }
  const active = lines?.[current];
  let wordAt = -1;
  if (active?.words) {
    for (let i = 0; i < active.words.length; i += 1) {
      if ((active.words[i]?.at ?? 0) <= at + 0.05) wordAt = i;
    }
  }

  useEffect(() => {
    const box = scroller.current;
    const node = box?.querySelector<HTMLElement>("[data-current='1']");
    if (!box || !node) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const top = node.offsetTop - box.clientHeight / 2 + node.clientHeight / 2;
    box.scrollTo({ top: Math.max(0, top), behavior: reduce ? "auto" : "smooth" });
  }, [current, track.src]);

  return (
    <div ref={scroller} className="relative min-h-0 flex-1 overflow-y-auto px-6">
      <div className="h-[28%]" />
      {lines ? (
        lines.map((line, i) => (
          <p key={`${line.at}-${i}`} data-current={i === current ? "1" : undefined} className={cn("py-2 transition-all duration-300", lineTone(i, current))}>
            {i === current && line.words?.length
              ? line.words.map((word, wordIndex) => (
                  <span key={`${word.at}-${wordIndex}`} className={wordIndex <= wordAt ? "text-[#c4b5e8]" : "text-white/80"}>
                    {wordIndex ? " " : ""}
                    {word.text}
                  </span>
                ))
              : line.text}
          </p>
        ))
      ) : plain ? (
        <p className="text-lg whitespace-pre-wrap text-white/80">{plain}</p>
      ) : (
        <p className="text-sm text-white/60">{note || "Ищем текст…"}</p>
      )}
      <div className="h-[42%]" />
    </div>
  );
}

export function MusicCard({ name, src, mine }: { name: string; src: string; mine?: boolean }) {
  const [ready, setReady] = useState(false);
  const [tags, setTags] = useState<MusicTags | null>(null);
  const [cover, setCover] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    setReady(false);
    void loadTags(src, name)
      .then((parsed) => {
        if (dead) return;
        setTags(parsed);
        setCover(coverUrl(parsed.cover));
      })
      .catch(() => undefined)
      .finally(() => {
        if (!dead) setReady(true);
      });
    return () => {
      dead = true;
    };
  }, [name, src]);

  if (!ready) return null;

  const title = tags?.title || name.replace(/\.[^.]+$/, "") || name;
  const sub = [tags?.artist, musicBits(tags, 0)].filter(Boolean).join(" · ");

  return (
    <button
      type="button"
      className={cn("press mt-1.5 flex w-full items-center gap-2 rounded-2xl border px-2 py-2 text-left", mine ? "border-white/25" : "border-line")}
      onClick={() => openAlbum([{ src, name }])}
    >
      {cover ? <img src={cover} alt="" className="size-12 shrink-0 rounded-xl object-cover" /> : (
        <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-subtle">
          <Music2 className="size-4 text-muted" />
        </span>
      )}
      <span className="min-w-0">
        <span className="block truncate text-sm">{title}</span>
        <span className={cn("block truncate text-xs", mine ? "text-accent-fg/75" : "text-faint")}>{sub || "Слушать"}</span>
      </span>
    </button>
  );
}

export function MusicDock() {
  const tx = useTx();
  const deck = useSyncExternalStore(subscribe, () => snapshot, () => SERVER_DECK);
  const [booted, setBooted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const [dur, setDur] = useState(0);
  const trackSrc = deck.track?.src ?? "";

  useEffect(() => {
    setBooted(true);
    resumeSaved();
  }, []);

  useEffect(() => watchTrack(() => setPlaying(playingNow())), []);

  useEffect(() => {
    const stop = nativeWatch(() => {
      setPlaying(playingNow());
      setAt(positionNow());
      setDur(lengthNow() || 0);
    });
    return () => {
      stop();
    };
  }, []);

  useEffect(() => {
    if (!trackSrc) {
      setAt(0);
      setDur(0);
      setPlaying(false);
      return;
    }
    const pull = () => {
      const pos = positionNow();
      const span = lengthNow();
      if (Number.isFinite(pos)) setAt(pos);
      if (span > 0) setDur(span);
      setPlaying(playingNow());
    };
    pull();
    const id = window.setInterval(pull, 80);
    return () => window.clearInterval(id);
  }, [trackSrc]);

  useEffect(() => {
    if (deck.mode !== "full") return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMode("mini");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deck.mode]);

  const miniOpen = booted && deck.track != null && deck.mode === "mini";
  useEffect(() => {
    const root = document.documentElement;
    if (!miniOpen) {
      root.style.removeProperty("--player-dock");
      return;
    }
    root.style.setProperty("--player-dock", "calc(4.75rem + max(0.75rem, env(safe-area-inset-bottom)))");
    return () => {
      root.style.removeProperty("--player-dock");
    };
  }, [miniOpen]);

  if (!booted || !deck.track) return null;
  const current = deck.track;
  const progress = dur > 0 ? Math.min(1, at / dur) : 0;
  const facts = [current.album, current.genre, musicBits(current, 0)].filter(Boolean).join(" · ");

  function toggle() {
    if (playingNow()) pauseCurrent();
    else playCurrent();
    setPlaying(playingNow());
  }

  function seek(value: number) {
    seekRatio(value);
    const length = lengthNow() || dur;
    if (length) setAt(Math.min(length, Math.max(0, value * length)));
  }

  function prev() {
    goPrev();
    setAt(positionNow());
    setPlaying(playingNow());
  }

  function next() {
    goNext();
    setAt(positionNow());
    setPlaying(playingNow());
  }

  return (
    <>
      {deck.mode === "full" ? (
        <div className="fixed inset-0 z-[90] overflow-hidden text-white" role="dialog" aria-modal="true" aria-label={current.title}>
          <div className="pointer-events-none absolute inset-0">
            {current.cover ? <img src={current.cover} alt="" className="player-wash absolute inset-0 size-full object-cover opacity-80 blur-3xl" /> : <div className="player-wash player-mesh absolute inset-0" />}
            <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-black/55 to-black/80" />
          </div>
          <div className="relative flex h-full flex-col">
            <div className="flex items-center justify-between px-3 py-3">
              <button type="button" className="press inline-flex size-11 items-center justify-center rounded-2xl bg-white/10" aria-label="Свернуть" onClick={() => setMode("mini")}>
                <ChevronDown className="size-5" />
              </button>
              <p className="text-xs tracking-[0.16em] uppercase opacity-70">Сейчас играет</p>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className={cn("press inline-flex size-11 items-center justify-center rounded-2xl", deck.lyrics ? "bg-white text-black" : "bg-white/10")}
                  aria-label="Текст"
                  aria-pressed={deck.lyrics}
                  onClick={toggleLyrics}
                >
                  <Captions className="size-4" />
                </button>
                <button type="button" className="press inline-flex size-11 items-center justify-center rounded-2xl bg-white/10" aria-label="Закрыть" onClick={clearTrack}>
                  <X className="size-4" />
                </button>
              </div>
            </div>
            {deck.lyrics ? <Lyrics track={current} at={at} duration={dur} /> : (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6">
                {current.cover ? <img src={current.cover} alt="" className="player-cover size-[min(72vw,18rem)] rounded-3xl object-cover shadow-2xl" /> : (
                  <span className="player-cover grid size-[min(72vw,18rem)] place-items-center rounded-3xl bg-white/10">
                    <Music2 className="size-12" />
                  </span>
                )}
                <p className="mt-6 max-w-full truncate font-serif text-3xl">{current.title}</p>
                <p className="mt-1 max-w-full text-center text-sm text-white/75">
                  {current.artist ? <ArtistNames name={current.artist} className="text-white/75" /> : tx({ ru: "Неизвестный исполнитель", en: "Unknown artist", kk: "Белгісіз орындаушы" })}
                </p>
                {facts ? <p className="mt-1 max-w-full truncate text-xs text-white/50">{facts}</p> : null}
              </div>
            )}
            <div className="px-6 pb-8">
              <WaveSeek progress={progress} onSeek={seek} />
              <div className="mt-1 flex justify-between text-xs tabular-nums text-white/60">
                <span>{clock(at)}</span>
                <span>{clock(dur)}</span>
              </div>
              <div className="mt-4 flex items-center justify-between">
                <button type="button" className={cn("press grid size-11 place-items-center rounded-full", deck.shuffle ? "text-white" : "text-white/40")} aria-label="Перемешать" aria-pressed={deck.shuffle} onClick={toggleShuffle}>
                  <Shuffle className="size-4" />
                </button>
                <button type="button" className="press grid size-12 place-items-center rounded-full text-white" aria-label="Назад" onClick={prev}>
                  <SkipBack className="size-5 fill-current" />
                </button>
                <button type="button" className="press grid size-16 place-items-center rounded-full bg-white text-black" aria-label={playing ? "Пауза" : "Слушать"} onClick={toggle}>
                  {playing ? <Pause className="size-6" /> : <Play className="size-6 fill-current" />}
                </button>
                <button type="button" className="press grid size-12 place-items-center rounded-full text-white" aria-label="Дальше" onClick={next}>
                  <SkipForward className="size-5 fill-current" />
                </button>
                <button
                  type="button"
                  className={cn("press grid size-11 place-items-center rounded-full", deck.repeat === "off" ? "text-white/40" : "text-white")}
                  aria-label={deck.repeat === "one" ? "Повторять трек" : deck.repeat === "all" ? "Повторять всё" : "Повтор выключен"}
                  aria-pressed={deck.repeat !== "off"}
                  onClick={cycleRepeat}
                >
                  {deck.repeat === "one" ? <Repeat1 className="size-4" /> : <Repeat className="size-4" />}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[90] flex items-center gap-2 rounded-2xl border border-line bg-elev px-2 py-2 shadow-[var(--shadow)]">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <button type="button" className="press shrink-0" onClick={() => setMode("full")} aria-label={current.title}>
              {current.cover ? <img src={current.cover} alt="" className="size-11 rounded-xl object-cover" /> : (
                <span className="grid size-11 place-items-center rounded-xl bg-subtle">
                  <Music2 className="size-4" />
                </span>
              )}
            </button>
            <span className="min-w-0 flex-1">
              <button type="button" className="press block max-w-full truncate text-left text-sm" onClick={() => setMode("full")}>{current.title}</button>
              <span className="block truncate text-xs leading-snug text-faint">
                {current.artist ? <ArtistNames name={current.artist} className="text-faint" /> : tx({ ru: "Музыка", en: "Music", kk: "Музыка" })}
              </span>
            </span>
          </div>
          <button type="button" className="press grid size-9 place-items-center rounded-full text-muted" aria-label="Назад" onClick={prev}>
            <SkipBack className="size-4 fill-current" />
          </button>
          <button type="button" className="press grid size-10 place-items-center rounded-full bg-accent text-accent-fg" aria-label={playing ? "Пауза" : "Слушать"} onClick={toggle}>
            {playing ? <Pause className="size-4" /> : <Play className="size-4 fill-current" />}
          </button>
          <button type="button" className="press grid size-9 place-items-center rounded-full text-muted" aria-label="Дальше" onClick={next}>
            <SkipForward className="size-4 fill-current" />
          </button>
          <button type="button" className="press grid size-9 place-items-center rounded-full text-muted" aria-label="Закрыть" onClick={clearTrack}>
            <X className="size-4" />
          </button>
        </div>
      )}
    </>
  );
}
