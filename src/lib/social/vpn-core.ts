export type VpnUsage = { upload: number; download: number } | null;

export type Access = "ok" | "expired" | "blocked" | "missing" | "quota";

const VLESS_ID = /^vless:\/\/([0-9a-f-]{36})@/i;
const HY_AUTH = /^(hy2|hysteria2):\/\/([^@\s]+)@/i;

export function accessOf(input: {
  found: boolean;
  untilMs: number;
  now: number;
  blocked: boolean;
  used: number | null;
  quota: number;
}): Access {
  if (!input.found) return "missing";
  if (input.blocked) return "blocked";
  if (!Number.isFinite(input.untilMs) || input.untilMs <= input.now) return "expired";
  if (input.used != null && input.quota > 0 && input.used >= input.quota) return "quota";
  return "ok";
}

export function usageKnown(usage: VpnUsage): usage is { upload: number; download: number } {
  return usage != null && Number.isFinite(usage.upload) && Number.isFinite(usage.download) && usage.upload >= 0 && usage.download >= 0;
}

export function usedBytes(usage: VpnUsage): number | null {
  if (!usageKnown(usage)) return null;
  return usage.upload + usage.download;
}

/** Subscription header. Unknown usage is omitted — never reported as zero. */
export function subscriptionInfo(usage: VpnUsage, quota: number, expireSec: number): string {
  const expire = Number.isFinite(expireSec) ? Math.max(0, Math.floor(expireSec)) : 0;
  const total = Number.isFinite(quota) && quota > 0 ? Math.floor(quota) : 0;
  if (!usageKnown(usage)) return `total=${total}; expire=${expire}`;
  return `upload=${Math.floor(usage.upload)}; download=${Math.floor(usage.download)}; total=${total}; expire=${expire}`;
}

export function personalUri(
  template: string,
  secret: string,
  name: string,
  enrolled: boolean,
): { uri: string; shared: boolean } | null {
  const raw = template.trim();
  if (!raw || !secret) return null;
  const titled = name.trim() ? `${raw.includes("#") ? raw.slice(0, raw.indexOf("#")) : raw}#${encodeURIComponent(name.trim())}` : raw;
  if (!enrolled) return { uri: titled, shared: true };
  if (raw.includes("{secret}")) {
    const next = raw.replaceAll("{secret}", encodeURIComponent(secret));
    const base = next.includes("#") ? next.slice(0, next.indexOf("#")) : next;
    return { uri: `${base}#${encodeURIComponent(name.trim() || "VVVION")}`, shared: false };
  }
  if (VLESS_ID.test(raw)) {
    const next = raw.replace(VLESS_ID, `vless://${secret}@`);
    const base = next.includes("#") ? next.slice(0, next.indexOf("#")) : next;
    return { uri: `${base}#${encodeURIComponent(name.trim() || "VVVION")}`, shared: false };
  }
  const hy = HY_AUTH.exec(raw);
  if (hy) {
    const next = raw.replace(HY_AUTH, `${hy[1].toLowerCase()}://${encodeURIComponent(secret)}@`);
    const base = next.includes("#") ? next.slice(0, next.indexOf("#")) : next;
    return { uri: `${base}#${encodeURIComponent(name.trim() || "VVVION")}`, shared: false };
  }
  return null;
}

export function pullLimit(count: number, limit = 40): "ok" | "limited" {
  if (!Number.isFinite(count) || count < 0) return "ok";
  return count >= limit ? "limited" : "ok";
}

export type Bill = "idempotent" | "charge" | "short" | "repair";

export function billingStep(input: { balance: number; price: number; charged: boolean; pass: boolean }): Bill {
  if (input.charged && input.pass) return "idempotent";
  if (input.charged && !input.pass) return "repair";
  if (input.balance < input.price) return "short";
  return "charge";
}

export function deviceRoom(count: number, cap: number): boolean {
  return count >= 0 && cap > 0 && count < cap;
}

export type Reminder = "7d" | "3d" | "1d" | "expired" | "traffic80" | "traffic95" | null;

const DAY = 86_400_000;

export function expiryReminder(now: number, untilMs: number): Reminder {
  if (!Number.isFinite(now) || !Number.isFinite(untilMs)) return null;
  const left = untilMs - now;
  if (left <= 0 && left > -DAY) return "expired";
  if (left > 6 * DAY && left <= 7 * DAY) return "7d";
  if (left > 2 * DAY && left <= 3 * DAY) return "3d";
  if (left > 0 && left <= DAY) return "1d";
  return null;
}

export function trafficReminder(used: number | null, quota: number): Reminder {
  if (used == null || quota <= 0) return null;
  const pct = used / quota;
  if (pct >= 0.95) return "traffic95";
  if (pct >= 0.8) return "traffic80";
  return null;
}

