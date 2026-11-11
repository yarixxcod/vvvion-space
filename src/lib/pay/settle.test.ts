import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { settleInvoice, type ProviderInvoice, type SqlRunner } from "./settle.ts";

const migration = readFileSync(new URL("../../../migrations/0045_wallet_pay.sql", import.meta.url), "utf8");

function paid(over: Partial<ProviderInvoice> = {}): ProviderInvoice {
  return {
    invoiceId: "42",
    hash: "hash",
    payload: null,
    status: "paid",
    currencyType: "fiat",
    fiat: "RUB",
    amount: "50.00",
    paidAt: "2026-11-11T12:00:00.000Z",
    paidAsset: "USDT",
    paidAmount: "0.55",
    paidUsdRate: "1",
    feeAsset: "USDT",
    feeAmount: "0.01",
    ...over,
  };
}

async function db() {
  const pg = new PGlite();
  await pg.exec(`
    create table "user" (id text primary key);
    create table wallets (
      user_id text primary key references "user" (id) on delete cascade,
      balance integer not null default 0,
      last_grant_at timestamptz not null default now()
    );
  `);
  await pg.exec(migration);
  await pg.query(`insert into "user" (id) values ('u1')`);
  await pg.query(`insert into wallets (user_id, balance) values ('u1', 100)`);
  await pg.query(
    `insert into vubli_topups (
       id, user_id, network, status, fiat, fiat_amount, tier_id, rate_x1000, rate_version,
       vubli_total, vubli_purchased, vubli_bonus, idem_key, expires_at, provider_invoice_id
     ) values (
       '11111111-1111-4111-8111-111111111111', 'u1', 'mainnet', 'pending', 'RUB', 50, 'xs', 9600, '2026-11-v1',
       480, 480, 0, 'idem-1', now() + interval '30 minutes', 42
     )`,
  );
  const runner = (tx: { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }): SqlRunner => ({
    query: async <T,>(text: string, params?: unknown[]) => (await tx.query(text, params)).rows as T[],
  });
  return { pg, runner };
}

test("a paid invoice credits once, a duplicate does not", async () => {
  const { pg, runner } = await db();
  const first = await pg.transaction(async (tx) => settleInvoice(runner(tx), "mainnet", paid(), false));
  const second = await pg.transaction(async (tx) => settleInvoice(runner(tx), "mainnet", paid(), false));
  const balance = await pg.query<{ balance: number }>(`select balance from wallets where user_id = 'u1'`);
  const ledger = await pg.query(`select id from wallet_ledger where user_id = 'u1'`);
  assert.equal(first, "credited");
  assert.equal(second, "duplicate");
  assert.equal(Number(balance.rows[0]?.balance), 580);
  assert.equal(ledger.rows.length, 1);
});

test("parallel settles still credit once", async () => {
  const { pg, runner } = await db();
  const results = await Promise.all([
    pg.transaction(async (tx) => settleInvoice(runner(tx), "mainnet", paid(), false)),
    pg.transaction(async (tx) => settleInvoice(runner(tx), "mainnet", paid(), false)),
  ]);
  const balance = await pg.query<{ balance: number }>(`select balance from wallets where user_id = 'u1'`);
  assert.deepEqual(results.slice().sort(), ["credited", "duplicate"]);
  assert.equal(Number(balance.rows[0]?.balance), 580);
});

test("a mismatched amount is not credited", async () => {
  const { pg, runner } = await db();
  const outcome = await pg.transaction(async (tx) => settleInvoice(runner(tx), "mainnet", paid({ amount: "51.00" }), false));
  const row = await pg.query<{ status: string; balance: number }>(
    `select t.status, w.balance from vubli_topups t join wallets w on w.user_id = t.user_id`,
  );
  assert.equal(outcome, "mismatch");
  assert.equal(row.rows[0]?.status, "manual_review");
  assert.equal(Number(row.rows[0]?.balance), 100);
});

test("unknown invoice and bad signature path do not touch the balance", async () => {
  const { pg, runner } = await db();
  const outcome = await pg.transaction(async (tx) => settleInvoice(runner(tx), "mainnet", paid({ invoiceId: "99", payload: "nope" }), false));
  const balance = await pg.query<{ balance: number }>(`select balance from wallets where user_id = 'u1'`);
  assert.equal(outcome, "unknown_invoice");
  assert.equal(Number(balance.rows[0]?.balance), 100);
});
