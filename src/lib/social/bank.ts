import { createServerFn } from "@tanstack/react-start";
import { setResponseStatus } from "@tanstack/react-start/server";
import { wholeVubles } from "@/lib/social/amount";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { assertActive } from "@/lib/social/access";
import { isUniqueViolation } from "@/lib/social/sql-error";
import { priceOf } from "@/lib/social/prices";

const START = 1000;
const SHOP_COST = 1000;
const SHOP_EXTRA = 100;
const REFERRAL = 1000;

export type BankMove = {
  id: string;
  direction: "in" | "out";
  name: string;
  amount: number;
  note: string;
  createdAt: string;
};

export type BankPerson = {
  id: string;
  name: string;
  image: string | null;
};

export type BankCard = {
  holder: string;
  pan: string;
  exp: string;
  cvv: string;
};

export type BankInvite = {
  id: string;
  name: string;
  image: string | null;
  createdAt: string;
};

export type BankLoan = {
  principal: number;
  left: number;
  dueAt: number;
};

export type BankSnapshot = {
  balance: number;
  nextGrantAt: number;
  boostRequests: number;
  boostUntil: number | null;
  card: BankCard;
  history: BankMove[];
  referralCode: string;
  invited: BankInvite[];
  loan: BankLoan | null;
};

export type ClaimStatus = "rewarded" | "already" | "self" | "stale" | "unknown" | "empty";

