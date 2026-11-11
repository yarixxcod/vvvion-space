import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { assertAdmin } from "@/lib/social/access";

export type WhisperSettings = {
  baseUrl: string;
  model: string;
  language: string;
  hasKey: boolean;
  ready: boolean;
};

const MODEL_RE = /^[A-Za-z0-9._:/-]+$/;

function catalogUrl(value: unknown): string {
  const raw = typeof value === "string" && value.trim() ? value.trim() : "https://api.openai.com/v1";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Эндпойнт должен быть адресом http:// или https://");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Эндпойнт: только http или https");
  if (url.username || url.password) throw new Error("Не кладите ключ в адрес");
  const host = url.hostname.toLowerCase();
  if (host === "metadata.google.internal" || host === "169.254.169.254") throw new Error("Этот адрес недоступен");
  url.search = "";
  url.hash = "";
  const out = url.toString().replace(/\/$/, "");
  if (out.length > 300) throw new Error("Слишком длинный эндпойнт");
  return out;
}

function modelName(value: unknown): string {
  if (typeof value !== "string") throw new Error("Некорректное имя модели");
  const name = value.trim();
  if (!name || name.length > 80 || !MODEL_RE.test(name)) throw new Error("Некорректное имя модели");
  return name;
}

type SaveInput = {
  baseUrl: string;
  model: string;
  language: string;
  apiKey: string;
  clearKey: boolean;
};

function saveInput(input: unknown): SaveInput {
  if (!input || typeof input !== "object") throw new Error("Некорректные настройки");
  const raw = input as Record<string, unknown>;
  const language = typeof raw.language === "string" ? raw.language.trim().toLowerCase() : "";
  if (language && !/^[a-z]{2}$/.test(language)) throw new Error("Язык — две буквы, например ru, или пусто");
  const apiKey = typeof raw.apiKey === "string" ? raw.apiKey.trim().slice(0, 400) : "";
  if (apiKey && /[\r\n]/.test(apiKey)) throw new Error("Ключ не должен содержать переносы");
  return {
    baseUrl: catalogUrl(raw.baseUrl),
    model: modelName(raw.model),
    language,
    apiKey,
    clearKey: raw.clearKey === true,
  };
}

export async function readWhisperRow(): Promise<{ baseUrl: string; model: string; language: string; apiKey: string }> {
  const sql = await getSql();
  const rows = await sql<{ base_url: string; model: string; language: string; api_key: string }>`
    select base_url, model, language, api_key from whisper_settings where id = 1
  `;
  const row = rows[0];
  return {
    baseUrl: row?.base_url || "https://api.openai.com/v1",
    model: row?.model || "whisper-1",
    language: row?.language || "",
    apiKey: row?.api_key || "",
  };
}

export function whisperSecret(stored: string): string {
  if (stored.trim()) return stored.trim();
  return (process.env.WHISPER_API_KEY || process.env.OPENAI_API_KEY || "").trim();
}

function present(row: { baseUrl: string; model: string; language: string; apiKey: string }): WhisperSettings {
  const hasKey = row.apiKey.length > 0;
  return {
    baseUrl: row.baseUrl,
    model: row.model,
    language: row.language,
    hasKey,
    ready: Boolean(whisperSecret(row.apiKey)),
  };
}

export const getWhisperSettings = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<WhisperSettings> => {
    await assertAdmin(context.userId);
    return present(await readWhisperRow());
  });

export const saveWhisperSettings = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(saveInput)
  .handler(async ({ context, data }): Promise<WhisperSettings> => {
    await assertAdmin(context.userId);
    const current = await readWhisperRow();
    const apiKey = data.clearKey ? "" : data.apiKey || current.apiKey;
    const sql = await getSql();
    await sql`
      insert into whisper_settings (id, base_url, model, language, api_key)
      values (1, ${data.baseUrl}, ${data.model}, ${data.language}, ${apiKey})
      on conflict (id) do update
        set base_url = excluded.base_url,
            model = excluded.model,
            language = excluded.language,
            api_key = excluded.api_key
    `;
    return present(await readWhisperRow());
  });
