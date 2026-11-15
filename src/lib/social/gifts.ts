import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql, withTransaction } from "@/lib/db";
import { assertActive } from "@/lib/social/access";
import { findUserByHandle, normalizeHandle, readHandle } from "@/lib/social/handles";
import { isUniqueViolation } from "@/lib/social/sql-error";

export type GiftItem = { sku: string; title: string; note: string; price: number };
export type GiftInboxItem = { id: string; sku: string; resaleValue: number; title: string; note: string; createdAt: string; fromHandle: string | null; fromName: string };

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
    const inbox = await sql<{ id: string; sku: string; resale_value: number; title: string; note: string; created_at: string; from_handle: string | null; from_name: string }>`
      select g.id, g.sku, g.title, g.note, g.created_at::text as created_at, h.handle as from_handle, u.name as from_name, greatest(1, floor(coalesce(p.price, 1)::numeric / 2))::integer as resale_value
      from gift_receipts g
      join "user" u on u.id = g.from_id
      left join user_handles h on h.user_id = g.from_id
      left join shop_prices p on p.sku = g.sku
      where g.to_id = ${context.userId} and g.sold_at is null
      order by g.created_at desc
    `;
    return {
      gifts: gifts.map((item) => ({ ...item, price: Number(item.price) })),
      inbox: inbox.map((item) => ({
        id: item.id,
        sku: item.sku,
        resaleValue: Number(item.resale_value),
        title: item.title,
        note: item.note,
        createdAt: item.created_at,
        fromHandle: item.from_handle,
        fromName: item.from_name,
      })),
      handle: await readHandle(context.userId),
    };
  });

export async function sendGiftTo(userId: string, sku: string, handle: string, note: string, idem: string, self = false): Promise<void> {
  if (!(await verified(userId))) throw new Error("Сначала подтвердите почту в профиле");
  const who = self ? { id: userId } : await findUserByHandle(handle);
  if (!who) throw new Error("Такого юзернейма нет");
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
    const raw = input as { sku?: unknown; self?: unknown; handle?: unknown; note?: unknown; idempotencyKey?: unknown };
    const sku = typeof raw.sku === "string" ? raw.sku.trim() : "";
    if (!sku.startsWith("gift:")) throw new Error("Подарок не выбран");
    const idem = typeof raw.idempotencyKey === "string" ? raw.idempotencyKey.trim() : "";
    if (!/^[0-9a-f-]{36}$/i.test(idem)) throw new Error("Повторите отправку");
    const note = typeof raw.note === "string" ? raw.note : "";
    return { sku, self: raw.self === true, handle: raw.self === true ? "" : normalizeHandle(raw.handle), note, idem };
  })
  .handler(async ({ context, data }) => {
    await assertActive(context.userId);
    await sendGiftTo(context.userId, data.sku, data.handle, data.note, data.idem, data.self);
    return { ok: true as const };
  });

/** Resell one received gift for half its current catalog price.
 * Lock the receipt and credit the wallet in a single transaction.
 * Sold gifts remain in the database for audit history.
 */
export const sellReceivedGift = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const id = input && typeof input === "object" && "id" in input ? (input as { id: unknown }).id : "";
    if (typeof id !== "string" || !/^gift-[0-9a-f-]{36}$/i.test(id)) throw new Error("Подарок не найден");
    return { id };
  })
  .handler(async ({ context, data }) => {
    await assertActive(context.userId);
    return withTransaction(async (sql) => {
      const rows = await sql<{ id: string; price: number }>`
        select g.id, greatest(1, floor(coalesce(p.price, 1)::numeric / 2))::integer as price
        from gift_receipts g
        left join shop_prices p on p.sku = g.sku
        where g.id = ${data.id} and g.to_id = ${context.userId} and g.sold_at is null
        for update of g
      `;
      const gift = rows[0];
      if (!gift) throw new Error("Подарок уже продан или не найден");
      const price = Number(gift.price);
      await sql`
        insert into wallets (user_id, balance, earned, last_grant_at)
        values (${context.userId}, 0, 0, now())
        on conflict (user_id) do nothing
      `;
      const updated = await sql<{ balance: number }>`
        update wallets set balance = balance + ${price}, earned = earned + ${price}
        where user_id = ${context.userId}
          and balance <= 2147483647 - ${price}
          and earned <= 2147483647 - ${price}
        returning balance
      `;
      if (!updated.length) throw new Error("Превышен допустимый баланс");
      await sql`update gift_receipts set sold_at = now(), resale_amount = ${price} where id = ${gift.id}`;
      const ledgerId = crypto.randomUUID();
      await sql`
        insert into wallet_ledger (id, user_id, kind, bucket, amount, balance_after, ref_type, ref_id, idem_key, meta)
        values (${ledgerId}, ${context.userId}, 'adjust', 'earned', ${price}, ${updated[0].balance},
          'gift_resale', ${gift.id}, ${ledgerId}, jsonb_build_object('gift_id', ${gift.id}::text))
      `;
      return { ok: true as const, amount: price };
    });
  });
