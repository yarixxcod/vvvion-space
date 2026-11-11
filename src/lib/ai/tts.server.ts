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
  let url: URL;
  try {
    url = new URL(model.base_url?.trim() || "https://api.openai.com/v1");
  } catch {
    return json(404, "Голос не настроен");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return json(404, "Голос не настроен");
  const path = url.pathname.replace(/\/$/, "");
  url.pathname = path.endsWith("/audio/speech") ? path : `${path}/audio/speech`;
  url.search = "";
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${model.api_key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: model.name,
        input,
        voice: model.voice || "alloy",
        response_format: "mp3",
      }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch {
    return json(502, "Голос не ответил");
  }
  const type = upstream.headers.get("content-type") || "";
  if (!upstream.ok || type.includes("json") || !upstream.body) return json(502, "Голос не ответил");
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": type.startsWith("audio/") ? type : "audio/mpeg",
      "cache-control": "private, max-age=86400",
      "x-content-type-options": "nosniff",
    },
  });
}
