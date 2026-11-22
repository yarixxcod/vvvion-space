import { getSql } from "@/lib/db";
import { isPremium } from "@/lib/social/premium";
import { canCreateKey, cleanKeyName, generateKey, hashKey, presentedKey, toPublicKey, type PublicKey } from "@/lib/api/keys";
import { readApiSettings } from "@/lib/api/settings.server";

export async function createKey(userId: string, name: unknown): Promise<{ key: string; row: PublicKey }> {
  if (!(await isPremium(userId))) throw new Error("API доступен с Premium");
  const clean = cleanKeyName(name);
  const settings = await readApiSettings();
  const sql = await getSql();
  const counts = await sql<{ active: number; recent: number }>`
    select count(*) filter (where revoked_at is null)::int as active,
           count(*) filter (where created_at > now() - interval '1 hour')::int as recent
    from api_keys where user_id = ${userId}
  `;
  const gate = canCreateKey({
    active: Number(counts[0]?.active ?? 0),
    createdLastHour: Number(counts[0]?.recent ?? 0),
    maxKeys: settings.maxKeys,
  });
  if (gate === "too_many_recent") throw new Error("Слишком много ключей за час. Подождите.");
  if (gate === "too_many_active") throw new Error("Уже есть максимум активных ключей");
  const minted = generateKey();
  const id = crypto.randomUUID();
  await sql`
    insert into api_keys (id, user_id, name, key_hash, prefix, last4)
    values (${id}, ${userId}, ${clean}, ${minted.hash}, ${minted.prefix}, ${minted.last4})
  `;
  return {
    key: minted.key,
    row: toPublicKey({ id, name: clean, prefix: minted.prefix, last4: minted.last4, createdAt: new Date().toISOString(), revoked: false, requests24h: 0 }),
  };
}

export async function listKeys(userId: string): Promise<PublicKey[]> {
  const sql = await getSql();
  const rows = await sql<{
    id: string;
    name: string;
    prefix: string;
    last4: string;
    created_at: string;
    last_used_at: string | null;
    revoked_at: string | null;
    requests24h: number;
  }>`
    select k.id, k.name, k.prefix, k.last4, k.created_at::text as created_at, k.last_used_at::text as last_used_at,
           k.revoked_at::text as revoked_at,
           (select count(*)::int from api_usage u where u.key_id = k.id and u.created_at > now() - interval '24 hours') as requests24h
    from api_keys k
    where k.user_id = ${userId}
    order by k.created_at desc
  `;
  return rows.map((row) => toPublicKey(row));
}

export async function revokeKey(userId: string, keyId: string): Promise<boolean> {
  if (!keyId || keyId.length > 80) return false;
  const sql = await getSql();
  const rows = await sql<{ id: string }>`
    update api_keys set revoked_at = coalesce(revoked_at, now())
    where id = ${keyId} and user_id = ${userId}
    returning id
  `;
  return rows.length > 0;
}

export async function revokeAllForUser(userId: string): Promise<number> {
  const sql = await getSql();
  const rows = await sql<{ id: string }>`
    update api_keys set revoked_at = coalesce(revoked_at, now())
    where user_id = ${userId} and revoked_at is null
    returning id
  `;
  return rows.length;
}

/** Неверный, неизвестный и отозванный ключ дают null — снаружи это один и тот же 401. */
export async function authenticate(request: Request): Promise<{ keyId: string; userId: string } | null> {
  const key = presentedKey(request.headers);
  if (!key) return null;
  const sql = await getSql();
  const rows = await sql<{ id: string; user_id: string; revoked_at: string | null }>`
    select id, user_id, revoked_at::text as revoked_at from api_keys where key_hash = ${hashKey(key)} limit 1
  `;
  const row = rows[0];
  if (!row || row.revoked_at) return null;
  await sql`
    update api_keys set last_used_at = now()
    where id = ${row.id} and (last_used_at is null or last_used_at < now() - interval '1 minute')
  `;
  return { keyId: row.id, userId: row.user_id };
}
