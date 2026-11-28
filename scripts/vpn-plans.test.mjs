import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
import * as crypto from "node:crypto";
function load(path, deps = {}) {
  const js = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("require", "exports", js)((id) => {
    if (id in deps) return deps[id];
    throw new Error(`Missing ${id}`);
  }, exports);
  return exports;
}
const core = load("src/lib/social/vpn-core.ts");
const builder = () => ({
  middleware() {
    return this;
  },
  validator(fn) {
    this.validate = fn;
    return this;
  },
  handler(fn) {
    const validate = this.validate || ((x) => x);
    return ({ data, userId = "alice" } = {}) => fn({ data: validate(data), context: { userId } });
  },
});
export async function vpnFixture() {
  const db = new PGlite();
  await db.exec(
    `create table "user"(id text primary key,name text,email text,"emailVerified" boolean);create table wallets(user_id text primary key,balance int,last_grant_at timestamptz);create table wallet_transfers(id text primary key,from_id text,to_id text,amount int,note text,created_at timestamptz default now());create table shop_prices(sku text primary key,price int,enabled boolean);insert into "user" values('alice','Alice','a@test',true),('bob','Bob','b@test',true),('unverified','U','u@test',false);insert into wallets values('alice',20000,now()),('bob',10,now());`,
  );
  for (const name of [
    "0030_vpn.sql",
    "0052_vpn_plane.sql",
    "0053_vpn_usage.sql",
    "0058_vpn_subscription_pull.sql",
    "0059_vpn_trials_status.sql",
  ]) {
    await db.exec(readFileSync(`migrations/${name}`, "utf8"));
  }
  let queries = 0;
  const makeSql = (session) => {
    const sql = async (strings, ...values) => {
      queries++;
      return (
        await session.query(
          strings.reduce((s, p, i) => s + p + (i < values.length ? `$${i + 1}` : ""), ""),
          values,
        )
      ).rows;
    };
    sql.query = async (q, args) => {
      queries++;
      if (q.includes("pg_advisory_xact_lock")) return [];
      return (await session.query(q, args)).rows;
    };
    return sql;
  };
  const sql = makeSql(db);
  const deps = {
    "@tanstack/react-start": { createServerFn: builder,createServerOnlyFn:(fn)=>fn },
    "@/lib/auth/middleware": { authMiddleware: {} },
    "@/lib/db": {
      getSql: async () => sql,
      withTransaction: (fn) => db.transaction((tx) => fn(makeSql(tx))),
    },
    "@/lib/social/access": { assertActive: async () => {}, assertAdmin: async () => {} },
    "@/lib/social/sql-error": { isUniqueViolation: (e) => e.code === "23505" },
    "@/lib/social/prices": {
      priceOf: async (sku, fallback) =>
        Number(
          (await sql`select price from shop_prices where sku=${sku} and enabled=true`)[0]?.price ??
            fallback,
        ),
    },
    "@/lib/social/vpn-core": core,
    "@/lib/social/push.server": {
      pushNotice: async () => {},
      pushVpnRenewal: async () => {},
      pushVpnNodeDown: async () => {},
    },
    "./connect-token.server":load("src/lib/social/connect-token.server.ts",{"node:crypto":crypto}),
    "node:crypto": crypto,
  };
  const vpn = load("src/lib/social/vpn.ts", deps);
  await sql`update vpn_plans set enabled=true where id in ('plus','family')`;
  return {
    db,
    sql,
    vpn,
    deps,
    queries: () => queries,
    resetQueries: () => {
      queries = 0;
    },
  };
}
test("VPN plan purchase is atomic, idempotent, scoped and enforces the switch window", async () => {
  const { db, sql, vpn } = await vpnFixture();
  try {
    const initial = await vpn.purchaseVpn("alice", "purchase-first", "plus");
    assert.equal(initial.plan, "plus");
    assert.equal(initial.trafficBytes, 300 * 1024 ** 3);
    assert.equal(initial.deviceCap, 5);
    const before = (await sql`select balance from wallets where user_id='alice'`)[0].balance;
    await vpn.purchaseVpn("alice", "purchase-first", "plus");
    assert.equal((await sql`select balance from wallets where user_id='alice'`)[0].balance, before);
    assert.equal(
      (await sql`select count(*)::int n from wallet_transfers where note='VPN'`)[0].n,
      1,
    );
    await assert.rejects(vpn.purchaseVpn("alice", "blocked-switch", "family"), /последние 3 дня/);
    await assert.rejects(vpn.purchaseVpn("bob", "short-balance", "plus"), /Нужно/);
    assert.equal((await sql`select * from vpn_passes where user_id='bob'`).length, 0);
    await sql`update vpn_passes set until_at=now()+interval '3 days' where user_id='alice'`;
    assert.equal((await vpn.purchaseVpn("alice", "allowed-switch", "family")).plan, "family");
    await sql`update vpn_passes set until_at=now()-interval '1 day' where user_id='alice'`;
    assert.equal((await vpn.purchaseVpn("alice", "expired-switch", "base")).plan, "base");
    await assert.rejects(vpn.purchaseVpn("alice", "trial-buy", "trial"), /недоступен/);
    await sql`insert into shop_prices values('vpn',1800,true)`;
    const price = (await vpn.getVpnShowcase()).price;
    assert.equal(price, 1800);
  } finally {
    await db.close();
  }
});
test("VPN plan quotas preserve legacy base and reach subscription headers for plus/family", async () => {
  const { db, sql, vpn } = await vpnFixture();
  try {
    await sql`update vpn_plan set traffic_bytes=123456 where id=1`;
    assert.equal(await vpn.planQuota("base"), 123456);
    assert.equal(await vpn.planQuota("unknown"), 123456);
    process.env.VPN_AGENT_TOKEN = "unit-agent-token";
    await sql`insert into vpn_nodes(id,name,uri,enabled,ping_ms) values('node-fast','Fast','vless://11111111-1111-4111-8111-111111111111@host.test:443',true,20),('node-slow','Slow','vless://22222222-2222-4222-8222-222222222222@host.test:443',true,null)`;
    for (const [plan, total] of [
      ["plus", 300 * 1024 ** 3],
      ["family", 500 * 1024 ** 3],
    ]) {
      await sql`delete from vpn_passes where user_id='alice'`;
      const row = await vpn.purchaseVpn("alice", `quota-${plan}`, plan);
      const res = await vpn.renderVpnSubscription(
        row.token,
        new Request(`https://test/api/vpn/${row.token}`),
      );
      assert.equal(res.status, 200);
      assert.match(res.headers.get("subscription-userinfo"), new RegExp(`total=${total}`));
      assert.ok(
        (await sql`select last_pull_at from vpn_passes where user_id='alice'`)[0].last_pull_at,
      );
    }
  } finally {
    await db.close();
  }
});

