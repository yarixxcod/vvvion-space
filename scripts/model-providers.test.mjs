import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
function load(path, require) {
  const e = {};
  new Function(
    "exports",
    "require",
    ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
  )(e, require);
  return e;
}
const policy = load("src/lib/ai/model-access.ts", () => ({}));
function serverFn() {
  let validate = (x) => x;
  const api = {
    middleware: () => api,
    validator: (fn) => ((validate = fn), api),
    handler: (fn) => async (data) => fn({ data: validate(data), context: { userId: "admin" } }),
  };
  return api;
}
async function fixture(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(
    `create table catalog_models(name text primary key,display_name text,icon text default '',system_prompt text default '',base_url text,api_key text,created_at timestamptz default now());create table catalog_providers(model_name text references catalog_models(name) on update cascade on delete cascade,slot smallint check(slot>=0 and slot<4),base_url text,api_key text default '',model_id text default '',primary key(model_name,slot));insert into catalog_models(name,api_key) values('Existing','keep-key');insert into catalog_providers values('Existing',0,'https://keep.example','keep-key','old');`,
  );
  await db.exec(readFileSync("migrations/0064_model_premium_providers.sql", "utf8"));
  const sql = async (strings, ...values) =>
    (
      await db.query(
        strings.reduce((s, p, i) => s + (i ? "$" + i : "") + p, ""),
        values,
      )
    ).rows;
  sql.query = async (text, values) => (await db.query(text, values)).rows;
  const admin = load("src/lib/social/admin.ts", (id) =>
    id === "@tanstack/react-start"
      ? { createServerFn: serverFn }
      : id.includes("/db")
        ? { getSql: async () => sql }
        : id.includes("model-access")
          ? policy
          : id.includes("/access")
            ? { assertAdmin: async () => {} }
            : {},
  );
  return { db, sql, admin };
}
test("migration preserves old config, defaults all models to free and permits slot 9 but not 10", async (t) => {
  const { db } = await fixture(t);
  const row = (
    await db.query(
      "select m.premium_only,p.api_key,p.provider_id from catalog_models m join catalog_providers p on p.model_name=m.name",
    )
  ).rows[0];
  assert.equal(row.premium_only, false);
  assert.equal(row.api_key, "keep-key");
  assert.match(row.provider_id, /^[0-9a-f-]{36}$/);
  await db.exec(
    "insert into catalog_providers(model_name,slot,base_url) values('Existing',9,'https://nine.example')",
  );
  await assert.rejects(
    db.exec(
      "insert into catalog_providers(model_name,slot,base_url) values('Existing',10,'https://ten.example')",
    ),
  );
  await db.exec(readFileSync("migrations/0064_model_premium_providers.sql", "utf8"));
});
test("admin saves ten providers and Premium, preserving IDs across edits and reordering", async (t) => {
  const { admin, db } = await fixture(t);
  const input = {
    name: "DeepSeek",
    displayName: "DeepSeek",
    premiumOnly: true,
    providers: Array.from({ length: 10 }, (_, i) => ({
      baseUrl: `https://p${i}.example/v1`,
      apiKey: `key-${i}`,
      model: `ds-${i}`,
    })),
  };
  const rows = await admin.saveModel(input);
  const model = rows.find((m) => m.name === "DeepSeek");
  assert.equal(model.providers.length, 10);
  assert.equal(model.premiumOnly, true);
  assert.equal(new Set(model.providers.map((p) => p.id)).size, 10);
  const first = model.providers[0].id;
  const changed = await admin.saveModel({
    ...input,
    previousName: "DeepSeek",
    providers: [...model.providers].reverse(),
  });
  assert.equal(changed.find((m) => m.name === "DeepSeek").providers[9].id, first);
  assert.equal(
    (await db.query("select api_key from catalog_models where name='DeepSeek'")).rows[0].api_key,
    "key-9",
  );
  await assert.rejects(
    admin.saveModel({
      ...input,
      previousName: "DeepSeek",
      providers: [...input.providers, input.providers[0]],
    }),
    /десяти/,
  );
});
test("Premium policy rejects both guests and expired subscriptions", () => {
  assert.equal(policy.premiumModelAllowed(true, false), false);
  assert.equal(policy.premiumModelAllowed(true, true), true);
  assert.equal(policy.premiumModelAllowed(false, false), true);
});
test("real outgoing attempts, retries and failures are counted without credentials or prompts", async (t) => {
  const { sql, db } = await fixture(t);
  const usage = load("src/lib/ai/provider-usage.server.ts", () => ({ getSql: async () => sql }));
  const headers = new Headers({ authorization: "Bearer DO-NOT-STORE" });
  usage.tagProvider(headers, {
    model: "Existing",
    id: "stable",
    slot: 9,
    host: "api.example",
    upstream: "ds",
    source: "api",
  });
  await usage.measuredProviderFetch(headers, async () => new Response("ok"));
  await usage.measuredProviderFetch(headers, async () => new Response("bad", { status: 503 }));
  await assert.rejects(
    usage.measuredProviderFetch(headers, async () => {
      throw Error("network");
    }),
  );
  const row = (await db.query("select * from provider_usage_hourly")).rows[0];
  assert.equal(Number(row.requests), 3);
  assert.equal(Number(row.accepted), 1);
  assert.equal(Number(row.errors), 2);
  assert.equal(JSON.stringify(row).includes("DO-NOT-STORE"), false);
});
test("the tenth provider is reached, in priority order, and each attempt is attributed", async (t) => {
  const { sql, db } = await fixture(t);
  const usage = load("src/lib/ai/provider-usage.server.ts", () => ({ getSql: async () => sql }));
  const { createProviderRouter } = load("src/lib/ai/provider-router.ts", () => ({}));
  const calls = [];
  const targets = Array.from({ length: 10 }, (_, slot) => {
    const headers = new Headers();
    usage.tagProvider(headers, {
      model: "DeepSeek",
      id: `provider-${slot}`,
      slot,
      host: `p${slot}.example`,
      upstream: `ds-${slot}`,
      source: "chat",
    });
    return {
      url: `https://p${slot}.example/v1/chat/completions`,
      headers,
      model: `ds-${slot}`,
      secret: "unused",
    };
  });
  const router = createProviderRouter(
    targets,
    async (url, headers, payload) => {
      calls.push(payload.model);
      const response = await usage.measuredProviderFetch(headers, async () =>
        payload.model === "ds-9"
          ? Response.json({ choices: [{ message: { content: "Tenth provider" } }] })
          : new Response("bad key", { status: 401 }),
      );
      return { failed: !response.ok, response };
    },
    new AbortController().signal,
  );
  const result = await router.send({
    model: "DeepSeek",
    messages: [{ role: "user", content: "Hi" }],
    stream: false,
  });
  assert.equal(result.failed, false);
  assert.equal(calls.length, 10);
  assert.deepEqual(
    calls,
    Array.from({ length: 10 }, (_, i) => `ds-${i}`),
  );
  const rows = (
    await db.query(
      "select sum(requests) as n,sum(errors) as errors,sum(accepted) as accepted from provider_usage_hourly",
    )
  ).rows[0];
  assert.equal(Number(rows.n), 10);
  assert.equal(Number(rows.errors), 9);
  assert.equal(Number(rows.accepted), 1);
});
test("server entitlement rejects direct calls without an active subscription", async (t) => {
  const { sql, db } = await fixture(t);
  await db.exec("update catalog_models set premium_only=true where name='Existing'");
  let actor = null;
  const paid = new Set(["subscriber"]);
  const wrapped = async (strings, ...values) =>
    strings.join("").includes("ensure_member")
      ? [{ out_role: "member", is_banned: values[0] === "banned" }]
      : sql(strings, ...values);
  const access = load("src/lib/social/access.ts", (id) =>
    id === "@tanstack/react-start"
      ? { createServerOnlyFn: (fn) => fn }
      : id === "@/lib/db"
        ? { getSql: async () => wrapped }
        : id.includes("verify.server")
          ? { getSessionUser: async () => actor }
          : id.includes("/premium")
            ? { isPremium: async (id) => paid.has(id) }
            : id.includes("model-access")
              ? policy
              : {},
  );
  await assert.rejects(access.assertBuiltinChat("Existing"), /Premium/);
  actor = { id: "member" };
  await assert.rejects(access.assertBuiltinChat("Existing"), /Premium/);
  actor = { id: "subscriber" };
  await access.assertBuiltinChat("Existing");
  paid.clear();
  await assert.rejects(access.assertBuiltinChat("Existing"), /Premium/);
  actor = { id: "banned" };
  await assert.rejects(access.assertBuiltinChat("Existing"), /заблокирован/);
  await db.exec("update catalog_models set premium_only=false where name='Existing'");
  actor = null;
  await access.assertBuiltinChat("Existing");
});
