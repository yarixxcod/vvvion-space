import { HowlPlayer, HowlerPlayer } from "@/lib/vendor/howler-2.2.4.js";

const KEY = "vvvion.sounds";
const PACK_KEY = "vvvion.sound-pack";

const SRC = {
  message: "/sounds/message.mp3",
  notice: "/sounds/notice.mp3",
  fail: "/sounds/fail.mp3",
} as const;

export type SoundName = keyof typeof SRC;
export type SoundPack = "soft" | "glass" | "wood" | "pulse" | "drop";

const PACKS: SoundPack[] = ["soft", "glass", "wood", "pulse", "drop"];

type HowlLike = {
  play: () => number;
  pause: () => unknown;
  stop: () => unknown;
  seek: (to?: number) => number | HowlLike;
  duration: () => number;
  playing: () => boolean;
  volume: (value?: number) => number | HowlLike;
  rate: (value?: number) => number | HowlLike;
  on: (event: string, fn: () => void) => unknown;
  once: (event: string, fn: () => void) => unknown;
  unload: () => void;
};

type HowlOptions = {
  src: string[];
  volume?: number;
  html5?: boolean;
  format?: string[];
  preload?: boolean;
  xhr?: { withCredentials?: boolean };
};

type HtmlNode = HTMLAudioElement & { _unlocked?: boolean };

declare global {
  interface Window {
    Howl?: new (options: HowlOptions) => HowlLike;
    Howler?: {
      codecs?: (ext: string) => boolean;
      _html5AudioPool?: HtmlNode[];
    };
  }
}

const cache = new Map<SoundName, HowlLike>();
let lastMessage = 0;

export function soundsEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundsEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new Event("vvvion-sounds"));
}

export function soundPack(): SoundPack {
  try {
    const raw = localStorage.getItem(PACK_KEY);
    if (raw === "glass" || raw === "wood" || raw === "pulse" || raw === "drop" || raw === "soft") return raw;
  } catch {
    /* private mode */
  }
  return "soft";
}

export function setSoundPack(pack: SoundPack) {
  try {
    localStorage.setItem(PACK_KEY, PACKS.includes(pack) ? pack : "soft");
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new Event("vvvion-sounds"));
}

function playPack(pack: Exclude<SoundPack, "soft">, name: SoundName) {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return;
  const ctx = new Ctx();
  const now = ctx.currentTime;
  const shape =
    pack === "glass"
      ? name === "fail"
        ? [{ f: 340, t: 0, d: 0.22, type: "triangle" as const }]
        : [{ f: 880, t: 0, d: 0.12, type: "sine" as const }, { f: 1320, t: 0.08, d: 0.16, type: "sine" as const }]
      : pack === "wood"
        ? [{ f: name === "fail" ? 140 : 220, t: 0, d: 0.14, type: "triangle" as const }]
        : pack === "pulse"
          ? [{ f: name === "fail" ? 180 : 520, t: 0, d: 0.08, type: "square" as const }, { f: name === "fail" ? 140 : 520, t: 0.12, d: 0.08, type: "square" as const }]
          : [{ f: name === "fail" ? 420 : 720, t: 0, d: 0.28, type: "sine" as const }];
  for (const step of shape) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = step.type;
    osc.frequency.setValueAtTime(step.f, now + step.t);
    if (pack === "drop") osc.frequency.exponentialRampToValueAtTime(Math.max(80, step.f / 3), now + step.t + step.d);
    gain.gain.setValueAtTime(0.0001, now + step.t);
    gain.gain.exponentialRampToValueAtTime(pack === "pulse" ? 0.05 : 0.12, now + step.t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + step.t + step.d);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + step.t);
    osc.stop(now + step.t + step.d + 0.02);
  }
  window.setTimeout(() => void ctx.close().catch(() => undefined), 800);
}

function attachHowler() {
  if (typeof window === "undefined") return;
  if (!window.Howl && HowlPlayer) window.Howl = HowlPlayer;
  if (!window.Howler && HowlerPlayer) window.Howler = HowlerPlayer;
}

export function loadHowler(): Promise<void> {
  attachHowler();
  return Promise.resolve();
}

export function trackFormat(name: string): string {
  const ext = /\.(mp3|flac|wav|ogg|opus|m4a|aac|webm|mp4)$/i.exec(name)?.[1]?.toLowerCase() ?? "mp3";
  if (ext === "aac" || ext === "mp4") return "m4a";
  if (ext === "opus") return "ogg";
  return ext;
}

export type TrackHowl = {
  play: () => void;
  pause: () => void;
  seek: (to?: number) => number;
  duration: () => number;
  playing: () => boolean;
  on: (event: string, fn: () => void) => void;
  unload: () => void;
};

let live: { src: string; howl: HowlLike } | null = null;
let onEnded: (() => void) | null = null;
let onTrackFailed: (() => void) | null = null;
let trackTicket = 0;
let speaker: HtmlNode | null = null;
let ignoreEnd = false;
const trackHooks = new Set<() => void>();

