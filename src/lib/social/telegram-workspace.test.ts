import { test, after } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { commandOf, splitTelegramText, privateActor, safeBotError } from "./telegram-core.ts";
import { sealBotToken, openBotToken } from "./telegram-secret.server.ts";
const pg = new PGlite();
const sql: any = Object.assign(
  async (parts: TemplateStringsArray, ...values: unknown[]) =>
    pg
      .query(
        parts.reduce((s, p, i) => s + (i ? "$" + i : "") + p, ""),
        values,
      )
      .then((r) => r.rows),
  { query: async (s: string, v?: unknown[]) => pg.query(s, v).then((r) => r.rows) },
);
const root = process.cwd();
const state = globalThis as any;
state.__tgSql = sql;
state.__tgTx = async (fn: any) =>
  pg.transaction(async (tx) =>
    fn(
      Object.assign(
        async (parts: TemplateStringsArray, ...values: unknown[]) =>
          tx
            .query(
              parts.reduce((s, p, i) => s + (i ? "$" + i : "") + p, ""),
              values,
            )
            .then((r) => r.rows),
        { query: async (s: string, v?: unknown[]) => tx.query(s, v).then((r) => r.rows) },
      ),
    ),
  );
state.__tgCalls = 0;
registerHooks({
  resolve(specifier, context, next) {
    const mocks: Record<string, string> = {
      "@/lib/db":
        "export const getSql=async()=>globalThis.__tgSql;export const withTransaction=fn=>globalThis.__tgTx(fn);",
      "@/lib/social/mega": 'export const storeMegaBytes=async()=>({name:"test"});',
      "@/lib/social/mega-plan": "export const entryName=v=>v;",
      "@/lib/social/access":
        'export const loadAccess=async id=>{const [r]=await globalThis.__tgSql.query("select role,banned_at from members where user_id=$1",[id]);return {role:r?.role||"member",banned:!!r?.banned_at};};',
      "@/lib/ai/proxy.server":
        'export const completeTelegramChat=async(id,model,history)=>{globalThis.__tgCalls++;if(globalThis.__tgFail)throw new Error("Провайдер недоступен");return "Ответ "+history.at(-1).content;};',
      "@vercel/functions": 'export const waitUntil=()=>{throw new Error("local test");};',
    };
    if (mocks[specifier])
      return {
        url: "data:text/javascript," + encodeURIComponent(mocks[specifier]),
        shortCircuit: true,
      };
    if (specifier.startsWith("@/"))
      return next(pathToFileURL(root + "/src/" + specifier.slice(2) + ".ts").href, context);
    return next(specifier, context);
  },
});
await pg.exec(`create table "user"(id text primary key,name text);insert into "user" values('alice','Alice'),('bob','Bob');
create table members(user_id text primary key,role text default 'member',banned_at timestamptz);insert into members(user_id) values('alice'),('bob');
create table saved_chats(id text primary key,user_id text,title text,messages jsonb,unread boolean default false,created_at timestamptz,updated_at timestamptz);
create table catalog_models(name text primary key,display_name text);insert into catalog_models values('model-a','Model A');
create table wallets(user_id text,balance int);insert into wallets values('alice',1000);
create table wallet_transfers(id text,from_id text,to_id text,amount int,note text,created_at timestamptz default now());
create table user_handles(user_id text,handle text);insert into user_handles values('alice','nova_fox');`);
await pg.exec(readFileSync("migrations/0026_telegram.sql", "utf8"));
await pg.exec(readFileSync("migrations/0054_telegram_workspace.sql", "utf8"));
process.env.TELEGRAM_TOKEN_KEY = "isolated-test-encryption-key";
const token = "123456789:abcdefghijklmnopqrstuvwxyz123456";
await sql.query("insert into telegram_bot(id,token,username,secret) values(1,$1,$2,$3)", [
  sealBotToken(token),
  "test_bot",
  "test-secret",
]);
await sql.query("insert into telegram_links(user_id,chat_id,username) values($1,$2,$3)", [
  "alice",
  "123",
  "alice",
]);
const sent: any[] = [];
let webhook = "https://vvvion.space/api/telegram";
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input: any, init: any) => {
  const url = String(input);
  assert.ok(url.startsWith("https://api.telegram.org/bot" + token + "/"));
  const method = url.split("/").at(-1);
  const body = JSON.parse(init.body);
  sent.push({ method, body });
  return Response.json({
    ok: true,
    result:
      method === "getMe"
        ? { username: "test_bot", is_bot: true }
        : method === "getWebhookInfo"
          ? { url: webhook, pending_update_count: 0 }
          : true,
  });
};
const { handleTelegram, diagnoseBot, repairBot } = await import("./telegram.server.ts");
const { workspaceAction } = await import("./telegram-workspace.server.ts");
const request = (update: unknown, secret = "test-secret") =>
  new Request("https://vvvion.space/api/telegram", {
    method: "POST",
    headers: { "x-telegram-bot-api-secret-token": secret },
    body: JSON.stringify(update),
  });
