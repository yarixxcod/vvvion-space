import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { assertActive } from "@/lib/social/access";

const PAYS = new Set([4, 6, 8, 10, 12]);
const DAY_CAP = 60;
const GAP_MS = 20_000;

const ARCADE = {
  snake: { pays: new Set([2]), cap: 36, gap: 4_000, note: "Змейка", quiet: "На сегодня змейка молчит. Завтра снова платит." },
  mine: { pays: new Set([8]), cap: 40, gap: 12_000, note: "Сапёр", quiet: "На сегодня сапёр закрыт. Завтра снова платит." },
} as const;

export type ArcadeGame = keyof typeof ARCADE;

export type MergePurse = {
  today: number;
  cap: number;
  balance: number;
  credited: boolean;
};

function ticketOf(value: unknown): string {
  const raw = value && typeof value === "object" ? (value as { ticket?: unknown }).ticket : "";
  if (typeof raw !== "string" || !/^[a-z0-9]{8,16}$/.test(raw)) throw new Error("Заказ не собрался");
  return raw;
}

function amountOf(value: unknown): number {
  const raw = value && typeof value === "object" ? (value as { amount?: unknown }).amount : 0;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!PAYS.has(n)) throw new Error("Такой выплаты нет");
  return n;
}

async function purse(userId: string, game = "stall", cap = DAY_CAP): Promise<MergePurse> {
  const sql = await getSql();
  const earned = await sql<{ n: number }>`
    select coalesce(sum(amount), 0)::int as n
    from game_payouts
    where user_id = ${userId} and game = ${game} and created_at > now() - interval '24 hours'
  `;
  const wallet = await sql<{ balance: number }>`select balance from wallets where user_id = ${userId}`;
  return {
    today: Number(earned[0]?.n ?? 0),
    cap,
    balance: Number(wallet[0]?.balance ?? 0),
    credited: false,
  };
}

export const getMergePurse = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<MergePurse> => {
    await assertActive(context.userId);
    return purse(context.userId);
  });

export const claimMergePayout = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ ticket: ticketOf(input), amount: amountOf(input) }))
  .handler(async ({ context, data }): Promise<MergePurse> => {
    await assertActive(context.userId);
    const sql = await getSql();
    const already = await sql<{ id: string }>`select id from game_payouts where id = ${data.ticket}`;
    if (already.length) return purse(context.userId);
    const recent = await sql<{ ms: number | string }>`
      select extract(epoch from created_at) * 1000 as ms
      from game_payouts
      where user_id = ${context.userId} and game = 'stall'
      order by created_at desc
      limit 1
    `;
    const last = Number(recent[0]?.ms ?? 0);
    if (last && Date.now() - last < GAP_MS) throw new Error("Подождите немного перед следующим заказом");
    const earned = await sql<{ n: number }>`
      select coalesce(sum(amount), 0)::int as n
      from game_payouts
      where user_id = ${context.userId} and game = 'stall' and created_at > now() - interval '24 hours'
    `;
    if (Number(earned[0]?.n ?? 0) + data.amount > DAY_CAP) {
      throw new Error("На сегодня с прилавка хватит. Завтра заказы снова платят.");
    }
    await sql`
      insert into wallets (user_id, balance, last_grant_at)
      values (${context.userId}, 1000, now())
      on conflict (user_id) do nothing
    `;
    const id = data.ticket;
    const saved = await sql<{ id: string }>`
      insert into game_payouts (id, user_id, amount, game)
      values (${id}, ${context.userId}, ${data.amount}, 'stall')
      on conflict (id) do nothing
      returning id
    `;
    if (!saved.length) return purse(context.userId);
    await sql`
      update wallets
      set balance = balance + ${data.amount}
      where user_id = ${context.userId}
    `;
    await sql`
      insert into wallet_transfers (id, from_id, to_id, amount, note)
      values (${`stall-${id}`}, null, ${context.userId}, ${data.amount}, 'Прилавок')
    `;
    const next = await purse(context.userId);
    return { ...next, credited: true };
  });

function arcadeOf(value: unknown): ArcadeGame {
  const raw = value && typeof value === "object" ? (value as { game?: unknown }).game : "";
  if (raw === "snake" || raw === "mine") return raw;
  throw new Error("Игра не найдена");
}

export const getArcadePurse = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: unknown) => arcadeOf(input))
  .handler(async ({ context, data }): Promise<MergePurse> => {
    await assertActive(context.userId);
    const rule = ARCADE[data];
    return purse(context.userId, data, rule.cap);
  });

export const claimArcade = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const game = arcadeOf(input);
    const rule = ARCADE[game];
    const raw = input && typeof input === "object" ? (input as { amount?: unknown }).amount : 0;
    const amount = typeof raw === "number" ? raw : Number(raw);
    if (!rule.pays.has(amount)) throw new Error("Такой выплаты нет");
    return { game, ticket: ticketOf(input), amount };
  })
  .handler(async ({ context, data }): Promise<MergePurse> => {
    await assertActive(context.userId);
    const rule = ARCADE[data.game];
    const sql = await getSql();
    const already = await sql<{ id: string }>`select id from game_payouts where id = ${data.ticket}`;
    if (already.length) return purse(context.userId, data.game, rule.cap);
    const recent = await sql<{ ms: number | string }>`
      select extract(epoch from created_at) * 1000 as ms
      from game_payouts
      where user_id = ${context.userId} and game = ${data.game}
      order by created_at desc
      limit 1
    `;
    const last = Number(recent[0]?.ms ?? 0);
    if (last && Date.now() - last < rule.gap) throw new Error("Подождите немного");
    const earned = await sql<{ n: number }>`
      select coalesce(sum(amount), 0)::int as n
      from game_payouts
      where user_id = ${context.userId} and game = ${data.game} and created_at > now() - interval '24 hours'
    `;
    if (Number(earned[0]?.n ?? 0) + data.amount > rule.cap) throw new Error(rule.quiet);
    await sql`
      insert into wallets (user_id, balance, last_grant_at)
      values (${context.userId}, 1000, now())
      on conflict (user_id) do nothing
    `;
    const saved = await sql<{ id: string }>`
      insert into game_payouts (id, user_id, amount, game)
      values (${data.ticket}, ${context.userId}, ${data.amount}, ${data.game})
      on conflict (id) do nothing
      returning id
    `;
    if (!saved.length) return purse(context.userId, data.game, rule.cap);
    await sql`
      update wallets set balance = balance + ${data.amount} where user_id = ${context.userId}
    `;
    await sql`
      insert into wallet_transfers (id, from_id, to_id, amount, note)
      values (${`${data.game}-${data.ticket}`}, null, ${context.userId}, ${data.amount}, ${rule.note})
    `;
    const next = await purse(context.userId, data.game, rule.cap);
    return { ...next, credited: true };
  });