function pokeTrack() {
  for (const fn of trackHooks) fn();
}

function pool(): HtmlNode[] | null {
  const bag = window.Howler?._html5AudioPool;
  return Array.isArray(bag) ? bag : null;
}

function pull(node: HtmlNode | null) {
  const bag = pool();
  if (!node || !bag) return;
  const at = bag.indexOf(node);
  if (at >= 0) bag.splice(at, 1);
}

function elementOf(howl: HowlLike | null | undefined): HtmlNode | null {
  const sounds = (howl as (HowlLike & { _sounds?: { _node?: unknown }[] }) | null | undefined)?._sounds;
  const node = sounds?.[0]?._node;
  return node instanceof HTMLAudioElement ? (node as HtmlNode) : null;
}

function onSpeakerEnded() {
  if (ignoreEnd || !live || !speaker || !speaker.ended) return;
  if (speaker.src.startsWith("data:")) return;
  pokeTrack();
  onEnded?.();
}

function bindSpeaker(node: HtmlNode) {
  mountSpeaker(node);
  if (speaker && speaker !== node) speaker.removeEventListener("ended", onSpeakerEnded);
  speaker = node;
  speaker.removeEventListener("ended", onSpeakerEnded);
  speaker.addEventListener("ended", onSpeakerEnded);
  speaker.removeEventListener("playing", pokeTrack);
  speaker.addEventListener("playing", pokeTrack);
  speaker.removeEventListener("loadedmetadata", pokeTrack);
  speaker.addEventListener("loadedmetadata", pokeTrack);
}

function mountSpeaker(node: HtmlNode) {
  node.preload = "auto";
  node.volume = 1;
  node.setAttribute("playsinline", "true");
  node._unlocked = true;
  if (!node.isConnected && document.body) {
    node.setAttribute("aria-hidden", "true");
    node.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;opacity:0;pointer-events:none";
    document.body.appendChild(node);
  }
}

function ownSpeaker(): HtmlNode {
  if (speaker) return speaker;
  const node = document.createElement("audio") as HtmlNode;
  mountSpeaker(node);
  speaker = node;
  node.addEventListener("ended", onSpeakerEnded);
  node.addEventListener("playing", pokeTrack);
  node.addEventListener("loadedmetadata", pokeTrack);
  return node;
}

function offerSpeaker() {
  const node = ownSpeaker();
  const bag = pool();
  if (!bag) return;
  pull(node);
  node._unlocked = true;
  bag.push(node);
}

function gateFormat(format: string): string {
  const wanted = format || "mp3";
  return window.Howler?.codecs?.(wanted) ? wanted : "mp3";
}

let resumeOnce: ((event: Event) => void) | null = null;

function dropGesture() {
  if (!resumeOnce || typeof window === "undefined") return;
  window.removeEventListener("pointerdown", resumeOnce);
  window.removeEventListener("keydown", resumeOnce);
  resumeOnce = null;
}

function armGesture(node: HtmlNode) {
  dropGesture();
  const go = (event: Event) => {
    const target = event.target;
    if (target instanceof Element && target.closest("[aria-label='Слушать'], [aria-label='Пауза']")) return;
    dropGesture();
    const current = elementOf(live?.howl) ?? (live ? speaker : null);
    if (current === node && node.paused) kick(node);
  };
  resumeOnce = go;
  window.addEventListener("pointerdown", go);
  window.addEventListener("keydown", go);
}

function placeAt(node: HtmlNode, at: number) {
  if (!(at > 0.05)) return;
  const apply = () => {
    try {
      if (Math.abs((node.currentTime || 0) - at) > 0.35) node.currentTime = at;
    } catch {
      /* metadata is not in yet */
    }
  };
  apply();
  if (node.readyState < 1) node.addEventListener("loadedmetadata", apply, { once: true });
}

function kick(node: HtmlNode) {
  node._unlocked = true;
  node.volume = 1;
  const pending = node.play();
  if (pending && typeof pending.then === "function") {
    pending.then(
      () => {
        dropGesture();
        pokeTrack();
      },
      (err: unknown) => {
        pokeTrack();
        const name = err && typeof err === "object" && "name" in err ? String((err as { name: string }).name) : "";
        if (name === "NotAllowedError") armGesture(node);
      },
    );
  }
}

export function watchTrack(fn: () => void) {
  trackHooks.add(fn);
  return () => {
    trackHooks.delete(fn);
  };
}

export function setTrackEnded(fn: () => void) {
  onEnded = fn;
}

export function setTrackFailed(fn: () => void) {
  onTrackFailed = fn;
}

