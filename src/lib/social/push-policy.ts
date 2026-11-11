export type PushKind = "messages" | "ai" | "subs" | "money" | "security" | "system";
export type PushSettings = {
  messages: boolean;
  ai: boolean;
  subs: boolean;
  money: boolean;
  security: boolean;
  system: boolean;
  preview: boolean;
  quietFrom: number;
  quietTo: number;
};
export type SubWindow = "3d" | "1d" | "expired";
export type SubProduct = "mega" | "premium" | "vpn";

export const PUSH_DEFAULTS: PushSettings = {
  messages: true,
  ai: true,
  subs: true,
  money: true,
  security: true,
  system: false,
  preview: false,
  quietFrom: 23,
  quietTo: 8,
};

const DAY = 86_400_000;

export function validPushToken(token: unknown): token is string {
  if (typeof token !== "string") return false;
  if (token.length < 100 || token.length > 4096) return false;
  if (/[\s\u0000-\u001f]/.test(token)) return false;
  return true;
}

/** Site path only. Rejects absolute URLs, protocol-relative paths and whitespace. */
export function validPushPath(url: unknown): url is string {
  if (typeof url !== "string") return false;
  if (url.length < 1 || url.length > 300) return false;
  if (!url.startsWith("/") || url.startsWith("//")) return false;
  if (/[\s\\]/.test(url) || url.includes("://") || url.includes("..")) return false;
  return true;
}

export function clipText(value: string, max: number) {
  return value.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function flag(value: unknown, fallback: boolean) {
  if (value === true || value === 1 || value === "t" || value === "true") return true;
  if (value === false || value === 0 || value === "f" || value === "false") return false;
  return fallback;
}

function hour(value: unknown, fallback: number) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 23) return fallback;
  return n;
}

export function settingsFrom(row: Partial<PushSettings> | null | undefined): PushSettings {
  return {
    messages: flag(row?.messages, true),
    ai: flag(row?.ai, true),
    subs: flag(row?.subs, true),
    money: flag(row?.money, true),
    security: true,
    system: flag(row?.system, false),
    preview: flag(row?.preview, false),
    quietFrom: hour(row?.quietFrom, 23),
    quietTo: hour(row?.quietTo, 8),
  };
}

/** Quiet hours wrap past midnight. Security is never quiet. Hours are Moscow time. */
export function inQuietHours(settings: Pick<PushSettings, "quietFrom" | "quietTo">, now = new Date()): boolean {
  const from = settings.quietFrom;
  const to = settings.quietTo;
  if (from === to) return false;
  const clock = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Europe/Moscow" }).format(now));
  if (!Number.isFinite(clock)) return false;
  if (from < to) return clock >= from && clock < to;
  return clock >= from || clock < to;
}

export function pushTtl(kind: PushKind) {
  return kind === "messages" || kind === "ai" ? "3600s" : "86400s";
}

export function pushPriority(kind: PushKind) {
  return kind === "messages" || kind === "security" || kind === "money" ? "HIGH" : "NORMAL";
}

/** 3-day window is (now+2d, now+3d]; 1-day window is (now, now+1d]. */
export function subWindow(now: number, endsAt: number): SubWindow | null {
  if (!Number.isFinite(now) || !Number.isFinite(endsAt)) return null;
  if (endsAt > now + 2 * DAY && endsAt <= now + 3 * DAY) return "3d";
  if (endsAt > now && endsAt <= now + DAY) return "1d";
  return null;
}

export function subRef(endsAt: Date) {
  return endsAt.toISOString().slice(0, 10);
}

export function subCopy(product: SubProduct, window: SubWindow) {
  if (product === "vpn") {
    return { title: "VPN", body: window === "1d" ? "VPN закончится завтра" : "VPN закончится через 3 дня", url: "/c/services", id: "sub:vpn" };
  }
  if (product === "mega" && window === "expired") {
    return { title: "MegaDisk", body: "MegaDisk закончился", url: "/disk", id: "sub:mega:expired" };
  }
  if (product === "premium" && window === "expired") {
    return { title: "Премиум", body: "Премиум закончился", url: "/c/shop", id: "sub:premium:expired" };
  }
  if (product === "mega" && window === "3d") {
    return { title: "MegaDisk", body: "MegaDisk: подписка заканчивается через 3 дня", url: "/disk", id: "sub:mega:3d" };
  }
  if (product === "mega") {
    return { title: "MegaDisk", body: "MegaDisk закончится завтра", url: "/disk", id: "sub:mega:1d" };
  }
  if (window === "3d") {
    return { title: "Премиум", body: "Премиум: подписка заканчивается через 3 дня", url: "/c/shop", id: "sub:premium:3d" };
  }
  return { title: "Премиум", body: "Премиум закончится завтра", url: "/c/shop", id: "sub:premium:1d" };
}

export function subKind(product: SubProduct, window: SubWindow) {
  return `${product}_${window}`;
}