function personId(value: unknown): string {
  if (typeof value !== "string") throw new Error("Выберите, кому перевести");
  const id = value.trim();
  if (!id || id.length > 128 || /[\s"'<>]/.test(id)) throw new Error("Выберите, кому перевести");
  return id;
}

function rejectAmount(status: number, message: string): never {
  try {
    setResponseStatus(status);
  } catch {
    /* the message still rejects the request */
  }
  throw new Error(message);
}

function amountOf(value: unknown): number {
  const n = wholeVubles(value);
  if (n == null) rejectAmount(400, "Сумма от 1 до 100 000 вублей");
  return n;
}

function noteOf(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, 80);
}

function queryOf(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/[%_\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
}

function randInt(max: number): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % max;
}

function luhnCheck(body: string): string {
  let sum = 0;
  const digits = body.split("").reverse();
  for (let i = 0; i < digits.length; i += 1) {
    let n = Number(digits[i]);
    if (i % 2 === 0) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return String((10 - (sum % 10)) % 10);
}

function makePan(): string {
  let body = "7770";
  for (let i = 0; i < 11; i += 1) body += randInt(10).toString();
  return body + luhnCheck(body);
}

function makeExp(): string {
  const month = String(1 + randInt(12)).padStart(2, "0");
  const year = String((new Date().getFullYear() + 3 + randInt(4)) % 100).padStart(2, "0");
  return `${month}/${year}`;
}

function makeCvv(): string {
  return String(randInt(1000)).padStart(3, "0");
}

function makeCode(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}

async function ensureReferralCode(userId: string): Promise<string> {
  const sql = await getSql();
  const existing = await sql<{ code: string }>`select code from referral_codes where user_id = ${userId}`;
  if (existing[0]?.code) return existing[0].code;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = makeCode();
    try {
      const rows = await sql<{ code: string }>`
        insert into referral_codes (user_id, code)
        values (${userId}, ${code})
        on conflict (user_id) do nothing
        returning code
      `;
      if (rows[0]?.code) return rows[0].code;
    } catch {
      /* code clash, try another */
    }
    const again = await sql<{ code: string }>`select code from referral_codes where user_id = ${userId}`;
    if (again[0]?.code) return again[0].code;
  }
  throw new Error("Не удалось сделать ссылку");
}

function referralCodeOf(value: unknown): string {
  const raw = typeof value === "string" ? value : value && typeof value === "object" ? (value as { code?: unknown }).code : "";
  if (typeof raw !== "string") return "";
  const code = raw.trim().toLowerCase();
  return /^[a-z0-9]{8}$/.test(code) ? code : "";
}

async function ensureCard(userId: string) {
  const sql = await getSql();
  const rows = await sql<{ card_pan: string | null }>`
    select card_pan from wallets where user_id = ${userId}
  `;
  if (rows[0]?.card_pan && /^\d{16}$/.test(rows[0].card_pan)) return;
  const pan = makePan();
  const exp = makeExp();
  const cvv = makeCvv();
  await sql`
    update wallets
    set card_pan = ${pan}, card_exp = ${exp}, card_cvv = ${cvv}
    where user_id = ${userId}
      and (card_pan is null or length(card_pan) <> 16)
  `;
}

async function ensureWallet(userId: string) {
  const sql = await getSql();
  await sql`
    insert into wallets (user_id, balance, last_grant_at)
    values (${userId}, ${START}, now())
    on conflict (user_id) do nothing
  `;
  await ensureCard(userId);
}

async function readBank(userId: string, days: 5 | 30 = 5): Promise<BankSnapshot> {
  await ensureWallet(userId);
  await collectDueLoan(userId);
  const sql = await getSql();
  const wallet = await sql<{
    balance: number;
    grant_ms: number | string;
    card_pan: string | null;
    card_exp: string | null;
    card_cvv: string | null;
    holder: string | null;
  }>`
    select w.balance,
           (extract(epoch from w.last_grant_at) * 1000) as grant_ms,
           w.card_pan,
           w.card_exp,
           w.card_cvv,
           u.name as holder
    from wallets w
    left join "user" u on u.id = w.user_id
    where w.user_id = ${userId}
  `;
  const boost = await sql<{ extra: number; until_ms: number | string | null }>`
    select coalesce(sum(extra_requests), 0)::int as extra,
           max(extract(epoch from expires_at) * 1000) as until_ms
    from limit_boosts
    where user_id = ${userId}
      and expires_at > now()
  `;
  const rows = await sql<{
    id: string;
    amount: number;
    note: string;
    created_at: string;
    from_id: string | null;
    to_id: string | null;
    from_name: string | null;
    to_name: string | null;
  }>`
    select t.id,
           t.amount,
           t.note,
           t.created_at::text as created_at,
           t.from_id,
           t.to_id,
           fu.name as from_name,
           tu.name as to_name
    from wallet_transfers t
    left join "user" fu on fu.id = t.from_id
    left join "user" tu on tu.id = t.to_id
    where (t.from_id = ${userId} or t.to_id = ${userId})
      and t.created_at >= now() - (${days === 30 ? "30 days" : "5 days"}::interval)
    order by t.created_at desc
    limit 40
  `;
  const invitedRows = await sql<{ id: string; name: string | null; image: string | null; created_at: string }>`
    select j.invitee_id as id, u.name, u.image, j.created_at::text as created_at
    from referral_joins j
    join "user" u on u.id = j.invitee_id
    where j.inviter_id = ${userId}
    order by j.created_at desc
    limit 40
  `;
  const referralCode = await ensureReferralCode(userId);
  const loanRows = await sql<{ principal: number; left_amount: number; due_ms: number | string }>`
    select principal,
           left_amount,
           (extract(epoch from due_at) * 1000) as due_ms
    from bank_loans
    where user_id = ${userId} and closed_at is null
    order by created_at desc
    limit 1
  `;
  const row = wallet[0];
  const grantMs = Math.round(Number(row?.grant_ms ?? Date.now()));
  const until = boost[0]?.until_ms == null ? null : Math.round(Number(boost[0].until_ms));
  const pan = row?.card_pan && /^\d{16}$/.test(row.card_pan) ? row.card_pan : "7770000000000000";
  return {
    balance: Number(row?.balance ?? 0),
    nextGrantAt: grantMs + 24 * 60 * 60 * 1000,
    boostRequests: Number(boost[0]?.extra ?? 0),
    boostUntil: until && Number.isFinite(until) ? until : null,
    card: {
      holder: (row?.holder || "Участник").slice(0, 42),
      pan,
      exp: /^\d{2}\/\d{2}$/.test(row?.card_exp || "") ? row!.card_exp! : "12/30",
      cvv: /^\d{3}$/.test(row?.card_cvv || "") ? row!.card_cvv! : "000",
    },
    history: rows.map((move) => {
      const incoming = move.to_id === userId && move.from_id !== userId;
      return {
        id: move.id,
        direction: incoming ? "in" : "out",
        name: incoming ? move.from_name || "Участник" : move.to_name || "Участник",
        amount: Number(move.amount),
        note: move.note,
        createdAt: move.created_at,
      };
    }),
    referralCode,
    invited: invitedRows.map((person) => ({
      id: person.id,
      name: person.name || "Участник",
      image: person.image,
      createdAt: person.created_at,
    })),
    loan: loanRows[0]
      ? {
          principal: Number(loanRows[0].principal),
          left: Number(loanRows[0].left_amount),
          dueAt: Math.round(Number(loanRows[0].due_ms)),
        }
      : null,
  };
}

export const getBank = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: unknown): 5 | 30 => {
    const raw = typeof input === "number" ? input : input && typeof input === "object" ? (input as { days?: unknown }).days : undefined;
    return raw === 30 ? 30 : 5;
  })
  .handler(async ({ context, data }): Promise<BankSnapshot> => {
    await assertActive(context.userId);
    return readBank(context.userId, data);
  });

