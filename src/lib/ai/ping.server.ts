import { getSql } from "@/lib/db";

const BUILTIN_BASE = "https://api.x.ai/v1";
const FRESH_MS = 8_000;
const WINDOW_MS = 60_000;
const LIMIT = 30;

type Sample = { ok: boolean; ms: number | null };
type Body = { kind?: unknown; baseUrl?: unknown; model?: unknown; image?: unknown; imageModel?: unknown };

const buckets = new Map<string, { n: number; reset: number }>();
const fresh = new Map<string, Sample & { at: number }>();
const inflight = new Map<string, Promise<Sample>>();

function blockedHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host === "metadata.google.internal"
  ) {
    return true;
  }
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return false;
  const parts = match.slice(1).map(Number);
  if (parts.some((n) => n > 255)) return true;
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function targetOf(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("only https");
  if (url.username || url.password) throw new Error("no userinfo");
  if (blockedHost(url.hostname)) throw new Error("blocked");
  url.search = "";
  url.hash = "";
  return url.toString();
}

function clientIp(request: Request) {
  const xf = request.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0]?.trim().slice(0, 80) || "local";
  return "local";
}

function allow(ip: string) {
  const now = Date.now();
  const bucket = buckets.get(ip);
  if (!bucket || now > bucket.reset) {
    buckets.set(ip, { n: 1, reset: now + WINDOW_MS });
    return true;
  }
  if (bucket.n >= LIMIT) return false;
  bucket.n += 1;
  return true;
}

async function resolveTarget(body: Body) {
  const kind = body.kind === "custom" ? "custom" : "builtin";
  const image = body.image === true;
  if (kind === "custom") {
    const base = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
    if (!base) throw new Error("empty");
    return targetOf(base);
  }
  try {
    if (image) {
      const asked = typeof body.imageModel === "string" ? body.imageModel.trim() : "";
      const rows = await (await getSql())<{ name: string; base_url: string | null }>`
        select name, base_url from image_models order by created_at asc, name asc
      `;
      const row = rows.find((item) => item.name === asked) || rows[0];
      return targetOf(row?.base_url?.trim() || BUILTIN_BASE);
    }
    const model = typeof body.model === "string" ? body.model.trim() : "";
    if (model && /^[A-Za-z0-9._:/-]+$/.test(model)) {
      const rows = await (await getSql())<{ base_url?: string }>`
        select base_url from catalog_models where name = ${model}
      `;
      return targetOf(rows[0]?.base_url?.trim() || BUILTIN_BASE);
    }
  } catch {
    return targetOf(BUILTIN_BASE);
  }
  return targetOf(BUILTIN_BASE);
}

async function measure(url: string): Promise<Sample> {
  const hit = fresh.get(url);
  if (hit && Date.now() - hit.at < FRESH_MS) return { ok: hit.ok, ms: hit.ms };
  const pending = inflight.get(url);
  if (pending) return pending;
  const job = (async () => {
    const started = performance.now();
    try {
      await fetch(url, {
        method: "HEAD",
        redirect: "manual",
        signal: AbortSignal.timeout(4000),
      });
      const sample = { ok: true, ms: Math.max(1, Math.round(performance.now() - started)) };
      fresh.set(url, { at: Date.now(), ...sample });
      return sample;
    } catch {
      const sample = { ok: false, ms: null };
      fresh.set(url, { at: Date.now(), ...sample });
      return sample;
    } finally {
      inflight.delete(url);
    }
  })();
  inflight.set(url, job);
  return job;
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function handlePing(request: Request): Promise<Response> {
  if (!allow(clientIp(request))) return json(429, { ok: false, ms: null });
  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    body = {};
  }
  try {
    const url = await resolveTarget(body);
    const sample = await measure(url);
    return json(200, sample);
  } catch {
    return json(200, { ok: false, ms: null });
  }
}