test("Trial requires verification, no historical pass and only one concurrent claim", async () => {
  const { db, sql, vpn } = await vpnFixture();
  try {
    await sql`update vpn_plans set enabled=true,days=2,traffic_bytes=2147483648 where id='trial'`;
    await assert.rejects(vpn.claimTrialFor("unverified", "ip"), /почту/);
    const result = await Promise.allSettled([
      vpn.claimTrialFor("alice", "ip"),
      vpn.claimTrialFor("alice", "ip"),
    ]);
    assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal((await sql`select count(*)::int n from vpn_trials`)[0].n, 1);
    assert.equal((await vpn.getVpnShowcase()).trafficBytes, 2147483648);
    await assert.rejects(vpn.setVpnAutoRenew({ data: true }), /Пробный/);
    await sql`delete from vpn_passes where user_id='alice'`;
    await assert.rejects(vpn.claimTrialFor("alice", "ip"), /использован/);
    await sql`insert into vpn_passes(user_id,token,until_at) values('bob','old-pass-token-000000000000',now()-interval '100 days')`;
    await assert.rejects(vpn.claimTrialFor("bob", "ip"), /использован/);
    for (let i = 0; i < 3; i++) {
      await sql`insert into "user" values(${`trial${i}`},'T',${`t${i}@test`},true)`;
      await vpn.claimTrialFor(`trial${i}`, "shared-ip");
    }
    await sql`insert into "user" values('trial4','T','t4@test',true)`;
    await assert.rejects(vpn.claimTrialFor("trial4", "shared-ip"), /лимит/);
  } finally {
    await db.close();
  }
});
test("Auto renewal keeps current plan and falls back from a disabled plan", async () => {
  const { db, sql, vpn } = await vpnFixture();
  try {
    await vpn.purchaseVpn("alice", "auto-initial", "plus");
    await sql`update vpn_passes set until_at=now()+interval '12 hours',auto_renew=true where user_id='alice'`;
    assert.equal(await vpn.renewDueVpn(), 1);
    assert.equal(
      (await sql`select plan_id from vpn_passes where user_id='alice'`)[0].plan_id,
      "plus",
    );
    await sql`update vpn_passes set until_at=now()+interval '12 hours' where user_id='alice'`;
    await sql`delete from wallet_transfers where id like 'vpn-auto-%'`;
    await sql`update vpn_plans set enabled=false where id='plus'`;
    assert.equal(await vpn.renewDueVpn(), 1);
    assert.equal(
      (await sql`select plan_id from vpn_passes where user_id='alice'`)[0].plan_id,
      "base",
    );
    assert.equal(
      (await sql`select count(*)::int n from vpn_audit where kind='renew-base-fallback'`)[0].n,
      1,
    );
  } finally {
    await db.close();
  }
});

