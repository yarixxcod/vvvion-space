import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { assertActive } from "@/lib/social/access";
import { priceOf } from "@/lib/social/prices";
import { isUniqueViolation } from "@/lib/social/sql-error";

export const PREMIUM_PRICE = 2500;
export const PREMIUM_DAYS = 30;
export const PREMIUM_DISK = 500 * 1024 * 1024;

export type PremiumState = {
  active: boolean;
  until: string | null;
  price: number;
  days: number;
  verified: boolean;
};

export type FaceMarks = {
  admins: string[];
  premiums: string[];
};

async function verified(userId: string): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql<{ ok: boolean | null }>`
    select "emailVerified" as ok from "user" where id = ${userId}
  `;
  return Boolean(rows[0]?.ok);
}

export async function isPremium(userId: string): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql<{ user_id: string }>`
    select user_id from premium_grants
    where user_id = ${userId} and until_at > now()
    limit 1
  `;
  return rows.length > 0;
}

export async function readPremium(userId: string): Promise<PremiumState> {
  const sql = await getSql();
  const rows = await sql<{ until_at: string | null }>`
    select until_at::text as until_at
    from premium_grants
    where user_id = ${userId} and until_at > now()
  `;
  return {
    active: Boolean(rows[0]?.until_at),
    until: rows[0]?.until_at ?? null,
    price: await priceOf("premium", PREMIUM_PRICE),
    days: PREMIUM_DAYS,
    verified: await verified(userId),
  };
}

export async function grantPremium(userId: string, by: string | null): Promise<void> {
  const sql = await getSql();
  await sql`
    insert into premium_grants (user_id, until_at, source, granted_by, updated_at)
    values (${userId}, now() + interval '30 days', 'admin', ${by}, now())
    on conflict (user_id) do update
      set until_at = greatest(premium_grants.until_at, now()) + interval '30 days',
          source = 'admin',
          granted_by = ${by},
          updated_at = now()
  `;
}

export async function revokePremium(userId: string): Promise<void> {
  const sql = await getSql();
  await sql`delete from premium_grants where user_id = ${userId}`;
}

export async function purchasePremium(userId: string, idem?: string): Promise<PremiumState> {
  if (!(await verified(userId))) {
    throw new Error("Сначала подтвердите почту в профиле. Без этого подписку не купить.");
  }
  const price = await priceOf("premium", PREMIUM_PRICE);
  const sql = await getSql();
  await sql`
    insert into wallets (user_id, balance, last_grant_at)
    values (${userId}, 1000, now())
    on conflict (user_id) do nothing
  `;
  const id = idem ? `prem-${idem}` : `premium-${crypto.randomUUID()}`;
  if (idem) {
    const prev = await sql<{ id: string }>`select id from wallet_transfers where id = ${id}`;
    if (prev.length) return readPremium(userId);
  }
  let done: { id: string }[];
  try {
    done = await sql<{ id: string }>`
      with debit as (
        update wallets
        set balance = balance - ${price}
        where user_id = ${userId} and balance >= ${price}
        returning user_id
      ),
      opened as (
        insert into premium_grants (user_id, until_at, source, granted_by, updated_at)
        select user_id, now() + interval '30 days', 'shop', null, now()
        from debit
        on conflict (user_id) do update
          set until_at = greatest(premium_grants.until_at, now()) + interval '30 days',
              source = 'shop',
              granted_by = null,
              updated_at = now()
        returning user_id
      )
      insert into wallet_transfers (id, from_id, to_id, amount, note)
      select ${id}, ${userId}, null, ${price}, 'Premium'
      where exists (select 1 from opened)
      returning id
    `;
  } catch (err) {
    if (idem && isUniqueViolation(err)) return readPremium(userId);
    throw err;
  }
  if (!done.length) throw new Error(`Нужно ${price} вублей`);
  void import("@/lib/social/push.server")
    .then((mod) =>
      mod.pushNotice(userId, "money", {
        id: `shop:${id}`,
        title: "Покупка оформлена",
        body: "Премиум на 30 дней",
        url: "/c/shop",
      }),
    )
    .catch(() => undefined);
  return readPremium(userId);
}

export const getPremium = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<PremiumState> => {
    await assertActive(context.userId);
    return readPremium(context.userId);
  });

export const buyPremium = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<PremiumState> => {
    await assertActive(context.userId);
    return purchasePremium(context.userId);
  });

export const listFaceMarks = createServerFn({ method: "GET" }).handler(async (): Promise<FaceMarks> => {
  const sql = await getSql();
  const admins = await sql<{ user_id: string }>`select user_id from members where role = 'admin' limit 40`;
  const premiums = await sql<{ user_id: string }>`
    select user_id from premium_grants where until_at > now() limit 200
  `;
  return {
    admins: admins.map((row) => row.user_id),
    premiums: premiums.map((row) => row.user_id),
  };
});