const message = (id: number, text: string, extra = {}) => ({
  update_id: id,
  message: {
    chat: { id: 123, type: "private" },
    from: { id: 123, username: "alice" },
    text,
    ...extra,
  },
});
after(async () => {
  globalThis.fetch = originalFetch;
  await pg.close();
});
test("protocol helpers, unicode and secret encryption", () => {
  assert.deepEqual(commandOf("/models@Test_Bot"), { name: "models", arg: "" });
  assert.equal(commandOf("hello"), null);
  assert.equal(privateActor({ id: 123, type: "group" }, { id: 123 }), false);
  assert.equal(privateActor({ id: 123, type: "private" }, { id: 456 }), false);
  const source = "😀".repeat(4000);
  const parts = splitTelegramText(source);
  assert.equal(parts.join(""), source);
  assert.ok(parts.every((p) => p.length <= 3500));
  const sealed = sealBotToken(token);
  assert.ok(!sealed.includes(token));
  assert.equal(openBotToken(sealed), token);
  assert.equal(openBotToken(token), token);
  assert.throws(() => openBotToken(sealed.slice(0, -2) + "AA"));
  assert.ok(!safeBotError(new Error("failure " + token)).includes(token));
});
test("forged webhook and actor are rejected before any effect", async () => {
  const n = sent.length;
  assert.equal((await handleTelegram(request(message(1, "/menu"), "wrong"))).status, 404);
  await handleTelegram(request(message(2, "/menu", { from: { id: 999 } })));
  assert.equal(sent.length, n);
});
test("a repeated update does not duplicate an action", async () => {
  await handleTelegram(request(message(3, "/menu")));
  const n = sent.length;
  await handleTelegram(request(message(3, "/menu")));
  assert.equal(sent.length, n);
});
test("models and AI conversation use the same saved_chats owner", async () => {
  const [{ key }] = await sql.query("select md5(name) as key from catalog_models");
  await workspaceAction(token, "123", "alice", "model:" + key);
  assert.match(sent.at(-1).body.text, /^Выбрана Model A\./);
  assert.ok(!sent.at(-1).body.text.includes("model-a"));
  const [picked] = await sql.query("select model from telegram_sessions where user_id='alice'");
  assert.equal(picked.model, "model-a");
  await handleTelegram(request(message(4, "Привет")));
  assert.equal(state.__tgCalls, 1);
  const rows = await sql.query("select user_id,messages from saved_chats");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, "alice");
  assert.equal((rows[0].messages as any[]).length, 2);
  await handleTelegram(request(message(4, "Привет")));
  assert.equal(state.__tgCalls, 1);
  assert.ok(sent.some((r) => r.method === "sendMessage" && r.body.text === "Ответ Привет"));
});
test("foreign chat continuation and admin command are isolated", async () => {
  await sql.query(
    "insert into saved_chats values('foreign-chat','bob','Private','[]',false,now(),now())",
  );
  await workspaceAction(token, "123", "alice", "chat:foreign-chat");
  const [s] = await sql.query("select chat_id from telegram_sessions where user_id='alice'");
  assert.notEqual(s.chat_id, "foreign-chat");
  await workspaceAction(token, "123", "alice", "admin");
  assert.match(sent.at(-1).body.text, /администраторам/);
});
test("blocked callbacks cannot accept requests or use AI", async () => {
  await sql.query("update members set banned_at=now() where user_id='alice'");
  const calls = state.__tgCalls;
  await handleTelegram(
    request({
      update_id: 5,
      callback_query: {
        id: "q",
        from: { id: 123 },
        message: { chat: { id: 123, type: "private" } },
        data: "go:ai",
      },
    }),
  );
  assert.equal(state.__tgCalls, calls);
  assert.equal(sent.at(-1).method, "answerCallbackQuery");
  await sql.query("update members set banned_at=null where user_id='alice'");
});