test("Batched agent pull keeps secrets and reports count only deltas", async () => {
  const f = await vpnFixture(),
    { db, sql, vpn } = f;
  try {
    process.env.VPN_AGENT_TOKEN = "unit-agent-token";
    for (let i = 0; i < 50; i++) {
      await sql`insert into "user" values(${`load${i}`},'L',${`l${i}@test`},true)`;
      await sql`insert into vpn_passes(user_id,token,until_at) values(${`load${i}`},${`load-token-000000000000000-${i}`},now()+interval '10 days')`;
    }
    for (let n = 0; n < 3; n++)
      await sql`insert into vpn_nodes(id,name,uri,enabled) values(${`load-node-${n}`},'Load','vless://11111111-1111-4111-8111-111111111111@host.test:443',true)`;
    const call = (nodeId, op, users) =>
      vpn.handleVpnAgent(
        new Request("https://test/api/vpn-agent", {
          method: "POST",
          headers: { authorization: "Bearer unit-agent-token", "content-type": "application/json" },
          body: JSON.stringify({ nodeId, op, users, reach: "up" }),
        }),
      );
    let cold = 0,
      warm = 0;
    for (let n = 0; n < 3; n++) {
      f.resetQueries();
      const first = await (await call(`load-node-${n}`, "pull")).json();
      cold += f.queries();
      assert.equal(first.users.length, 50);
      f.resetQueries();
      const second = await (await call(`load-node-${n}`, "pull")).json();
      warm += f.queries();
      assert.deepEqual(first, second);
    }
    console.log(`VPN 50 users × 3 nodes: cold=${cold}, warm=${warm} SQL queries`);
    const users = Array.from({ length: 50 }, (_, i) => ({
      userId: `load${i}`,
      upload: 1000,
      download: 2000,
    }));
    await call("load-node-0", "report", users); // first snapshot establishes counters
    for (const u of users) {
      u.upload += 100;
      u.download += 200;
    }
    f.resetQueries();
    await call("load-node-0", "report", users);
    const reports = f.queries();
    await call("load-node-0", "report", users); // duplicate must add zero
    assert.equal(
      Number((await sql`select sum(upload_bytes+download_bytes) n from vpn_usage_days`)[0].n),
      15000,
    );
    assert.equal((await sql`select count(*)::int n from vpn_node_events`)[0].n, 1);
    assert.equal(reports, 7);
    console.log(`VPN 50-user report: ${reports} SQL queries`);
    // Reset counters are handled by the existing nextBaseline/counterDelta helpers.
    await call("load-node-0", "report", [{ userId: "load0", upload: 10, download: 20 }]);
    assert.equal(
      Number((await sql`select sum(upload_bytes+download_bytes) n from vpn_usage_days`)[0].n),
      15000,
    );
    assert.equal((await sql`select count(*)::int n from vpn_keys`)[0].n, 150);
    await sql`update vpn_keys set revoked_at=now() where node_id='load-node-0'`;
    const pair = await Promise.all([
      call("load-node-0", "pull").then((r) => r.json()),
      call("load-node-0", "pull").then((r) => r.json()),
    ]);
    assert.deepEqual(pair[0], pair[1]);
    assert.equal((await sql`select count(*)::int n from vpn_keys`)[0].n, 150);
  } finally {
    await db.close();
  }
});

