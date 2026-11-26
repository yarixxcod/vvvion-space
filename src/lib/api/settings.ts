export type ApiSettings = {
  enabled: boolean;
  dailyRequests: number | null;
  dailyTokens: number | null;
  dailyImages: number | null;
  perMinute: number;
  maxOutputTokens: number;
  maxKeys: number;
};

export const API_SETTING_DEFAULTS: ApiSettings = {
  enabled: false,
  dailyRequests: null,
  dailyTokens: null,
  dailyImages: 20,
  perMinute: 30,
  maxOutputTokens: 16384,
  maxKeys: 5,
};

function cap(value: unknown, max: number): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error("Лимит — целое число или пустое поле");
  if (n > max) throw new Error(`Лимит не больше ${max}`);
  return n;
}

function requiredCap(value: unknown, max: number, fallback: number): number {
  const n = cap(value, max);
  if (n == null || n < 1) return fallback;
  return n;
}

/** Пустое поле суточного лимита значит «без лимита». 0 ключей — тоже без потолка. */
export function settingsInput(input: unknown): ApiSettings {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  return {
    enabled: raw.enabled === true,
    dailyRequests: cap(raw.dailyRequests, 10_000_000),
    dailyTokens: cap(raw.dailyTokens, 10_000_000),
    dailyImages: cap(raw.dailyImages, 10_000_000),
    perMinute: requiredCap(raw.perMinute, 10_000, 30),
    maxOutputTokens: requiredCap(raw.maxOutputTokens, 1_000_000, 4096),
    maxKeys: cap(raw.maxKeys, 100) ?? 5,
  };
}