test("busy sessions cannot fork a conversation and provider errors release the lease", async () => {
  await sql.query(
    "update telegram_sessions set busy_until=now()+interval '1 minute' where user_id='alice'",
  );
  const before = await sql.query("select chat_id from telegram_sessions where user_id='alice'");
  await workspaceAction(token, "123", "alice", "new");
  const after = await sql.query("select chat_id from telegram_sessions where user_id='alice'");
  assert.equal(before[0].chat_id, after[0].chat_id);
  assert.match(sent.at(-1).body.text, /Дождитесь/);
  await sql.query(
    "update telegram_sessions set busy_until=now()-interval '1 second' where user_id='alice'",
  );
  state.__tgFail = true;
  await handleTelegram(request(message(41, "Сбой провайдера")));
  state.__tgFail = false;
  const [lease] = await sql.query(
    "select busy_until<=now() as released from telegram_sessions where user_id='alice'",
  );
  assert.equal(lease.released, true);
  assert.match(sent.at(-1).body.text, /недоступен/);
});
test("bank and file reads stay scoped and never mint or spend money", async () => {
  await pg.exec(`create table disk_files(user_id text,name text,bytes int,created_at timestamptz default now());
 create table mega_entries(user_id text,parent_id text,name text,kind text,status text,created_at timestamptz default now());
 insert into disk_files values('alice','mine.txt',1024,now()),('bob','private-bob.txt',10,now());
 insert into mega_entries values('alice',null,'My folder','folder','ok',now()),('bob',null,'Bob secret','folder','ok',now());`);
  await workspaceAction(token, "123", "alice", "files");
  assert.match(sent.at(-1).body.text, /mine.txt/);
  assert.ok(!sent.at(-1).body.text.includes("Bob"));
  await workspaceAction(token, "123", "alice", "bank");
  const [wallet] = await sql.query("select balance from wallets where user_id='alice'");
  assert.equal(wallet.balance, 1000);
  assert.equal((await sql.query("select * from wallet_transfers")).length, 0);
});
test("one-time account code is consumed once and cannot relink another person", async () => {
  await sql.query(
    "insert into telegram_codes values('abcdefghjk','bob',now()+interval '15 minutes')",
  );
  await handleTelegram(request(message(6, "/start abcdefghjk")));
  await handleTelegram(
    request(
      message(7, "/start abcdefghjk", { chat: { id: 456, type: "private" }, from: { id: 456 } }),
    ),
  );
  const links = await sql.query("select chat_id from telegram_links where user_id='bob'");
  assert.equal(links[0].chat_id, "123");
  assert.equal((await sql.query("select * from telegram_codes")).length, 0);
});
test("diagnostics never expose token and repair installs the menu", async () => {
  const d = await diagnoseBot();
  assert.equal(d.webhookReady, true);
  assert.ok(!JSON.stringify(d).includes(token));
  await repairBot();
  assert.ok(
    sent.some(
      (r) =>
        r.method === "setMyCommands" && r.body.commands.some((c: any) => c.command === "models"),
    ),
  );
  webhook = "";
  assert.equal((await diagnoseBot()).webhookReady, false);
});