export const searchBankPeople = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => queryOf(input && typeof input === "object" ? (input as { query?: unknown }).query : ""))
  .handler(async ({ context, data }): Promise<BankPerson[]> => {
    await assertActive(context.userId);
    if (data.length < 2) return [];
    const sql = await getSql();
    const like = `%${data}%`;
    const rows = await sql<{ id: string; name: string | null; image: string | null }>`
      select id, name, image
      from "user"
      where id <> ${context.userId}
        and name ilike ${like}
      order by name asc
      limit 8
    `;
    return rows.map((row) => ({ id: row.id, name: row.name || "Участник", image: row.image }));
  });

export const findCardOwner = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = typeof input === "string" ? input : input && typeof input === "object" ? (input as { pan?: unknown }).pan : "";
    const pan = String(raw ?? "").replace(/\D/g, "");
    if (!/^\d{16}$/.test(pan)) throw new Error("Номер карты — 16 цифр");
    return pan;
  })
  .handler(async ({ context, data }): Promise<BankPerson> => {
    await assertActive(context.userId);
    const sql = await getSql();
    const rows = await sql<{ id: string; name: string | null; image: string | null }>`
      select u.id, u.name, u.image
      from wallets w
      join "user" u on u.id = w.user_id
      where w.card_pan = ${data}
      limit 1
    `;
    const row = rows[0];
    if (!row) throw new Error("Карта не найдена");
    if (row.id === context.userId) throw new Error("Это ваша карта");
    return { id: row.id, name: row.name || "Участник", image: row.image };
  });

export const transferWoobli = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Перевод не собран");
    const raw = input as { toId?: unknown; amount?: unknown; note?: unknown };
    return { toId: personId(raw.toId), amount: amountOf(raw.amount), note: noteOf(raw.note) };
  })
  .handler(async ({ context, data }): Promise<BankSnapshot> => {
    await assertActive(context.userId);
    if (data.toId === context.userId) throw new Error("Себе перевести нельзя");
    const sql = await getSql();
    const known = await sql<{ id: string }>`select id from "user" where id = ${data.toId}`;
    if (!known.length) throw new Error("Такого участника нет");
    await ensureWallet(context.userId);
    await ensureWallet(data.toId);
    const id = crypto.randomUUID();
    const done = await sql<{ id: string }>`
      with debit as (
        update wallets
        set balance = balance - ${data.amount}
        where user_id = ${context.userId} and balance >= ${data.amount}
        returning user_id
      ),
      credit as (
        update wallets
        set balance = balance + ${data.amount}
        where user_id = ${data.toId} and exists (select 1 from debit)
        returning user_id
      )
      insert into wallet_transfers (id, from_id, to_id, amount, note)
      select ${id}, ${context.userId}, ${data.toId}, ${data.amount}, ${data.note}
      where exists (select 1 from credit)
      returning id
    `;
    if (!done.length) rejectAmount(400, "Не хватает вублей");
    const from = context.userId;
    void import("@/lib/social/push.server")
      .then(async (mod) => {
        const { senderName } = await import("@/lib/social/telegram.server");
        const name = await senderName(from);
        await mod.pushNotice(data.toId, "money", {
          id: `vubli-in:${id}`,
          title: `Вам перевели ${data.amount} вублей`,
          body: `От ${name}`,
          url: "/c/bank",
        });
      })
      .catch(() => undefined);
    return readBank(context.userId);
  });

