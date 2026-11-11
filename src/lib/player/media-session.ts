type Track = { title: string; artist?: string; album?: string; cover?: string | null };

function artType(src: string) {
  if (src.startsWith("data:image/png")) return "image/png";
  if (src.startsWith("data:image/webp")) return "image/webp";
  if (src.startsWith("data:image/gif")) return "image/gif";
  return "image/jpeg";
}

export function syncMediaSession(t: Track | null, playing: boolean, pos: number, dur: number) {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
  const ms = navigator.mediaSession;
  if (!t) {
    ms.metadata = null;
    ms.playbackState = "none";
    return;
  }
  const cover = t.cover || "";
  ms.metadata = new MediaMetadata({
    title: t.title,
    artist: t.artist || "",
    album: t.album || "",
    artwork: cover ? [{ src: cover, sizes: "512x512", type: artType(cover) }] : [],
  });
  ms.playbackState = playing ? "playing" : "paused";
  try {
    if (dur > 0) ms.setPositionState({ duration: dur, position: Math.min(Math.max(0, pos), dur), playbackRate: 1 });
  } catch {
    /* some browsers reject position before playback starts */
  }
}

let handlersSet = false;
export function initMediaSessionHandlers(api: {
  play(): void;
  pause(): void;
  next(): void;
  prev(): void;
  seek(sec: number): void;
  stop(): void;
}) {
  if (handlersSet || typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
  handlersSet = true;
  const set = (action: MediaSessionAction, handler: MediaSessionActionHandler) => {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      /* this action is not supported here */
    }
  };
  set("play", () => api.play());
  set("pause", () => api.pause());
  set("nexttrack", () => api.next());
  set("previoustrack", () => api.prev());
  set("seekto", (detail) => {
    if (typeof detail.seekTime === "number") api.seek(detail.seekTime);
  });
  set("stop", () => api.stop());
}
