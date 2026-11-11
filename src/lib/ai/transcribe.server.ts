import { explainApiError } from "@/lib/ai/api-error";
import { readWhisperRow, whisperSecret } from "@/lib/ai/whisper";

const MAX_BYTES = 8_000_000;
const WINDOW_MS = 10 * 60_000;
const LIMIT = 8;
const PARTIAL_LIMIT = 40;

const buckets = new Map<string, { n: number; reset: number }>();

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function clientIp(request: Request): string {
  const xf = request.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0]?.trim().slice(0, 80) || "local";
  return "local";
}

function allow(ip: string, limit = LIMIT): boolean {
  const now = Date.now();
  const key = limit === LIMIT ? ip : `${ip}:part`;
  const bucket = buckets.get(key);
  if (!bucket || now > bucket.reset) {
    buckets.set(key, { n: 1, reset: now + WINDOW_MS });
    return true;
  }
  if (bucket.n >= limit) return false;
  bucket.n += 1;
  return true;
}

function transcriptionUrl(baseRaw: string): string {
  const base = new URL(baseRaw);
  if (base.protocol !== "https:" && base.protocol !== "http:") throw new Error("Некорректный адрес расшифровки");
  const host = base.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "metadata.google.internal" || host === "169.254.169.254") throw new Error("Этот адрес недоступен");
  const prefix = base.pathname.replace(/\/+$/, "");
  base.pathname = `${prefix}/audio/transcriptions`;
  base.search = "";
  base.hash = "";
  return base.toString();
}

function audioName(type: string): string {
  if (type.includes("mp4") || type.includes("m4a")) return "voice.m4a";
  if (type.includes("mpeg") || type.includes("mp3")) return "voice.mp3";
  if (type.includes("wav")) return "voice.wav";
  if (type.includes("ogg")) return "voice.ogg";
  return "voice.webm";
}

export async function handleTranscribe(request: Request): Promise<Response> {
  let row: Awaited<ReturnType<typeof readWhisperRow>>;
  try {
    row = await readWhisperRow();
  } catch {
    return json(503, { ready: false, message: "Расшифровка ещё не подключена" });
  }
  const secret = whisperSecret(row.apiKey);
  if (request.method === "GET") {
    return json(200, { ready: Boolean(secret), message: secret ? "" : "Расшифровка ещё не подключена" });
  }
  if (!secret) return json(503, { message: "Расшифровка ещё не подключена" });
  const partial = request.headers.get("x-vvvion-partial") === "1";
  if (!allow(clientIp(request), partial ? PARTIAL_LIMIT : LIMIT)) {
    return json(429, { message: "Слишком много записей. Подождите пару минут." });
  }

  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_BYTES + 200_000) return json(413, { message: "Запись слишком длинная" });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json(400, { message: "Не удалось прочитать запись" });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return json(400, { message: "Нет записи" });
  if (file.size < (partial ? 800 : 400)) return json(partial ? 200 : 400, partial ? { text: "" } : { message: "Запись слишком короткая" });
  if (file.size > MAX_BYTES) return json(413, { message: "Запись слишком длинная" });
  const type = (file.type || "audio/webm").toLowerCase();
  if (!type.startsWith("audio/") && type !== "video/webm") return json(400, { message: "Нужен звуковой файл" });

  try {
    const body = new FormData();
    body.set("file", file, audioName(type));
    body.set("model", row.model);
    body.set("response_format", "json");
    if (row.language) body.set("language", row.language);
    const upstream = await fetch(transcriptionUrl(row.baseUrl), {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(60_000),
    });
    if (upstream.status >= 300 && upstream.status < 400) {
      return json(502, { message: "Провайдер вернул редирект — запрос остановлен" });
    }
    const text = await upstream.text();
    if (!upstream.ok) return json(upstream.status, { message: explainApiError(upstream.status, text, secret) });
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      return json(502, { message: "Расшифровка пришла в неожиданном виде" });
    }
    const said = parsed && typeof parsed === "object" ? (parsed as { text?: unknown }).text : "";
    const phrase = typeof said === "string" ? said.replace(/\s+/g, " ").trim().slice(0, 8000) : "";
    if (!phrase) return json(partial ? 200 : 422, partial ? { text: "" } : { message: "В записи не разобрать слов" });
    return json(200, { text: phrase });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/timeout|aborted/i.test(message)) return json(504, { message: "Расшифровка не успела завершиться" });
    return json(502, { message: "Не удалось расшифровать запись" });
  }
}