export function trackSeek(to?: number): number {
  const node = elementOf(live?.howl) ?? (live ? speaker : null);
  if (!node) return 0;
  if (typeof to === "number") {
    try {
      node.currentTime = to;
    } catch {
      /* metadata is not in yet */
    }
    pokeTrack();
    return to;
  }
  return Number.isFinite(node.currentTime) ? node.currentTime : 0;
}

export function trackLength(): number {
  const node = elementOf(live?.howl);
  const value = node?.duration ?? 0;
  return Number.isFinite(value) ? value : 0;
}

export function trackIsPlaying(): boolean {
  const node = elementOf(live?.howl) ?? (live ? speaker : null);
  return Boolean(node && !node.paused && !node.ended);
}

export function trackPlay() {
  const node = elementOf(live?.howl) ?? (live ? speaker : null);
  if (!node) return;
  kick(node);
  pokeTrack();
}

export function trackToggle() {
  const node = elementOf(live?.howl) ?? (live ? speaker : null);
  if (!node || !live) return;
  if (!node.paused && !node.ended) node.pause();
  else {
    if (node.error && live.src) {
      node.src = live.src;
      node.load();
    }
    kick(node);
  }
  pokeTrack();
}

export function trackStop() {
  ignoreEnd = true;
  dropGesture();
  live?.howl.unload();
  pull(speaker);
  ignoreEnd = false;
  live = null;
  pokeTrack();
}

export function trackStart(src: string, format: string, autoplay = true, at = 0) {
  if (typeof window === "undefined" || !src) return;
  attachHowler();
  dropGesture();
  const same = elementOf(live?.howl);
  if (live?.src === src && same) {
    placeAt(same, at);
    if (autoplay) kick(same);
    else same.pause();
    pokeTrack();
    return;
  }
  ignoreEnd = true;
  live?.howl.unload();
  pull(speaker);
  ignoreEnd = false;
  live = null;
  const mine = ++trackTicket;
  const run = (fmt: string, tried: boolean) => {
    const Howl = window.Howl;
    if (!Howl || mine !== trackTicket) return;
    // Pool must already hold our element. Otherwise Howler calls
    // `new Audio().play()` first and the phone spends the tap on that.
    offerSpeaker();
    const howl = new Howl({
      src: [src],
      html5: true,
      format: [gateFormat(fmt)],
      volume: 1,
      preload: true,
      xhr: { withCredentials: true },
    });
    const node = elementOf(howl);
    if (!node) {
      howl.unload();
      pull(speaker);
      if (!tried) run("mp3", true);
      return;
    }
    if (speaker && speaker !== node) pull(speaker);
    bindSpeaker(node);
    live = { src, howl };
    howl.on("load", () => {
      placeAt(node, at);
      pokeTrack();
    });
    node.preload = "metadata";
    const pokeMeta = () => pokeTrack();
    node.addEventListener("loadedmetadata", pokeMeta);
    node.addEventListener("durationchange", pokeMeta);
    howl.on("loaderror", () => {
      pokeTrack();
      const code = node.error?.code ?? 0;
      if (code === 2 || code === 4) onTrackFailed?.();
    });
    placeAt(node, at);
    if (autoplay) kick(node);
    pokeTrack();
  };
  if (window.Howl) run(format || "mp3", false);
}

if (typeof window !== "undefined") attachHowler();

export async function openTrack(src: string, format: string): Promise<TrackHowl> {
  await loadHowler();
  const Howl = window.Howl;
  if (!Howl) throw new Error("Плеер не открылся");
  const howl = new Howl({
    src: [src],
    html5: true,
    format: [format || "mp3"],
    volume: 1,
    preload: true,
    xhr: { withCredentials: true },
  });
  howl.volume(1);
  const position = (to?: number) => {
    const now = typeof to === "number" ? howl.seek(to) : howl.seek();
    return typeof now === "number" && Number.isFinite(now) ? now : typeof to === "number" ? to : 0;
  };
  return {
    play: () => {
      howl.play();
    },
    pause: () => {
      howl.pause();
    },
    seek: position,
    duration: () => {
      const value = howl.duration();
      return Number.isFinite(value) ? value : 0;
    },
    playing: () => howl.playing(),
    on: (event, fn) => {
      howl.on(event, fn);
    },
    unload: () => howl.unload(),
  };
}

export function playSound(name: SoundName, force = false) {
  if (typeof window === "undefined") return;
  if (!force && !soundsEnabled()) return;
  if (name === "message") {
    const now = Date.now();
    if (now - lastMessage < 1200) return;
    lastMessage = now;
  }
  const pack = soundPack();
  if (pack !== "soft") {
    playPack(pack, name);
    return;
  }
  void loadHowler()
    .then(() => {
      const Howl = window.Howl;
      if (!Howl) return;
      let howl = cache.get(name);
      if (!howl) {
        howl = new Howl({ src: [SRC[name]], volume: name === "fail" ? 0.38 : 0.5, html5: true });
        cache.set(name, howl);
      }
      howl.play();
    })
    .catch(() => undefined);
}
