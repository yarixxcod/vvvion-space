import { getSql } from "@/lib/db";
import { API_SETTING_DEFAULTS, type ApiSettings } from "@/lib/api/settings";

export type { ApiSettings };

const DEFAULTS = API_SETTING_DEFAULTS;

let cache: { at: number; value: ApiSettings } | null = null;

export function clearApiSettingsCache(): void {
  cache = null;
}

export async function readApiSettings(): Promise<ApiSettings> {
  if (cache && Date.now() - cache.at < 10_000) return cache.value;
  try {
    const sql = await getSql();
    const rows = await sql<{
      enabled: boolean;
      daily_requests: number | null;
      daily_tokens: number | null;
      daily_images: number | null;
      per_minute: number;
      max_output_tokens: number;
      max_keys: number;
    }>`select enabled, daily_requests, daily_tokens, daily_images, per_minute, max_output_tokens, max_keys from api_settings where id = 1`;
    const row = rows[0];
    const value: ApiSettings = row
      ? {
          enabled: Boolean(row.enabled),
          dailyRequests: row.daily_requests == null ? null : Number(row.daily_requests),
          dailyTokens: row.daily_tokens == null ? null : Number(row.daily_tokens),
          dailyImages: row.daily_images == null ? null : Number(row.daily_images),
          perMinute: Number(row.per_minute) || DEFAULTS.perMinute,
          maxOutputTokens: Number(row.max_output_tokens) || DEFAULTS.maxOutputTokens,
          maxKeys: Number(row.max_keys) || 0,
        }
      : DEFAULTS;
    cache = { at: Date.now(), value };
    return value;
  } catch (error) {
    console.error("[api] settings", error instanceof Error ? error.message : "read failed");
    return DEFAULTS;
  }
}

export async function writeApiSettings(next: ApiSettings): Promise<ApiSettings> {
  const sql = await getSql();
  await sql`
    insert into api_settings (id, enabled, daily_requests, daily_tokens, daily_images, per_minute, max_output_tokens, max_keys)
    values (1, ${next.enabled}, ${next.dailyRequests}, ${next.dailyTokens}, ${next.dailyImages}, ${next.perMinute}, ${next.maxOutputTokens}, ${next.maxKeys})
    on conflict (id) do update set
      enabled = excluded.enabled,
      daily_requests = excluded.daily_requests,
      daily_tokens = excluded.daily_tokens,
      daily_images = excluded.daily_images,
      per_minute = excluded.per_minute,
      max_output_tokens = excluded.max_output_tokens,
      max_keys = excluded.max_keys
  `;
  clearApiSettingsCache();
  return next;
}
