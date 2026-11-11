import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { assertActive } from "@/lib/social/access";
import { isUniqueViolation } from "@/lib/social/sql-error";

const HANDLE = /^[a-z][a-z0-9_]{2,19}$/;
const RESERVED = new Set(["admin", "administrator", "support", "vvvion", "system", "shop", "bank", "gift", "root", "moderator"]);

export type HandleCard = { handle: string | null };
export type HandleHit = { handle: string; name: string } | null;

export function normalizeHandle(value: unknown): string {
  const raw = typeof value === "string" ? value.trim().toLowerCase().replace(/^@/, "") : "";
  if (!HANDLE.test(raw) || RESERVED.has(raw)) throw new Error("Юзернейм: от 3 до 20 знаков, латиница, цифры и _, с буквы");
  return raw;
}

export async function readHandle(userId: string): Promise<string | null> {
  const sql = await getSql();
  const rows = await sql<{ handle: string }>`select handle from user_handles where user_id = ${userId}`;
  return rows[0]?.handle ?? null;
}

export async function findUserByHandle(handle: string): Promise<{ id: string; name: string; handle: string } | null> {
  const sql = await getSql();
  const rows = await sql<{ id: string; name: string; handle: string }>`
    select u.id, u.name, h.handle
    from user_handles h
    join "user" u on u.id = h.user_id
    where h.handle = ${handle}
    limit 1
  `;
  return rows[0] ?? null;
}

export const getMyHandle = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<HandleCard> => {
    await assertActive(context.userId);
    return { handle: await readHandle(context.userId) };
  });

export const setMyHandle = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = input && typeof input === "object" ? (input as { handle?: unknown }).handle : input;
    if (typeof raw === "string" && raw.trim() === "") return "";
    return normalizeHandle(raw);
  })
  .handler(async ({ context, data }): Promise<HandleCard> => {
    await assertActive(context.userId);
    const sql = await getSql();
    if (!data) {
      await sql`delete from user_handles where user_id = ${context.userId}`;
      return { handle: null };
    }
    try {
      await sql`
        insert into user_handles (user_id, handle, updated_at)
        values (${context.userId}, ${data}, now())
        on conflict (user_id) do update set handle = ${data}, updated_at = now()
      `;
    } catch (err) {
      if (isUniqueViolation(err)) throw new Error("Этот юзернейм уже занят");
      throw err;
    }
    return { handle: data };
  });

export const lookupHandle = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: unknown) => normalizeHandle(input && typeof input === "object" ? (input as { handle?: unknown }).handle : input))
  .handler(async ({ context, data }): Promise<HandleHit> => {
    await assertActive(context.userId);
    const hit = await findUserByHandle(data);
    if (!hit || hit.id === context.userId) return null;
    return { handle: hit.handle, name: hit.name };
  });