export async function purchaseLimitBoost(userId: string, idem?: string): Promise<BankSnapshot> {
  await ensureWallet(userId);
  const price = await priceOf("boost", SHOP_COST);
  const sql = await getSql();
  const id = idem ? `boost-${idem}` : crypto.randomUUID();
  if (idem) {
    const prev = await sql<{ id: string }>`select id from limit_boosts where id = ${id} and user_id = ${userId}`;
    if (prev.length) return readBank(userId);
  }
  let done: { id: string }[];
  try {
    done = await sql<{ id: string }>`
      with debit as (
        update wallets
        set balance = balance - ${price}
        where user_id = ${userId} and balance >= ${price}
        returning user_id
      )
      insert into limit_boosts (id, user_id, extra_requests, expires_at)
      select ${id}, ${userId}, ${SHOP_EXTRA}, now() + interval '24 hours'
      where exists (select 1 from debit)
      returning id
    `;
  } catch (err) {
    if (idem && isUniqueViolation(err)) return readBank(userId);
    throw err;
  }
  if (!done.length) throw new Error(`Нужно ${price} вублей`);
  void import("@/lib/social/push.server")
    .then((mod) =>
      mod.pushNotice(userId, "money", {
        id: `shop:${id}`,
        title: "Покупка оформлена",
        body: "Дополнительный лимит на сутки",
        url: "/c/shop",
      }),
    )
    .catch(() => undefined);
  return readBank(userId);
}

export const buyLimitBoost = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<BankSnapshot> => {
    await assertActive(context.userId);
    return purchaseLimitBoost(context.userId);
  });

export const claimReferral = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(referralCodeOf)
  .handler(async ({ context, data }): Promise<{ status: ClaimStatus }> => {
    if (!data) return { status: "empty" };
    await assertActive(context.userId);
    const sql = await getSql();
    const inviter = await sql<{ user_id: string }>`select user_id from referral_codes where code = ${data}`;
    if (!inviter.length) return { status: "unknown" };
    const inviterId = inviter[0].user_id;
    if (inviterId === context.userId) return { status: "self" };
    const joined = await sql<{ invitee_id: string }>`
      select invitee_id from referral_joins where invitee_id = ${context.userId}
    `;
    if (joined.length) return { status: "already" };
    const fresh = await sql<{ created_at: string }>`
      select "createdAt"::text as created_at
      from "user"
      where id = ${context.userId}
    `;
    const created = fresh[0] ? Date.parse(fresh[0].created_at) : Number.NaN;
    if (!Number.isFinite(created) || Date.now() - created > 48 * 60 * 60 * 1000) return { status: "stale" };
    await ensureWallet(inviterId);
    const paid = await sql<{ user_id: string }>`
      with joined as (
        insert into referral_joins (invitee_id, inviter_id)
        values (${context.userId}, ${inviterId})
        on conflict (invitee_id) do nothing
        returning invitee_id
      )
      update wallets
      set balance = balance + ${REFERRAL}
      where user_id = ${inviterId}
        and exists (select 1 from joined)
      returning user_id
    `;
    if (!paid.length) return { status: "already" };
    return { status: "rewarded" };
  });

const LOAN_AMOUNTS = new Set([500, 1000, 2000]);

function loanAmount(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!LOAN_AMOUNTS.has(n)) throw new Error("Кредит: 500, 1000 или 2000 вублей");
  return n;
}

async function collectDueLoan(userId: string): Promise<void> {
  const sql = await getSql();
  const open = await sql<{ id: string; left_amount: number }>`
    select id, left_amount
    from bank_loans
    where user_id = ${userId} and closed_at is null and due_at <= now()
    limit 1
  `;
  const loan = open[0];
  if (!loan) return;
  const left = Number(loan.left_amount);
  if (left <= 0) {
    await sql`update bank_loans set closed_at = now(), left_amount = 0 where id = ${loan.id}`;
    return;
  }
  const id = `loan-due-${loan.id}`;
  await sql`
    with done as (
      update bank_loans
      set left_amount = 0, closed_at = now()
      where id = ${loan.id} and closed_at is null
      returning id
    ),
    cut as (
      update wallets
      set balance = balance - ${left}
      where user_id = ${userId} and exists (select 1 from done)
      returning user_id
    )
    insert into wallet_transfers (id, from_id, to_id, amount, note)
    select ${id}, ${userId}, null, ${left}, 'Кредит в минус'
    where exists (select 1 from cut)
  `;
}