export function sharedCredential(uri: string): { protocol: "vless" | "hy2"; secret: string } | null {
  const raw = uri.trim();
  const vless = /^vless:\/\/([0-9a-f-]{36})@/i.exec(raw);
  if (vless?.[1]) return { protocol: "vless", secret: vless[1].toLowerCase() };
  const hy = /^(?:hy2|hysteria2):\/\/([^@\s]+)@/i.exec(raw);
  if (!hy?.[1]) return null;
  try {
    return { protocol: "hy2", secret: decodeURIComponent(hy[1]) };
  } catch {
    return { protocol: "hy2", secret: hy[1] };
  }
}

/** First report is a baseline, so a counter restart does not wipe already counted use. */
export function nextBaseline(prevAbs: number | null, prevBase: number | null, nextAbs: number): number {
  if (!Number.isFinite(nextAbs) || nextAbs < 0) return prevBase ?? 0;
  const next = Math.floor(nextAbs);
  if (prevAbs == null || prevBase == null || !Number.isFinite(prevAbs) || !Number.isFinite(prevBase)) return next;
  const used = Math.max(0, Math.floor(prevAbs) - Math.floor(prevBase));
  if (next >= Math.floor(prevAbs)) return Math.floor(prevBase);
  return next - used;
}

export function counterDelta(prev: number | null, next: number): number {
  if (prev == null || !Number.isFinite(prev) || !Number.isFinite(next) || next < 0) return 0;
  return Math.max(0, Math.floor(next) - Math.floor(prev));
}

export function accountedBytes(upload: number, uploadBase: number, download: number, downloadBase: number): number {
  return Math.max(0, Math.floor(upload) - Math.floor(uploadBase)) + Math.max(0, Math.floor(download) - Math.floor(downloadBase));
}

/** Account slot is always present. Named devices stop at the plan cap, oldest first. */
export function openSlots(deviceIds: string[], cap: number): string[] {
  const extra = deviceIds.filter((id) => id.length > 0).slice(0, Math.max(0, Math.floor(cap)));
  return ["", ...extra];
}

export function keyEmail(userId: string, deviceId: string): string {
  const id = userId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 48);
  const device = (deviceId || "account").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 48);
  return `vvvion:${id}:${device}`;
}

export function purchaseOutcome(input: { balance: number; price: number; transferExists: boolean; passExists: boolean }): Bill {
  if (input.transferExists && input.passExists) return "idempotent";
  if (input.transferExists && !input.passExists) return "repair";
  if (!(input.balance >= input.price)) return "short";
  return "charge";
}

/** Same idempotency key can charge once. A second distinct purchase needs a second price on the balance. */
export function concurrentCharges(input: { balance: number; price: number; sameKey: boolean }): 0 | 1 | 2 {
  if (!(input.price > 0) || !(input.balance >= input.price)) return 0;
  if (input.sameKey) return 1;
  return input.balance >= input.price * 2 ? 2 : 1;
}

export function nextUntil(now: number, current: number | null, days: number): number {
  const base = current != null && current > now ? current : now;
  return base + days * 86_400_000;
}

export type AgentMark = { enrolled: boolean; reach: "up" | "down" | "unknown" };

/** An HTTP reply is not a VPN session. Enrollment flips only after the agent applied the client list. */
export function afterAgent(input: { wasEnrolled: boolean; event: "seen" | "applied" | "apply-failed" | "down" | "up" | "http" }): AgentMark {
  if (input.event === "seen" || input.event === "http") return { enrolled: input.wasEnrolled, reach: "unknown" };
  if (input.event === "applied") return { enrolled: true, reach: "up" };
  if (input.event === "apply-failed" || input.event === "down") return { enrolled: input.wasEnrolled, reach: "down" };
  return { enrolled: input.wasEnrolled, reach: "up" };
}

export function clientsToInstall(input: { secrets: string[]; dropShared: boolean; shared: string | null }): { secrets: string[]; sharedKept: boolean } {
  return { secrets: input.secrets.filter((item) => item.length > 0), sharedKept: !input.dropShared && Boolean(input.shared) };
}

export function syncState(input: { applyError: string; retryApplied: boolean }): "error" | "ok" {
  if (input.retryApplied) return "ok";
  return input.applyError ? "error" : "ok";
}

export function recovery(input: { charged: boolean; pass: boolean; agentApplied: boolean; vpsReachable: boolean }): "repair-pass" | "vps-down" | "wait-agent" | "ok" | "needs-purchase" {
  if (input.charged && !input.pass) return "repair-pass";
  if (!input.vpsReachable) return "vps-down";
  if (!input.agentApplied) return "wait-agent";
  if (input.pass) return "ok";
  return "needs-purchase";
}

export function noticeAnchor(kind: string, anchor: string): string {
  return `${kind}:${anchor}`;
}

export function tokenRejected(previous: string, current: string): boolean {
  return previous.length > 0 && current.length > 0 && previous !== current;
}

export function daysLeft(now: number, untilMs: number): number {
  if (!Number.isFinite(untilMs) || untilMs <= now) return 0;
  return Math.ceil((untilMs - now) / DAY);
}

export function newHySecret(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
