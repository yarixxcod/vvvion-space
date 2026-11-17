import { getSql } from "@/lib/db";

const MAX = 2500;

function json(status: number, message: string) {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export function speakable(raw: string) {
  return raw
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]+`/g, " ")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[*_~>#|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX);
}

export function speechEndpoint(base: string): string | null {
  let url: URL;
  try {
    url = new URL(base.trim() || "https://api.openai.com/v1");
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  let path = url.pathname.replace(/\/+$/, "");
  path = path.replace(/\/chat\/completions$/i, "").replace(/\/completions$/i, "");
  if (!path.endsWith("/audio/speech")) path = `${path}/audio/speech`;
  url.pathname = path || "/audio/speech";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function audioBase64(payload: unknown, depth = 0): string | null {
  if (!payload || typeof payload !== "object" || depth > 4) return null;
  const row = payload as Record<string, unknown>;
  for (const key of ["audio", "audioContent", "audio_base64", "b64_json"]) {
    const value = row[key];
    if (typeof value === "string" && value.length > 80) return value.replace(/\s/g, "");
  }
  for (const key of ["data", "result", "output"]) {
    const value = row[key];
    if (typeof value === "string" && value.length > 80 && /^[A-Za-z0-9+/=\s]+$/.test(value.slice(0, 160))) return value.replace(/\s/g, "");
    const nested = audioBase64(value, depth + 1);
    if (nested) return nested;
  }
  return null;
}

function clipError(raw: string, secret: string) {
  const text = raw
    .replaceAll(secret, "")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "")
    .replace(/Bearer\s+\S+/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return text || "Голос не ответил";
}

async function readError(upstream: Response, secret: string) {
  const raw = await upstream.text().catch(() => "");
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string }; message?: string };
    const message = parsed?.error?.message || parsed?.message || raw;
    return clipError(typeof message === "string" ? message : raw, secret);
  } catch {
    return clipError(raw, secret);
  }
}

function audioResponse(bytes: Uint8Array, type: string) {
  const header = type.startsWith("audio/") ? type.split(";")[0] || "audio/mpeg" : "audio/mpeg";
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Response(copy.buffer, {
    status: 200,
    headers: {
      "content-type": header,
      "cache-control": "private, max-age=86400",
      "x-content-type-options": "nosniff",
    },
  });
}

async function asAudio(upstream: Response, secret: string): Promise<Response> {
  const type = (upstream.headers.get("content-type") || "").toLowerCase();
  if (!upstream.ok) return json(502, await readError(upstream, secret));
  if (type.includes("json") || type.startsWith("text/")) {
    const raw = await upstream.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return json(502, clipError(raw, secret));
    }
    const encoded = audioBase64(parsed);
    if (!encoded) {
      const row = parsed as { error?: { message?: string }; message?: string };
      return json(502, clipError(row?.error?.message || row?.message || "Голос не ответил", secret));
    }
    try {
      const bytes = Buffer.from(encoded, "base64");
      if (bytes.length < 32) return json(502, "Голос не ответил");
      return audioResponse(bytes, "audio/mpeg");
    } catch {
      return json(502, "Голос не ответил");
    }
  }
  if (!upstream.body) return json(502, "Голос не ответил");
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": type.startsWith("audio/") ? type.split(";")[0] || "audio/mpeg" : "audio/mpeg",
      "cache-control": "private, max-age=86400",
      "x-content-type-options": "nosniff",
    },
  });
}

async function postSpeech(url: string, secret: string, body: Record<string, unknown>) {
  return fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
      accept: "audio/mpeg, audio/*, application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });
}

export async function speakText(text: string): Promise<Response> {
  const input = speakable(typeof text === "string" ? text : "");
  if (input.length < 2) return json(400, "Нечего озвучивать");
  const sql = await getSql();
  const rows = await sql<{ name: string; base_url: string; api_key: string; voice: string }>`
    select name, base_url, api_key, voice from tts_models
    where api_key <> ''
    order by created_at asc
    limit 1
  `;
  const model = rows[0];
  if (!model?.api_key) return json(404, "Голос не настроен");
  const url = speechEndpoint(model.base_url || "");
  if (!url) return json(404, "Голос не настроен");
  const voice = model.voice?.trim() || "alloy";
  const base = { model: model.name, input, voice };
  let upstream: Response;
  try {
    upstream = await postSpeech(url, model.api_key, { ...base, response_format: "mp3" });
  } catch {
    return json(502, "Голос не ответил");
  }
  if (!upstream.ok) {
    const reason = await readError(upstream, model.api_key);
    if (/response_format|format|unsupported|unrecognized|unknown parameter|extra/i.test(reason)) {
      try {
        upstream = await postSpeech(url, model.api_key, base);
      } catch {
        return json(502, "Голос не ответил");
      }
    } else return json(502, reason);
  }
  return asAudio(upstream, model.api_key);
}