export const takeLoan = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => loanAmount(input && typeof input === "object" ? (input as { amount?: unknown }).amount : input))
  .handler(async ({ context, data }): Promise<BankSnapshot> => {
    await assertActive(context.userId);
    await ensureWallet(context.userId);
    await collectDueLoan(context.userId);
    const sql = await getSql();
    const open = await sql<{ id: string }>`
      select id from bank_loans where user_id = ${context.userId} and closed_at is null limit 1
    `;
    if (open.length) throw new Error("Сначала закройте текущий кредит");
    const purse = await sql<{ balance: number }>`select balance from wallets where user_id = ${context.userId}`;
    if (Number(purse[0]?.balance ?? 0) < 0) throw new Error("Пока баланс ниже нуля, новый кредит закрыт");
    const loanId = crypto.randomUUID();
    const moveId = `loan-${loanId}`;
    const done = await sql<{ id: string }>`
      with credit as (
        update wallets
        set balance = balance + ${data}
        where user_id = ${context.userId}
        returning user_id
      ),
      loan as (
        insert into bank_loans (id, user_id, principal, left_amount, due_at)
        select ${loanId}, user_id, ${data}, ${data}, now() + interval '7 days'
        from credit
        returning id
      )
      insert into wallet_transfers (id, from_id, to_id, amount, note)
      select ${moveId}, null, ${context.userId}, ${data}, 'Кредит'
      where exists (select 1 from loan)
      returning id
    `;
    if (!done.length) throw new Error("Кредит не открылся");
    return readBank(context.userId);
  });

export const repayLoan = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = input && typeof input === "object" ? (input as { amount?: unknown; full?: unknown }).amount : input;
    return amountOf(raw);
  })
  .handler(async ({ context, data }): Promise<BankSnapshot> => {
    await assertActive(context.userId);
    await ensureWallet(context.userId);
    const sql = await getSql();
    const open = await sql<{ id: string; left_amount: number }>`
      select id, left_amount from bank_loans
      where user_id = ${context.userId} and closed_at is null
      limit 1
    `;
    const loan = open[0];
    if (!loan) throw new Error("Открытого кредита нет");
    const left = Number(loan.left_amount);
    if (data > left) rejectAmount(400, "Сумма больше остатка");
    const pay = data;
    const moveId = `repay-${crypto.randomUUID()}`;
    const done = await sql<{ id: string }>`
      with debit as (
        update wallets
        set balance = balance - ${pay}
        where user_id = ${context.userId} and balance >= ${pay}
        returning user_id
      ),
      loan as (
        update bank_loans
        set left_amount = left_amount - ${pay},
            closed_at = case when left_amount - ${pay} <= 0 then now() else null end
        where id = ${loan.id} and closed_at is null and left_amount >= ${pay}
          and exists (select 1 from debit)
        returning id
      )
      insert into wallet_transfers (id, from_id, to_id, amount, note)
      select ${moveId}, ${context.userId}, null, ${pay}, 'Возврат кредита'
      where exists (select 1 from loan)
      returning id
    `;
    if (!done.length) rejectAmount(400, "На карте не хватает вублей для этого возврата");
    return readBank(context.userId);
  });

export const settleLoan = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<BankSnapshot> => {
    await assertActive(context.userId);
    await ensureWallet(context.userId);
    const sql = await getSql();
    const open = await sql<{ id: string; left_amount: number }>`
      select id, left_amount from bank_loans
      where user_id = ${context.userId} and closed_at is null
      limit 1
    `;
    const loan = open[0];
    if (!loan) throw new Error("Открытого кредита нет");
    const left = Number(loan.left_amount);
    const moveId = `loan-minus-${loan.id}`;
    await sql`
      with done as (
        update bank_loans
        set left_amount = 0, closed_at = now()
        where id = ${loan.id} and closed_at is null
        returning id
      ),
      cut as (
        update wallets
        set balance = balance - ${left}
        where user_id = ${context.userId} and exists (select 1 from done)
        returning user_id
      )
      insert into wallet_transfers (id, from_id, to_id, amount, note)
      select ${moveId}, ${context.userId}, null, ${left}, 'Кредит в минус'
      where exists (select 1 from cut)
    `;
    return readBank(context.userId);
  });

