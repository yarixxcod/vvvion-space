import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";

function load(path, deps = {}) {
  const code = ts.transpileModule(
    readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const exports = {};
  new Function("require", "exports", code)((id) => {
    if (id in deps) return deps[id];
    throw new Error(`Unmocked ${id}`);
  }, exports);
  return exports;
}
const query = load("lib/social/people-query.ts");
const builder = () => ({
  middleware() {
    return this;
  },
  validator(fn) {
    this.validate = fn;
    return this;
  },
  handler(fn) {
    const validate = this.validate ?? ((x) => x);
    return ({ data, userId = "buyer" } = {}) => fn({ data: validate(data), context: { userId } });
  },
});

test("usernames resolve consistently across gifts, friends and transfers; self gifts are charged and resold once", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create table "user" (id text primary key, name text, email text, image text, "emailVerified" boolean);
      create table user_handles (user_id text primary key, handle text unique);
      create table members (user_id text, banned_at timestamptz);
      create table friend_links (from_id text, to_id text, status text);
      create table wallets (user_id text primary key, balance int, earned int default 0, last_grant_at timestamptz default now());
      create table shop_prices (sku text primary key, title text, note text, price int, section text, enabled boolean);
      create table gift_receipts (id text primary key, from_id text, to_id text, sku text, title text, note text, created_at timestamptz default now(), sold_at timestamptz, resale_amount int);
      create table wallet_transfers (id text primary key, from_id text, to_id text, amount int, note text);
      create table wallet_ledger (id text, user_id text, kind text, bucket text, amount int, balance_after int, ref_type text, ref_id text, idem_key text, meta jsonb);
      insert into "user" values ('buyer','Покупатель','buyer@test',null,true),('friend','Друг','friend@test',null,true),('wildcard','Другой','other@test',null,true),('banned','Заблокирован','banned@test',null,true);
      insert into user_handles values ('buyer','my_self'),('friend','test_name'),('wildcard','testxname'),('banned','test_banned');
      insert into members values ('banned',now());
      insert into wallets values ('buyer',1000,0,now());
      insert into shop_prices values ('gift:rose','Роза','',100,'gifts',true);
    `);
    const makeSql = (session) => {
      const sql = async (strings, ...values) =>
        (
          await session.query(
            strings.reduce(
              (text, part, i) => text + part + (i < values.length ? `$${i + 1}` : ""),
              "",
            ),
            values,
          )
        ).rows;
      sql.query = async (text, values) => (await session.query(text, values)).rows;
      return sql;
    };
    const sql = makeSql(db);
    const common = {
      "@tanstack/react-start": { createServerFn: builder },
      "@tanstack/react-start/server": { setResponseStatus() {} },
      "@/lib/auth/middleware": { authMiddleware: {} },
      "@/lib/storage/disk-blob": { decodeDiskBlob: async (_owner, data) => Buffer.from(data, "base64") },
      "@/lib/db": {
        getSql: async () => sql,
        withTransaction: (fn) => db.transaction((tx) => fn(makeSql(tx))),
      },
      "@/lib/social/access": { assertActive: async () => {} },
      "@/lib/social/sql-error": { isUniqueViolation: (err) => err.code === "23505" },
      "@/lib/social/people-query": query,
      "@/lib/social/amount": { wholeVubles: Number },
      "@/lib/social/prices": { priceOf() {} },
      "@/lib/social/achievements": { grantAchievement() {} },
      "@/lib/stickers": { stickerCode() {} },
      "@/lib/screen/mark": {},
    };
    const handles = load("lib/social/handles.ts", common);
    const gifts = load("lib/social/gifts.ts", { ...common, "@/lib/social/handles": handles });
    const bank = load("lib/social/bank.ts", common);
    const messenger = load("lib/social/messenger.ts", common);
    for (const input of ["@Test_Name", "test_name", "  @TEST_NAME  "]) {
      assert.equal((await handles.lookupHandle({ data: { handle: input } })).handle, "test_name");
      assert.deepEqual(
        (await messenger.searchPeople({ data: input })).map((p) => p.id),
        ["friend"],
      );
      assert.deepEqual(
        (await bank.searchBankPeople({ data: { query: input } })).map((p) => p.id),
        ["friend"],
      );
    }
    assert.equal((await messenger.searchPeople({ data: "@my_self" })).length, 0);
    assert.equal((await bank.searchBankPeople({ data: { query: "@my_self" } })).length, 0);
    assert.equal(
      (await messenger.searchPeople({ data: "@test_" })).some((p) => p.id === "banned"),
      false,
    );
    assert.equal((await bank.searchBankPeople({ data: { query: "%" } })).length, 0);
    const idem = crypto.randomUUID();
    await gifts.sendGift({ data: { self: true, sku: "gift:rose", idempotencyKey: idem } });
    await gifts.sendGift({ data: { self: true, sku: "gift:rose", idempotencyKey: idem } });
    const inbox = await gifts.getGiftDesk();
    assert.equal(inbox.inbox.length, 1);
    assert.equal((await sql`select balance from wallets where user_id = 'buyer'`)[0].balance, 900);
    assert.equal((await sql`select from_id, to_id from gift_receipts`)[0].to_id, "buyer");
    await gifts.sellReceivedGift({ data: { id: `gift-${idem}` } });
    await assert.rejects(
      () => gifts.sellReceivedGift({ data: { id: `gift-${idem}` } }),
      /уже продан/,
    );
    assert.equal((await sql`select balance from wallets where user_id = 'buyer'`)[0].balance, 950);
    assert.equal((await gifts.getGiftDesk()).inbox.length, 0);
    await assert.rejects(
      () => gifts.sendGiftTo("buyer", "gift:rose", "", "", crypto.randomUUID()),
      /Юзернейм/,
    );
    await gifts.sendGiftTo("buyer", "gift:rose", "@TEST_NAME", "", crypto.randomUUID());
    assert.equal(
      (await sql`select to_id from gift_receipts order by created_at desc limit 1`)[0].to_id,
      "friend",
    );
  } finally {
    await db.close();
  }
});
