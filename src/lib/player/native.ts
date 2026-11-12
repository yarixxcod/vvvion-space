import { appHas, isApp } from "@/lib/app-bridge";

export type NativePlayerState = {
  event: "queue" | "track" | "play" | "pause" | "buffering" | "ready" | "seek" | "progress" | "ended" | "error" | "stop" | "sync" | "state";
  available: boolean;
  active: boolean;
  playing: boolean;
  playWhenReady: boolean;
  buffering: boolean;
  state: "idle" | "buffering" | "ready" | "ended";
  index: number;
  count: number;
  id: string;
  url: string;
  title: string;
  artist: string;
  album: string;
  positionMs: number;
  durationMs: number;
  bufferedMs: number;
  repeat: "off" | "one" | "all";
  shuffle: boolean;
  updatedAt: number;
  errorCode?: number;
  errorName?: string;
  message?: string;
};

type Item = { src: string; file: string; title: string; artist: string; album: string; cover: string | null };

export const nativeSupported = () => isApp() && appHas("nativePlayer");

export const nativePlayable = (src: string) => src.startsWith("/api/") || src.startsWith("https://");

let owns = false;
let last: NativePlayerState | null = null;
const subs = new Set<(state: NativePlayerState) => void>();

export const nativeOwns = () => owns;
export const nativeWatch = (fn: (state: NativePlayerState) => void) => {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
};

export function nativeState(): NativePlayerState | null {
  if (!owns) return null;
  const next = window.VvvionApp?.getState?.() ?? last;
  last = next;
  return next ?? null;
}

export function nativePlaying(): boolean {
  return Boolean(last?.playWhenReady);
}

export function nativePosition(): number {
  const state = last;
  if (!state) return 0;
  const ms = state.playing ? state.positionMs + (Date.now() - state.updatedAt) : state.positionMs;
  return Math.min(ms, state.durationMs || ms) / 1000;
}

export function nativeDuration(): number {
  return (last?.durationMs ?? 0) / 1000;
}

function artOf(cover: string | null): string | undefined {
  if (!cover) return undefined;
  if (cover.startsWith("data:image/") || cover.startsWith("https://")) return cover;
  return undefined;
}

export function nativeAttach(): boolean {
  if (!nativeSupported()) return false;
  const state = window.VvvionApp?.getState?.();
  if (!state?.active || !state.id) return false;
  owns = true;
  last = state;
  return true;
}

export function nativeOpen(
  queue: Item[],
  index: number,
  opts: { shuffle: boolean; repeat: "off" | "all" | "one"; autoplay: boolean; positionMs?: number },
): boolean {
  if (!nativeSupported() || !queue.length || !queue.every((track) => nativePlayable(track.src))) return false;
  const items = queue.map((track) => ({
    id: track.src,
    url: track.src,
    title: track.title || track.file,
    artist: track.artist,
    album: track.album,
    artwork: artOf(track.cover),
  }));
  const ok = window.VvvionApp?.setQueue?.(items, index, opts) === true;
  owns = ok;
  if (ok) last = window.VvvionApp?.getState?.() ?? last;
  return ok;
}

export function nativeMeta(index: number, track: Item) {
  if (!owns) return;
  window.VvvionApp?.updateMeta?.({
    index,
    title: track.title || track.file,
    artist: track.artist,
    album: track.album,
    artwork: artOf(track.cover),
  });
}

export function nativePlay() {
  window.VvvionApp?.play?.();
}

export function nativePause() {
  window.VvvionApp?.pause?.();
}

export function nativeNext() {
  window.VvvionApp?.next?.();
}

export function nativePrev() {
  window.VvvionApp?.prev?.();
}

export function nativeSeek(sec: number) {
  window.VvvionApp?.seek?.(Math.max(0, Math.round(sec * 1000)));
}

export function nativeShuffle(on: boolean) {
  window.VvvionApp?.setShuffle?.(on);
}

export function nativeRepeat(mode: "off" | "one" | "all") {
  window.VvvionApp?.setRepeat?.(mode);
}

export function nativeStop() {
  owns = false;
  window.VvvionApp?.stop?.();
}

if (typeof window !== "undefined") {
  window.addEventListener("vvvion-app-player", (event) => {
    const state = (event as CustomEvent<NativePlayerState>).detail;
    if (!state) return;
    if (state.event === "error" || state.event === "stop") owns = false;
    last = state;
    subs.forEach((fn) => fn(state));
  });
}
