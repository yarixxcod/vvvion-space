import { createHash, randomBytes } from "node:crypto";

/** Открытый ключ: vvvion-sk- и 43 символа base64url от 32 случайных байт. */
export const KEY_RE = /^vvvion-sk-[A-Za-z0-9_-]{43}$/;

export type MintedKey = { key: string; hash: string; prefix: string; last4: string };

export type PublicKey = {
  id: string;
  name: string;
  prefix: string;
  last4: string;
  createdAt: string;
  lastUsedAt: string | null;
  revoked: boolean;
  requests24h: number;
};

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function generateKey(): MintedKey {
  const key = `vvvion-sk-${randomBytes(32).toString("base64url")}`;
  return { key, hash: hashKey(key), prefix: key.slice(0, 14), last4: key.slice(-4) };
}

/** Ключ из Authorization: Bearer или x-api-key. Cookie не читается. Неверный формат — как отсутствие. */
export function presentedKey(headers: Headers): string | null {
  const auth = headers.get("authorization") || "";
  const bearer = /^Bearer\s+(\S+)\s*$/i.exec(auth);
  const raw = (bearer?.[1] || headers.get("x-api-key") || "").trim();
  return KEY_RE.test(raw) ? raw : null;
}

export function cleanKeyName(name: unknown): string {
  if (typeof name !== "string") throw new Error("Укажите имя ключа");
  const clean = name.trim();
  if (clean.length < 1 || clean.length > 40) throw new Error("Имя ключа: от 1 до 40 символов");
  return clean;
}

/** 0 в maxKeys означает «без ограничения числа активных ключей». */
export function canCreateKey(input: { active: number; createdLastHour: number; maxKeys: number }): "ok" | "too_many_active" | "too_many_recent" {
  if (input.createdLastHour >= 10) return "too_many_recent";
  if (input.maxKeys > 0 && input.active >= input.maxKeys) return "too_many_active";
  return "ok";
}

export function toPublicKey(row: {
  id: string;
  name: string;
  prefix: string;
  last4: string;
  created_at?: string | null;
  createdAt?: string | null;
  last_used_at?: string | null;
  lastUsedAt?: string | null;
  revoked_at?: string | null;
  revoked?: boolean;
  requests24h?: number | string | null;
  key?: unknown;
  key_hash?: unknown;
}): PublicKey {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    last4: row.last4,
    createdAt: row.createdAt || row.created_at || "",
    lastUsedAt: row.lastUsedAt ?? row.last_used_at ?? null,
    revoked: row.revoked === true || Boolean(row.revoked_at),
    requests24h: Number(row.requests24h ?? 0),
  };
}
