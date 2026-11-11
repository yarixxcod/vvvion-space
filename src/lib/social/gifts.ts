import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { assertActive } from "@/lib/social/access";
import { findUserByHandle, normalizeHandle, readHandle } from "@/lib/social/handles";
import { isUniqueViolation } from "@/lib/social/sql-error";

export type GiftItem = { sku: string; title: string; note: string; price: number };
export type GiftInboxItem = { id: string; title: string; note: string; createdAt: string; fromHandle: string | null; fromName: string };

async function verified(userId: string): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql<{ ok: boolean | null }>`select "emailVerified" as ok from "user" where id = ${userId}`;
  return Boolean(rows[0]?.ok);
}

export const getGiftDesk = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<{ gifts: GiftItem[]; inbox: GiftInboxItem[]; handle: string | null }> => {
    await assertActive(context.userId);
    const sql = await getSql();
    const gifts = await sql<GiftItem>`
      select sku, title, note, price
      from shop_prices
      where section = 'gifts' and enabled = true
      order by price, title
    `;
    const inbox = await sql<{ id: string; title: string; note: string; created_at: string; from_handle: string | null; from_name: string }>`
      select g.id, g.title, g.note, g.created_at::text as created_at, h.handle as from_handle, u.name as from_name
      from gift_receipts g
      join "user" u on u.id = g.from_id
      left join user_handles h on h.user_id = g.from_id
      where g.to_id = ${context.userId}
      order by g.created_at desc
      limit 30
    `;
    return {
      gifts: gifts.map((item) => ({ ...item, price: Number(item.price) })),
      inbox: inbox.map((item) => ({
        id: item.id,
        title: item.title,
        note: item.note,
        createdAt: item.created_at,
        fromHandle: item.from_handle,
        fromName: item.from_name,
      })),
      handle: await readHandle(context.userId),
    };
  });

export async function sendGiftTo(userId: string, sku: string, handle: string, note: string, idem: string): Promise<void> {
  if (!(await verified(userId))) throw new Error("Сначала подтвердите почту в профиле");
  const who = await findUserByHandle(handle);
  if (!who) throw new Error("Такого юзернейма нет");
  if (who.id === userId) throw new Error("Себе подарок не отправить");
  const sql = await getSql();
  const id = `gift-${idem}`;
  const prev = await sql<{ id: string }>`select id from wallet_transfers where id = ${id}`;
  if (prev.length) return;
  const clean = note.replace(/\s+/g, " ").trim().slice(0, 80);
  try {
    const done = await sql<{ id: string }>`
      with item as (
        select sku, title, price from shop_prices
        where sku = ${sku} and section = 'gifts' and enabled = true
      ),
      debit as (
        update wallets
        set balance = balance - (select price from item)
        where user_id = ${userId}
          and exists (select 1 from item)
          and balance >= (select price from item)
        returning user_id
      ),
      sent as (
        insert into gift_receipts (id, from_id, to_id, sku, title, note)
        select ${id}, ${userId}, ${who.id}, item.sku, item.title, ${clean}
        from item
        where exists (select 1 from debit)
        returning id
      )
      insert into wallet_transfers (id, from_id, to_id, amount, note)
      select ${id}, ${userId}, ${who.id}, (select price from item), 'Подарок'
      where exists (select 1 from sent)
      returning id
    `;
    if (!done.length) throw new Error("Не хватает вублей на этот подарок");
  } catch (err) {
    if (isUniqueViolation(err)) return;
    throw err;
  }
}

export const sendGift = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Подарок не выбран");
    const raw = input as { sku?: unknown; handle?: unknown; note?: unknown; idempotencyKey?: unknown };
    const sku = typeof raw.sku === "string" ? raw.sku.trim() : "";
    if (!sku.startsWith("gift:")) throw new Error("Подарок не выбран");
    const idem = typeof raw.idempotencyKey === "string" ? raw.idempotencyKey.trim() : "";
    if (!/^[0-9a-f-]{36}$/i.test(idem)) throw new Error("Повторите отправку");
    const note = typeof raw.note === "string" ? raw.note : "";
    return { sku, handle: normalizeHandle(raw.handle), note, idem };
  })
  .handler(async ({ context, data }) => {
    await assertActive(context.userId);
    await sendGiftTo(context.userId, data.sku, data.handle, data.note, data.idem);
    return { ok: true as const };
  });