test("Lower device cap preserves devices and blocks new ones; concurrent adds respect cap", async () => {
  const { db, sql, vpn } = await vpnFixture();
  try {
    await vpn.purchaseVpn("alice", "device-initial", "family");
    for (let i = 0; i < 4; i++) await vpn.addVpnDevice({ data: { name: `Device ${i}` } });
    await sql`update vpn_passes set until_at=now()+interval '1 day' where user_id='alice'`;
    await vpn.purchaseVpn("alice", "device-downgrade", "base");
    await assert.rejects(vpn.addVpnDevice({ data: { name: "Extra" } }), /устройств/);
    assert.equal(
      (await sql`select count(*)::int n from vpn_devices where revoked_at is null`)[0].n,
      4,
    );
    await sql`update vpn_devices set revoked_at=now() where user_id='alice'`;
    await sql`update vpn_plans set device_cap=1 where id='base'`;
    const added = await Promise.allSettled([
      vpn.addVpnDevice({ data: { name: "One" } }),
      vpn.addVpnDevice({ data: { name: "Two" } }),
    ]);
    assert.equal(added.filter((r) => r.status === "fulfilled").length, 1);
  } finally {
    await db.close();
  }
});

test('Connect node tokens are scoped; provisioning never re-enables a server disabled later',async()=>{
 const f=await vpnFixture();try{
 process.env.VPN_AGENT_TOKEN='connect-test-master';
 const tokens=load('src/lib/social/connect-token.server.ts',{'node:crypto':crypto});
 for(const id of ['connect-node-a','connect-node-b'])await f.sql`insert into vpn_nodes(id,name,uri,host,protocol,enabled,maintenance,shared_cut) values(${id},'Connect',${'connect-pending://'+id},'connect.example.com','vless',false,true,true)`;
 const call=(nodeId,op,extra={},token=tokens.connectNodeToken('connect-node-a'))=>f.vpn.handleVpnAgent(new Request('https://test/api/vpn-agent',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({nodeId,op,...extra})}));
 assert.equal((await call('connect-node-b','pull')).status,401);
 await call('connect-node-a','report',{users:[{userId:'bob',upload:1000,download:2000}],reach:'up'});
 assert.equal((await f.sql`select count(*)::int n from vpn_counters where node_id='connect-node-a'`)[0].n,0);
 const uri='vless://{secret}@connect.example.com:443?security=reality&pbk=test';
 assert.equal((await call('connect-node-a','provisioned',{uri})).status,409);
 assert.equal((await call('connect-node-a','applied',{ok:true,clients:0})).status,200);
 assert.equal((await call('connect-node-a','provisioned',{uri:uri.replace('connect.example.com','evil.example.com')})).status,400);
 assert.equal((await call('connect-node-a','provisioned',{uri})).status,200);
 let row=(await f.sql`select enabled,maintenance,shared_cut from vpn_nodes where id='connect-node-a'`)[0];assert.equal(row.enabled,true);assert.equal(row.maintenance,false);assert.equal(row.shared_cut,true);
 await f.sql`update vpn_nodes set enabled=false,maintenance=true where id='connect-node-a'`;
 await call('connect-node-a','provisioned',{uri});row=(await f.sql`select enabled,maintenance from vpn_nodes where id='connect-node-a'`)[0];assert.equal(row.enabled,false);assert.equal(row.maintenance,true);
 }finally{await f.db.close();}
});
