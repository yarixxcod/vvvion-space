import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { gameClaim, readGamePurse, settleGamePayout, type GameSql } from "./payout.ts";
let pg: PGlite;
const runner = (db: {
  query: (s: string, p?: unknown[]) => Promise<{ rows: unknown[] }>;
}): GameSql => ({
  query: async <T>(s: string, p?: unknown[]) => (await db.query(s, p)).rows as T[],
});
const claim = (raw: unknown, user = "u1") =>
  pg.transaction((tx) => settleGamePayout(runner(tx), user, raw));
before(async () => {
  pg = new PGlite();
  await pg.exec(
    `create table wallets(user_id text primary key,balance integer not null,last_grant_at timestamptz not null default now());create table game_payouts(id text primary key,user_id text not null,amount integer not null,game text not null,created_at timestamptz not null default now());create table wallet_transfers(id text primary key,from_id text,to_id text,amount integer not null,note text);`,
  );
});
after(async () => pg.close());
beforeEach(async () => {
  await pg.exec(
    `truncate wallet_transfers,game_payouts,wallets;insert into wallets(user_id,balance) values ('u1',100),('u2',200);`,
  );
});
test("one award creates one credit and one ledger entry; retry acknowledges receipt", async () => {
  const raw = { game: "mine", amount: 8, ticket: "receipt0001" };
  assert.equal((await claim(raw)).balance, 108);
  const retry = await claim(raw);
  assert.equal(retry.credited, false);
  assert.equal(retry.receipt, "duplicate");
  assert.equal(retry.balance, 108);
  assert.equal((await pg.query("select * from wallet_transfers")).rows.length, 1);
});
test("concurrent duplicate claims credit exactly once", async () => {
  const raw = { game: "snake", amount: 2, ticket: "receipt0002" };
  const out = await Promise.all([claim(raw), claim(raw)]);
  assert.equal(out.filter((x) => x.credited).length, 1);
  assert.equal((await readGamePurse(runner(pg), "u1", "snake")).balance, 102);
});
test("different parallel tickets cannot exceed the cap or cooldown", async () => {
  await pg.exec(
    `insert into game_payouts values('oldaward','u1',56,'stall',now()-interval '2 hours');`,
  );
  const outcomes = await Promise.allSettled([
    claim({ game: "stall", amount: 4, ticket: "receipt0003" }),
    claim({ game: "stall", amount: 4, ticket: "receipt0004" }),
  ]);
  assert.equal(outcomes.filter((x) => x.status === "fulfilled").length, 1);
  const next = await readGamePurse(runner(pg), "u1", "stall");
  assert.equal(next.today, 60);
  assert.equal(next.balance, 104);
});
test("failure writing ledger rolls back both balance and payout receipt", async () => {
  await pg.exec(
    `insert into wallet_transfers values('mine-receipt0005',null,'u1',1,'test collision');`,
  );
  await assert.rejects(() => claim({ game: "mine", amount: 8, ticket: "receipt0005" }));
  assert.equal((await readGamePurse(runner(pg), "u1", "mine")).balance, 100);
  assert.equal(
    (await pg.query(`select * from game_payouts where id='receipt0005'`)).rows.length,
    0,
  );
});
test("ticket cannot be reused by a different account or game", async () => {
  await claim({ game: "mine", amount: 8, ticket: "receipt0006" });
  await assert.rejects(() => claim({ game: "mine", amount: 8, ticket: "receipt0006" }, "u2"));
  await assert.rejects(() => claim({ game: "snake", amount: 2, ticket: "receipt0006" }));
  assert.equal((await readGamePurse(runner(pg), "u2", "mine")).balance, 200);
});
test("rolling 24 hour limit excludes expired awards; games have independent caps", async () => {
  await pg.exec(
    `insert into game_payouts values('expired1','u1',40,'mine',now()-interval '25 hours');insert into game_payouts values('recent01','u1',36,'snake',now()-interval '1 hour');`,
  );
  assert.equal((await claim({ game: "mine", amount: 8, ticket: "receipt0007" })).today, 8);
  await assert.rejects(() => claim({ game: "snake", amount: 2, ticket: "receipt0008" }));
});
test("forged amounts, unknown practice games and invalid receipts are rejected", () => {
  for (const raw of [
    { game: "mine", amount: 800, ticket: "receipt0009" },
    { game: "tiles", amount: 2, ticket: "receipt0009" },
    { game: "snake", amount: -2, ticket: "receipt0009" },
    { game: "stall", amount: NaN, ticket: "receipt0009" },
    { game: "mine", amount: 8, ticket: "<bad>" },
  ])
    assert.throws(() => gameClaim(raw));
});
