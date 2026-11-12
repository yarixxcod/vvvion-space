import { getBearerToken } from "@/lib/auth/client";

type NotifyChannel = "messages" | "ai" | "subs" | "player" | "money" | "security" | "system";

type VvvionApp = {
  isApp?: boolean;
  version?: string;
  notify?: (payload: {
    id: string;
    channel: NotifyChannel;
    title: string;
    body?: string;
    url?: string;
    onlyWhenBackground?: boolean;
  }) => boolean;
  cancelNotification?: (id: string) => void;
  requestNotificationPermission?: () => void;
  notificationsEnabled?: () => boolean;
  openNotificationSettings?: () => void;
  getPushToken?: () => string;
  pushAvailable?: () => boolean;
  haptic?: (type?: string) => void;
  perf?: () => { lowEnd?: boolean; reduceMotion?: boolean; hz?: number; ramMb?: number; lowEndActive?: boolean };
  setLowEnd?: (on: boolean) => void;
  pullToRefresh?: (on: boolean) => void;
  share?: (payload: { text?: string; title?: string; url?: string }) => void;
  badge?: (count: number) => void;
  has?: (feature: string) => boolean;
  features?: string[];
  info?: () => { version?: string; versionCode?: number; webView?: string; webViewMajor?: number };
  debugLog?: () => unknown;
  copy?: (text: string) => void;
  openExternal?: (url: string) => boolean;
  playTrack?: (track: {
    url: string;
    title?: string;
    artist?: string;
    album?: string;
    artwork?: string;
    id?: string;
    positionMs?: number;
    autoplay?: boolean;
    repeat?: "off" | "one" | "all";
    shuffle?: boolean;
  }) => boolean;
  setQueue?: (
    items: { url: string; title?: string; artist?: string; album?: string; artwork?: string; id?: string }[],
    startIndex?: number,
    opts?: { positionMs?: number; autoplay?: boolean; repeat?: "off" | "one" | "all"; shuffle?: boolean },
  ) => boolean;
  play?: () => void;
  pause?: () => void;
  next?: () => void;
  prev?: () => void;
  seek?: (ms: number) => void;
  stop?: () => void;
  setRepeat?: (mode: "off" | "one" | "all") => void;
  setShuffle?: (on: boolean) => void;
  updateMeta?: (meta: { index?: number; title?: string; artist?: string; album?: string; artwork?: string }) => void;
  getState?: () => import("@/lib/player/native").NativePlayerState | null;
};

declare global {
  interface Window {
    VvvionApp?: VvvionApp;
    __vvvionNavigate?: (path: string) => void;
  }
}

export const isApp = () => typeof navigator !== "undefined" && /vvvionApp\//.test(navigator.userAgent);

export function appHas(feature: string): boolean {
  if (typeof window === "undefined") return false;
  const app = window.VvvionApp;
  if (!app) return false;
  if (typeof app.has === "function") {
    try {
      return app.has(feature) === true;
    } catch {
      return false;
    }
  }
  if (Array.isArray(app.features)) return app.features.includes(feature);
  return typeof (app as Record<string, unknown>)[feature] === "function";
}

export async function appCopy(text: string): Promise<boolean> {
  if (appHas("copy")) {
    try {
      window.VvvionApp?.copy?.(text);
      return true;
    } catch {
      /* fall through */
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function appBadge(count: number) {
  if (!isApp() || !appHas("badge")) return;
  if (count > 0 && !appNotificationsEnabled()) return;
  try {
    window.VvvionApp?.badge?.(Math.max(0, Math.floor(count)));
  } catch {
    /* the shell has gone */
  }
}

export async function shareOut(payload: { text?: string; title?: string; url?: string }): Promise<"app" | "native" | "copy" | "cancel"> {
  if (isApp()) {
    try {
      if (appHas("share") && window.VvvionApp?.share) {
        window.VvvionApp.share(payload);
        return "app";
      }
    } catch {
      /* fall through */
    }
  }
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share(payload);
      return "native";
    } catch {
      return "cancel";
    }
  }
  const text = payload.url || payload.text || "";
  if (text) {
    await navigator.clipboard.writeText(text);
    return "copy";
  }
  return "cancel";
}

export function appNotify(payload: {
  id: string;
  channel: NotifyChannel;
  title: string;
  body?: string;
  url?: string;
  onlyWhenBackground?: boolean;
}) {
  if (!isApp()) return false;
  try {
    return appHas("notify") && !!window.VvvionApp?.notify?.({
      ...payload,
      title: payload.title.slice(0, 80),
      body: payload.body?.slice(0, 180),
    });
  } catch {
    return false;
  }
}

export function cancelAppNotification(id: string) {
  if (!isApp()) return;
  try {
    window.VvvionApp?.cancelNotification?.(id);
  } catch {
    /* the shell has gone */
  }
}

export function appAskNotifications() {
  if (!isApp()) return;
  try {
    window.VvvionApp?.requestNotificationPermission?.();
  } catch {
    /* ignore */
  }
}

export function appNotificationsEnabled() {
  if (!isApp()) return false;
  try {
    return window.VvvionApp?.notificationsEnabled?.() === true;
  } catch {
    return false;
  }
}

export function appOpenNotificationSettings() {
  if (!isApp()) return;
  try {
    window.VvvionApp?.openNotificationSettings?.();
  } catch {
    /* ignore */
  }
}

function authHeaders() {
  const headers = new Headers({ "content-type": "application/json" });
  const token = getBearerToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

let lastToken = "";
let inflight: Promise<void> | null = null;
let showPreview = false;
let bridgeReady = false;
let loggedIn: () => boolean = () => false;

export function messagePreviewOn() {
  return showPreview;
}

export function rememberPreview(value: boolean) {
  showPreview = value;
}

export async function loadPushSettings() {
  try {
    const res = await fetch("/api/push/settings", { method: "GET", credentials: "same-origin", headers: authHeaders() });
    if (!res.ok) return;
    const data = (await res.json()) as { preview?: boolean };
    showPreview = data.preview === true;
  } catch {
    /* offline */
  }
}

export async function registerPushToken(token?: string) {
  if (!isApp()) return;
  const next = token || window.VvvionApp?.getPushToken?.() || "";
  if (!next || next === lastToken) return;
  if (inflight) return inflight;
  inflight = fetch("/api/push/register", {
    method: "POST",
    credentials: "same-origin",
    headers: authHeaders(),
    body: JSON.stringify({ token: next, platform: "android", appVersion: window.VvvionApp?.version ?? "" }),
  })
    .then((res) => {
      if (res.ok) lastToken = next;
    })
    .catch(() => undefined)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export async function unregisterPushToken() {
  const token = typeof window !== "undefined" ? window.VvvionApp?.getPushToken?.() || lastToken : "";
  lastToken = "";
  if (!token) return;
  await fetch("/api/push/unregister", {
    method: "POST",
    credentials: "same-origin",
    headers: authHeaders(),
    body: JSON.stringify({ token }),
  }).catch(() => undefined);
}

function tryRegister() {
  if (loggedIn()) void registerPushToken();
  if (loggedIn()) void loadPushSettings();
}

export function initAppBridge(isLoggedIn: () => boolean) {
  loggedIn = isLoggedIn;
  if (!isApp()) return;
  if (!bridgeReady && typeof window !== "undefined") {
    bridgeReady = true;
    window.addEventListener("vvvion-app-ready", tryRegister);
    window.addEventListener("vvvion-app-push-token", (event) => {
      const token = (event as CustomEvent<{ token?: string }>).detail?.token;
      if (loggedIn()) void registerPushToken(token);
    });
  }
  tryRegister();
}
