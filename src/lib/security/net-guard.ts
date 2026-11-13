import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";

export type LookupFn = (host: string) => Promise<{ address: string; family: number }[]>;

const DEFAULT_LOOKUP: LookupFn = async (host) => {
  const rows = await lookup(host, { all: true, verbatim: true });
  return rows.map((row) => ({ address: row.address, family: row.family }));
};

export function hostMatches(host: string, domain: string): boolean {
  const name = host.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  const root = domain.toLowerCase().replace(/\.$/, "");
  return name === root || name.endsWith(`.${root}`);
}

export function hostInList(host: string, domains: readonly string[]): boolean {
  return domains.some((domain) => hostMatches(host, domain));
}

function ipv4Blocked(parts: number[]): boolean {
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0 && parts[2] === 0) return true;
  if (a === 192 && b === 0 && parts[2] === 2) return true;
  if (a === 198 && b === 51 && parts[2] === 100) return true;
  if (a === 203 && b === 0 && parts[2] === 113) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

export function isBlockedIp(ip: string): boolean {
  let value = ip.toLowerCase().split("%")[0]?.replace(/^\[|\]$/g, "") ?? "";
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
  if (mapped?.[1]) value = mapped[1];
  if (value.includes(":")) {
    if (value === "::" || value === "::1") return true;
    const head = value.split(":")[0] || "";
    const n = Number.parseInt(head || "0", 16);
    if (Number.isNaN(n)) return true;
    if ((n & 0xfe00) === 0xfc00) return true;
    if ((n & 0xffc0) === 0xfe80) return true;
    if ((n & 0xffc0) === 0xfec0) return true;
    if ((n & 0xff00) === 0xff00) return true;
    if (value.startsWith("2001:db8")) return true;
    if (value.startsWith("100::")) return true;
    return false;
  }
  return ipv4Blocked(value.split(".").map((part) => Number(part)));
}

export function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (host === "metadata.google.internal" || host === "metadata.google.com") return true;
  if (isIP(host)) return isBlockedIp(host);
  return false;
}

function pinnedFetch(current: URL, init: RequestInit, ip: string): Promise<Response> {
  return new Promise((resolve, reject) => {
    const headers = new Headers(init.headers);
    headers.set("host", current.host);
    const raw: Record<string, string> = {};
    headers.forEach((value, key) => {
      raw[key] = value;
    });
    const req = httpsRequest(
      {
        host: ip,
        family: ip.includes(":") ? 6 : 4,
        servername: current.hostname,
        port: Number(current.port) || 443,
        method: init.method || "GET",
        path: `${current.pathname}${current.search}`,
        headers: raw,
      },
      (incoming) => {
        const responseHeaders = new Headers();
        for (const [key, value] of Object.entries(incoming.headers)) {
          if (typeof value === "string") responseHeaders.set(key, value);
          else if (Array.isArray(value)) value.forEach((item) => responseHeaders.append(key, item));
        }
        const body = Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
        resolve(new Response(body, { status: incoming.statusCode || 0, headers: responseHeaders }));
      },
    );
    const fail = (error: Error) => reject(error);
    init.signal?.addEventListener("abort", () => req.destroy(new Error("aborted")), { once: true });
    req.on("error", fail);
    req.setTimeout(60_000, () => req.destroy(new Error("timeout")));
    const body = init.body;
    if (typeof body === "string" || body instanceof Uint8Array) req.end(body);
    else req.end();
  });
}

export async function lookupPublic(host: string, resolve: LookupFn = DEFAULT_LOOKUP): Promise<string[]> {
  const name = host.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (isBlockedHost(name)) throw new Error("Этот адрес недоступен");
  if (isIP(name)) return [name];
  let rows: { address: string; family: number }[] = [];
  try {
    rows = await resolve(name);
  } catch {
    throw new Error("Адрес не находится");
  }
  if (!rows.length || rows.some((row) => isBlockedIp(row.address))) throw new Error("Этот адрес недоступен");
  return rows.map((row) => row.address);
}

export async function publicFetch(
  raw: string,
  init: RequestInit = {},
  opts?: { hops?: number; allowHosts?: readonly string[] },
): Promise<Response> {
  const hops = opts?.hops ?? 3;
  let current = new URL(raw);
  for (let hop = 0; hop <= hops; hop += 1) {
    if (current.protocol !== "https:") throw new Error("Этот адрес недоступен");
    if (current.username || current.password) throw new Error("Этот адрес недоступен");
    if (opts?.allowHosts && !hostInList(current.hostname, opts.allowHosts)) throw new Error("Этот адрес недоступен");
    const addresses = await lookupPublic(current.hostname);
    const pinned = addresses[0] || "";
    const res = await pinnedFetch(current, init, pinned);
    if (res.status < 300 || res.status >= 400 || hop === hops) return res;
    const next = res.headers.get("location");
    await res.body?.cancel().catch(() => undefined);
    if (!next) throw new Error("Слишком много переходов по ссылке");
    current = new URL(next, current);
  }
  throw new Error("Слишком много переходов по ссылке");
}

