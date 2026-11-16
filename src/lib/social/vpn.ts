import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { assertActive, assertAdmin } from "@/lib/social/access";
import { isUniqueViolation } from "@/lib/social/sql-error";
import { priceOf } from "@/lib/social/prices";
import { accessOf, afterAgent, clientsToInstall, counterDelta, keyEmail, newHySecret, nextBaseline, openSlots, personalUri, pullLimit, purchaseOutcome, sharedCredential, subscriptionInfo, syncState, usedBytes, type VpnUsage } from "@/lib/social/vpn-core";

export const VPN_PRICE = 2000;
export const VPN_DAYS = 30;
const TOKEN = /^[A-Za-z0-9_-]{20,80}$/;
const GIB = 1024 * 1024 * 1024;

export type VpnNode = {
  id: string;
  name: string;
  uri: string;
  enabled: boolean;
  country: string;
  city: string;
  protocol: string;
  host: string;
  reach: string;
  maintenance: boolean;
  agentEnrolled: boolean;
  lastCheck: string | null;
  lastError: string;
  loadNote: string;
  pingMs: number | null;
  clientCount: number | null;
  sharedCut: boolean;
};

export type VpnPlace = {
  name: string;
  country: string;
  city: string;
  reach: string;
  maintenance: boolean;
  personal: boolean;
  cut: boolean;
};

export type VpnDevice = {
  id: string;
  name: string;
  token: string | null;
  revoked: boolean;
  createdAt: string;
  lastPull: string | null;
};

export type VpnShowcase = {
  locations: string[];
  places: VpnPlace[];
  price: number;
  days: number;
  trafficBytes: number;
  usedBytes: number | null;
  uploadBytes: number | null;
  downloadBytes: number | null;
  verified: boolean;
  active: boolean;
  blocked: boolean;
  until: string | null;
  daysLeft: number;
  token: string | null;
  sharedNodes: number;
  enrolledNodes: number;
  autoRenew: boolean;
  devices: VpnDevice[];
  deviceCap: number;
  plan: string;
  quotaReset: string | null;
  usageDays: { day: string; upload: number; download: number }[];
  history: { id: string; amount: number; at: string }[];
};

export type VpnDesk = {
  nodes: VpnNode[];
  price: number;
  days: number;
  trafficBytes: number;
  activeLinks: number;
  totalLinks: number;
  pullsDay: number;
  plans: VpnPlanRow[];
};

export type VpnPlanRow = {
  id: string;
  title: string;
  days: number;
  price: number;
  trafficBytes: number;
  deviceCap: number;
  enabled: boolean;
};

function nodeName(value: unknown): string {
  if (typeof value !== "string") throw new Error("Нужно название");
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > 32) throw new Error("Название — до 32 знаков");
  if (/[#\r\n]/.test(name)) throw new Error("В названии не нужна решётка");
  return name;
}

function nodeUri(value: unknown): string {
  if (typeof value !== "string") throw new Error("Нужна ссылка vless:// или hy2://");
  const uri = value.trim();
  if (!/^(vless|hy2|hysteria2):\/\/\S+$/i.test(uri) || uri.length > 4000) {
    throw new Error("Нужна одна ссылка vless:// или hy2://");
  }
  return uri;
}

function gbOf(value: unknown): number {
  const n = typeof value === "number" ? value : Number(typeof value === "string" ? value : NaN);
  if (!Number.isInteger(n) || n < 1 || n > 10000) throw new Error("Трафик — целое число гигабайт, от 1 до 10000");
  return n;
}

function emailOf(value: unknown): string {
  if (typeof value !== "string") throw new Error("Нужна почта");
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) throw new Error("Почта не похожа на адрес");
  return email;
}

function newToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function trafficBytes(): Promise<number> {
  const sql = await getSql();
  const rows = await sql<{ traffic_bytes: string | number }>`
    select traffic_bytes from vpn_plan where id = 1
  `;
  const n = Number(rows[0]?.traffic_bytes ?? 100 * GIB);
  return Number.isFinite(n) && n > 0 ? n : 100 * GIB;
}

async function verified(userId: string): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql<{ ok: boolean | null }>`
    select "emailVerified" as ok from "user" where id = ${userId}
  `;
  return Boolean(rows[0]?.ok);
}

async function ipHash(request: Request): Promise<string> {
  const { createHash } = await import("node:crypto");
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "0";
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

async function agentTokenOk(header: string | null): Promise<boolean> {
  const { timingSafeEqual } = await import("node:crypto");
  const expected = process.env.VPN_AGENT_TOKEN?.trim() || "";
  if (!expected || !header) return false;
  const got = header.replace(/^Bearer\s+/i, "").trim();
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

function protocolOf(uri: string, stored: string): "vless" | "hy2" {
  if (stored === "vless" || stored === "hy2") return stored;
  return /^hy2:|^hysteria2:/i.test(uri) ? "hy2" : "vless";
}

function freshSecret(protocol: "vless" | "hy2"): string {
  if (protocol === "vless") return crypto.randomUUID();
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return newHySecret(bytes);
}

async function audit(actorId: string | null, userId: string | null, kind: string, note: string) {
  const sql = await getSql();
  await sql`
    insert into vpn_audit (id, actor_id, user_id, kind, note)
    values (${crypto.randomUUID()}, ${actorId}, ${userId}, ${kind.slice(0, 40)}, ${note.slice(0, 160)})
  `;
}

export async function renderVpnSubscription(token: string, request?: Request): Promise<Response> {
  const headers = {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
    "profile-update-interval": "1",
    "profile-title": "VVVION",
    "profile-web-page-url": "https://vvvion.space",
    "support-url": "https://vvvion.space",
  };
  const method = request?.method === "HEAD" ? "HEAD" : "GET";
  const empty = (status: number) => new Response(method === "HEAD" ? null : "not found", { status, headers });
  if (!TOKEN.test(token)) return empty(404);
  const sql = await getSql();
  if (request) {
    const hash = await ipHash(request);
    const misses = await sql<{ n: number }>`
      select count(*)::int as n from vpn_miss where ip_hash = ${hash} and at > now() - interval '1 minute'
    `;
    if (pullLimit(Number(misses[0]?.n ?? 0)) === "limited") return empty(429);
  }
  const passes = await sql<{ user_id: string; until_ms: string | number; blocked_at: string | null; kind: string; device_id: string }>`
    select user_id, floor(extract(epoch from until_at))::bigint as until_ms, blocked_at::text as blocked_at, 'pass' as kind, '' as device_id
    from vpn_passes where token = ${token}
    union all
    select d.user_id, floor(extract(epoch from p.until_at))::bigint, p.blocked_at::text, 'device', d.id
    from vpn_devices d
    join vpn_passes p on p.user_id = d.user_id
    where d.token = ${token} and d.revoked_at is null
    limit 1
  `;
  const pass = passes[0];
  if (!pass) {
    if (request) {
      await sql`insert into vpn_miss (id, ip_hash) values (${crypto.randomUUID()}, ${await ipHash(request)})`;
    }
    return empty(404);
  }
  const pulls = await sql<{ n: number }>`
    select count(*)::int as n from vpn_pulls where user_id = ${pass.user_id} and at > now() - interval '1 minute'
  `;
  if (pullLimit(Number(pulls[0]?.n ?? 0)) === "limited") {
    return new Response(method === "HEAD" ? null : "slow down", { status: 429, headers });
  }
  const expire = Number(pass.until_ms);
  const usage = await readUsage(pass.user_id);
  const quota = await trafficBytes();
  const state = accessOf({
    found: true,
    untilMs: expire * 1000,
    now: Date.now(),
    blocked: Boolean(pass.blocked_at),
    used: usedBytes(usage),
    quota,
  });
  const nodes = state === "ok"
    ? await sql<{ id: string; name: string; uri: string; protocol: string; agent_enrolled: boolean }>`
        select id, name, uri, protocol, agent_enrolled
        from vpn_nodes
        where enabled = true and maintenance = false
        order by created_at asc
      `
    : [];
  const info = subscriptionInfo(usage, quota, state === "ok" && Number.isFinite(expire) ? expire : 0);
  const lines = [
    "#profile-title: VVVION",
    "#profile-update-interval: 1",
    `#subscription-userinfo: ${info}`,
  ];
  for (const node of nodes) {
    const protocol = protocolOf(node.uri, node.protocol);
    const slot = pass.kind === "device" ? pass.device_id : "";
    const secret = await ensureKey(pass.user_id, node.id, slot, protocol);
    const built = personalUri(node.uri, secret, node.name, Boolean(node.agent_enrolled));
    if (built) lines.push(built.uri);
  }
  if (state !== "ok") {
    await sql`
      insert into vpn_sync (id, node_id, user_id, action, status, detail)
      select substr(md5(random()::text || id), 1, 32), id, ${pass.user_id}, 'revoke', 'pending', ${state}
      from vpn_nodes
      where agent_enrolled = true
        and not exists (
          select 1 from vpn_sync s
          where s.node_id = vpn_nodes.id and s.user_id = ${pass.user_id} and s.created_at > now() - interval '6 hours'
        )
    `;
  }
  const body = Buffer.from(lines.join("\n"), "utf8").toString("base64");
  await sql`insert into vpn_pulls (id, user_id) values (${crypto.randomUUID()}, ${pass.user_id})`;
  if (pass.kind === "device" && pass.device_id) {
    await sql`update vpn_devices set last_pull_at = now() where id = ${pass.device_id} and user_id = ${pass.user_id}`;
  }
  await sql`delete from vpn_miss where at < now() - interval '1 day'`;
  await sql`delete from vpn_pulls where at < now() - interval '2 days'`;
  return new Response(method === "HEAD" ? null : body, {
    status: 200,
    headers: {
      ...headers,
      "content-disposition": 'attachment; filename="vvvion"',
      "subscription-userinfo": info,
    },
  });
}

async function readUsage(userId: string): Promise<VpnUsage> {
  const sql = await getSql();
  const rows = await sql<{ upload: string | number; download: string | number; n: number }>`
    select coalesce(sum(greatest(upload_bytes - baseline_upload, 0)), 0)::bigint as upload,
           coalesce(sum(greatest(download_bytes - baseline_download, 0)), 0)::bigint as download,
           count(*)::int as n
    from vpn_counters
    where user_id = ${userId}
  `;
  if (!rows[0] || Number(rows[0].n) === 0) return null;
  return { upload: Number(rows[0].upload), download: Number(rows[0].download) };
}

async function ensureKey(userId: string, nodeId: string, deviceId: string, protocol: "vless" | "hy2"): Promise<string> {
  const sql = await getSql();
  const slot = deviceId || "";
  const existing = await sql<{ secret: string }>`
    select secret from vpn_keys
    where user_id = ${userId} and node_id = ${nodeId} and device_id = ${slot} and revoked_at is null
    limit 1
  `;
  if (existing[0]?.secret) return existing[0].secret;
  const secret = freshSecret(protocol);
  await sql`
    insert into vpn_keys (id, user_id, node_id, device_id, protocol, secret)
    values (${crypto.randomUUID()}, ${userId}, ${nodeId}, ${slot}, ${protocol}, ${secret})
    on conflict (user_id, node_id, device_id) do update
      set secret = case when vpn_keys.revoked_at is null then vpn_keys.secret else excluded.secret end,
          protocol = excluded.protocol,
          revoked_at = null
  `;
  const again = await sql<{ secret: string }>`
    select secret from vpn_keys
    where user_id = ${userId} and node_id = ${nodeId} and device_id = ${slot} and revoked_at is null
    limit 1
  `;
  return again[0]?.secret || secret;
}

async function planCap(planId: string): Promise<number> {
  const sql = await getSql();
  const rows = await sql<{ device_cap: number }>`select device_cap from vpn_plans where id = ${planId} limit 1`;
  const cap = Number(rows[0]?.device_cap ?? 3);
  return Number.isFinite(cap) && cap > 0 ? cap : 3;
}

async function readShowcase(userId: string): Promise<VpnShowcase> {
  const sql = await getSql();
  const nodes = await sql<{ name: string; country: string; city: string; reach: string; maintenance: boolean; agent_enrolled: boolean; shared_cut: boolean }>`
    select name, country, city, reach, maintenance, agent_enrolled, shared_cut
    from vpn_nodes
    where enabled = true
    order by created_at asc
  `;
  const pass = await sql<{ token: string; until_at: string | null; blocked_at: string | null; auto_renew: boolean; until_ms: string | number; plan_id: string; quota_reset_at: string | null }>`
    select token, until_at::text as until_at, blocked_at::text as blocked_at, auto_renew, plan_id,
           quota_reset_at::text as quota_reset_at,
           floor(extract(epoch from until_at) * 1000)::bigint as until_ms
    from vpn_passes
    where user_id = ${userId}
  `;
  const usage = await readUsage(userId);
  const devices = await sql<{ id: string; name: string; token: string; revoked_at: string | null; created_at: string; last_pull_at: string | null }>`
    select id, name, token, revoked_at::text as revoked_at, created_at::text as created_at, last_pull_at::text as last_pull_at
    from vpn_devices
    where user_id = ${userId}
    order by created_at asc
  `;
  const history = await sql<{ id: string; amount: number; at: string }>`
    select id, amount::int as amount, created_at::text as at
    from wallet_transfers
    where from_id = ${userId} and note = 'VPN'
    order by created_at desc
    limit 8
  `;
  const days = await sql<{ day: string; upload: string | number; download: string | number }>`
    select day::text as day, sum(upload_bytes)::bigint as upload, sum(download_bytes)::bigint as download
    from vpn_usage_days
    where user_id = ${userId} and day > current_date - 14
    group by day
    order by day desc
  `;
  const row = pass[0];
  const untilMs = Number(row?.until_ms ?? 0);
  const active = Boolean(row) && !row?.blocked_at && untilMs > Date.now();
  const plan = row?.plan_id || "base";
  return {
    locations: nodes.map((item) => item.name),
    places: nodes.map((item) => ({
      name: item.name,
      country: item.country || "",
      city: item.city || "",
      reach: item.agent_enrolled ? item.reach || "unknown" : "unknown",
      maintenance: Boolean(item.maintenance),
      personal: Boolean(item.agent_enrolled),
      cut: Boolean(item.shared_cut),
    })),
    price: await priceOf("vpn", VPN_PRICE),
    days: VPN_DAYS,
    trafficBytes: await trafficBytes(),
    usedBytes: usedBytes(usage),
    uploadBytes: usage?.upload ?? null,
    downloadBytes: usage?.download ?? null,
    verified: await verified(userId),
    active,
    blocked: Boolean(row?.blocked_at),
    until: row?.until_at ?? null,
    daysLeft: active ? Math.max(0, Math.ceil((untilMs - Date.now()) / 86_400_000)) : 0,
    token: active ? row?.token ?? null : null,
    sharedNodes: nodes.filter((item) => !item.agent_enrolled).length,
    enrolledNodes: nodes.filter((item) => item.agent_enrolled).length,
    autoRenew: Boolean(row?.auto_renew),
    devices: devices.map((item) => ({
      id: item.id,
      name: item.name,
      token: item.revoked_at ? null : item.token,
      revoked: Boolean(item.revoked_at),
      createdAt: item.created_at,
      lastPull: item.last_pull_at,
    })),
    deviceCap: await planCap(plan),
    plan,
    quotaReset: row?.quota_reset_at ?? null,
    usageDays: days.map((item) => ({ day: item.day, upload: Number(item.upload), download: Number(item.download) })),
    history: history.map((item) => ({ id: item.id, amount: Number(item.amount), at: item.at })),
  };
}

async function readDesk(): Promise<VpnDesk> {
  const sql = await getSql();
  const nodes = await sql<{
    id: string;
    name: string;
    uri: string;
    enabled: boolean;
    country: string;
    city: string;
    protocol: string;
    host: string;
    reach: string;
    maintenance: boolean;
    agent_enrolled: boolean;
    last_check_at: string | null;
    last_error: string;
    load_note: string;
    ping_ms: number | null;
    client_count: number | null;
    shared_cut: boolean;
  }>`
    select id, name, uri, enabled, country, city, protocol, host, reach, maintenance, agent_enrolled,
           last_check_at::text as last_check_at, last_error, load_note, ping_ms, client_count, shared_cut
    from vpn_nodes
    order by created_at asc
  `;
  const plans = await sql<{ id: string; title: string; days: number; price: number; traffic_bytes: string | number; device_cap: number; enabled: boolean }>`
    select id, title, days, price, traffic_bytes, device_cap, enabled from vpn_plans order by price asc
  `;
  const stats = await sql<{ active: number; total: number; pulls: number }>`
    select
      (select count(*) from vpn_passes where until_at > now())::int as active,
      (select count(*) from vpn_passes)::int as total,
      (select count(*) from vpn_pulls where at > now() - interval '24 hours')::int as pulls
  `;
  return {
    nodes: nodes.map((row) => ({
      id: row.id,
      name: row.name,
      uri: row.uri,
      enabled: Boolean(row.enabled),
      country: row.country || "",
      city: row.city || "",
      protocol: row.protocol || "",
      host: row.host || "",
      reach: row.agent_enrolled ? row.reach || "unknown" : "unknown",
      maintenance: Boolean(row.maintenance),
      agentEnrolled: Boolean(row.agent_enrolled),
      lastCheck: row.last_check_at,
      lastError: row.last_error || "",
      loadNote: row.load_note || "",
      pingMs: row.ping_ms == null ? null : Number(row.ping_ms),
      clientCount: row.client_count == null ? null : Number(row.client_count),
      sharedCut: Boolean(row.shared_cut),
    })),
    price: await priceOf("vpn", VPN_PRICE),
    days: VPN_DAYS,
    trafficBytes: await trafficBytes(),
    activeLinks: Number(stats[0]?.active ?? 0),
    totalLinks: Number(stats[0]?.total ?? 0),
    pullsDay: Number(stats[0]?.pulls ?? 0),
    plans: plans.map((item) => ({
      id: item.id,
      title: item.title,
      days: Number(item.days),
      price: Number(item.price),
      trafficBytes: Number(item.traffic_bytes),
      deviceCap: Number(item.device_cap),
      enabled: Boolean(item.enabled),
    })),
  };
}

export const getVpnShowcase = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<VpnShowcase> => {
    await assertActive(context.userId);
    return readShowcase(context.userId);
  });

export async function purchaseVpn(userId: string, idem?: string): Promise<VpnShowcase> {
  if (!(await verified(userId))) {
    throw new Error("Сначала подтвердите почту в профиле. Без этого подписку не купить.");
  }
  const price = await priceOf("vpn", VPN_PRICE);
  const sql = await getSql();
  await sql`
    insert into wallets (user_id, balance, last_grant_at)
    values (${userId}, 1000, now())
    on conflict (user_id) do nothing
  `;
  const id = idem ? `vpn-${idem}` : `vpn-${crypto.randomUUID()}`;
  if (idem) {
    const prev = await sql<{ id: string }>`select id from wallet_transfers where id = ${id}`;
    if (prev.length) {
      const pass = await sql<{ user_id: string }>`select user_id from vpn_passes where user_id = ${userId}`;
      const step = purchaseOutcome({ balance: 0, price, transferExists: true, passExists: pass.length > 0 });
      if (step === "repair") {
        await sql`
          insert into vpn_passes (user_id, token, until_at, quota_reset_at)
          values (${userId}, ${newToken()}, now() + interval '30 days', now())
          on conflict (user_id) do nothing
        `;
      }
      return readShowcase(userId);
    }
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
      pass as (
        insert into vpn_passes (user_id, token, until_at, quota_reset_at)
        select user_id, ${newToken()}, now() + interval '30 days', now()
        from debit
        on conflict (user_id) do update
          set until_at = greatest(vpn_passes.until_at, now()) + interval '30 days',
              updated_at = now(),
              blocked_at = null,
              quota_reset_at = now()
        returning user_id
      ),
      baseline as (
        update vpn_counters
        set baseline_upload = upload_bytes, baseline_download = download_bytes
        where user_id = ${userId} and exists (select 1 from pass)
        returning user_id
      )
      insert into wallet_transfers (id, from_id, to_id, amount, note)
      select ${id}, ${userId}, null, ${price}, 'VPN'
      where exists (select 1 from pass)
      returning id
    `;
  } catch (err) {
    if (idem && isUniqueViolation(err)) return readShowcase(userId);
    throw err;
  }
  if (!done.length) throw new Error(`Нужно ${price} вублей`);
  void import("@/lib/social/push.server")
    .then((mod) =>
      mod.pushNotice(userId, "subs", {
        id: `shop:${id}`,
        title: "VPN",
        body: "Подписка VPN на 30 дней",
        url: "/c/services",
      }),
    )
    .catch(() => undefined);
  return readShowcase(userId);
}

export const buyVpn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<VpnShowcase> => {
    await assertActive(context.userId);
    const bucket = Math.floor(Date.now() / 15000);
    return purchaseVpn(context.userId, `${context.userId}-tap-${bucket}`);
  });

export const getVpnDesk = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<VpnDesk> => {
    await assertAdmin(context.userId);
    return readDesk();
  });

export const saveVpnNode = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = input && typeof input === "object" ? (input as { id?: unknown; name?: unknown; uri?: unknown; country?: unknown; city?: unknown; host?: unknown; protocol?: unknown }) : {};
    const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : "";
    if (id && !/^[A-Za-z0-9_-]{8,80}$/.test(id)) throw new Error("Сервер не найден");
    const clip = (value: unknown, max: number) => (typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "");
    const protocol = clip(raw.protocol, 16);
    if (protocol && protocol !== "vless" && protocol !== "hy2") throw new Error("Протокол: vless или hy2");
    return { id, name: nodeName(raw.name), uri: nodeUri(raw.uri), country: clip(raw.country, 40), city: clip(raw.city, 40), host: clip(raw.host, 120), protocol };
  })
  .handler(async ({ context, data }): Promise<VpnDesk> => {
    await assertAdmin(context.userId);
    const sql = await getSql();
    if (data.id) {
      const prev = await sql<{ protocol: string; uri: string }>`select protocol, uri from vpn_nodes where id = ${data.id}`;
      const rows = await sql<{ id: string }>`
        update vpn_nodes
        set name = ${data.name}, uri = ${data.uri}, country = ${data.country}, city = ${data.city}, host = ${data.host}, protocol = ${data.protocol}
        where id = ${data.id}
        returning id
      `;
      if (!rows.length) throw new Error("Сервер не найден");
      const nextProtocol = data.protocol || protocolOf(data.uri, "");
      const prevProtocol = protocolOf(prev[0]?.uri || "", prev[0]?.protocol || "");
      if (prev.length && nextProtocol !== prevProtocol) {
        await sql`update vpn_keys set revoked_at = now() where node_id = ${data.id} and revoked_at is null`;
      }
    } else {
      await sql`
        insert into vpn_nodes (id, name, uri, country, city, host, protocol)
        values (${crypto.randomUUID()}, ${data.name}, ${data.uri}, ${data.country}, ${data.city}, ${data.host}, ${data.protocol})
      `;
    }
    return readDesk();
  });

export const setVpnNodeEnabled = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = input && typeof input === "object" ? (input as { id?: unknown; enabled?: unknown }) : {};
    if (typeof raw.id !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(raw.id)) throw new Error("Сервер не найден");
    if (typeof raw.enabled !== "boolean") throw new Error("Некорректное действие");
    return { id: raw.id, enabled: raw.enabled };
  })
  .handler(async ({ context, data }): Promise<VpnDesk> => {
    await assertAdmin(context.userId);
    const sql = await getSql();
    await sql`update vpn_nodes set enabled = ${data.enabled} where id = ${data.id}`;
    return readDesk();
  });

export const removeVpnNode = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    if (typeof input !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(input)) throw new Error("Сервер не найден");
    return input;
  })
  .handler(async ({ context, data }): Promise<VpnDesk> => {
    await assertAdmin(context.userId);
    const sql = await getSql();
    await sql`delete from vpn_nodes where id = ${data}`;
    return readDesk();
  });

export const saveVpnTraffic = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => gbOf(input && typeof input === "object" ? (input as { gb?: unknown }).gb : input))
  .handler(async ({ context, data }): Promise<VpnDesk> => {
    await assertAdmin(context.userId);
    const sql = await getSql();
    const bytes = data * GIB;
    await sql`
      insert into vpn_plan (id, traffic_bytes)
      values (1, ${bytes})
      on conflict (id) do update set traffic_bytes = ${bytes}
    `;
    await sql`update vpn_plans set traffic_bytes = ${bytes} where id = 'base'`;
    return readDesk();
  });

function daysOf(value: unknown): number {
  const n = typeof value === "number" ? value : Number(typeof value === "string" ? value : NaN);
  if (!Number.isInteger(n) || n < 1 || n > 365) throw new Error("Срок — от 1 до 365 дней");
  return n;
}

async function userByEmail(email: string): Promise<string> {
  const sql = await getSql();
  const users = await sql<{ id: string }>`select id from "user" where lower(email) = ${email} limit 1`;
  const id = users[0]?.id;
  if (!id) throw new Error("Такой почты нет");
  return id;
}

async function extendPass(userId: string, days: number, plan: string) {
  const sql = await getSql();
  await sql`
    insert into vpn_passes (user_id, token, until_at, plan_id)
    values (${userId}, ${newToken()}, now() + (${String(days)} || ' days')::interval, ${plan})
    on conflict (user_id) do update
      set until_at = greatest(vpn_passes.until_at, now()) + (${String(days)} || ' days')::interval,
          plan_id = ${plan},
          blocked_at = null,
          updated_at = now()
  `;
}

export const grantVpn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => emailOf(input && typeof input === "object" ? (input as { email?: unknown }).email : input))
  .handler(async ({ context, data }): Promise<VpnDesk> => {
    await assertAdmin(context.userId);
    const userId = await userByEmail(data);
    await extendPass(userId, 30, "base");
    await audit(context.userId, userId, "grant", "30");
    return readDesk();
  });

export const setVpnMaintenance = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = input && typeof input === "object" ? (input as { id?: unknown; maintenance?: unknown }) : {};
    if (typeof raw.id !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(raw.id)) throw new Error("Сервер не найден");
    if (typeof raw.maintenance !== "boolean") throw new Error("Некорректное действие");
    return { id: raw.id, maintenance: raw.maintenance };
  })
  .handler(async ({ context, data }): Promise<VpnDesk> => {
    await assertAdmin(context.userId);
    const sql = await getSql();
    await sql`update vpn_nodes set maintenance = ${data.maintenance} where id = ${data.id}`;
    await audit(context.userId, null, "maintenance", data.id);
    return readDesk();
  });

export type VpnPerson = {
  email: string;
  active: boolean;
  blocked: boolean;
  until: string | null;
  plan: string;
  usedBytes: number | null;
  devices: number;
  autoRenew: boolean;
  audit: { kind: string; note: string; at: string }[];
};

async function personOf(email: string): Promise<VpnPerson> {
  const userId = await userByEmail(email);
  const sql = await getSql();
  const users = await sql<{ email: string }>`select email from "user" where id = ${userId}`;
  const pass = await sql<{ until_at: string | null; blocked_at: string | null; plan_id: string; auto_renew: boolean; until_ms: string | number }>`
    select until_at::text as until_at, blocked_at::text as blocked_at, plan_id, auto_renew,
           floor(extract(epoch from until_at) * 1000)::bigint as until_ms
    from vpn_passes where user_id = ${userId}
  `;
  const devices = await sql<{ n: number }>`select count(*)::int as n from vpn_devices where user_id = ${userId} and revoked_at is null`;
  const auditRows = await sql<{ kind: string; note: string; at: string }>`
    select kind, note, created_at::text as at from vpn_audit where user_id = ${userId} order by created_at desc limit 8
  `;
  const row = pass[0];
  return {
    email: users[0]?.email || email,
    active: Boolean(row) && !row?.blocked_at && Number(row?.until_ms ?? 0) > Date.now(),
    blocked: Boolean(row?.blocked_at),
    until: row?.until_at ?? null,
    plan: row?.plan_id || "base",
    usedBytes: usedBytes(await readUsage(userId)),
    devices: Number(devices[0]?.n ?? 0),
    autoRenew: Boolean(row?.auto_renew),
    audit: auditRows.map((item) => ({ kind: item.kind, note: item.note, at: item.at })),
  };
}

export const findVpnUser = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => emailOf(input && typeof input === "object" ? (input as { email?: unknown }).email : input))
  .handler(async ({ context, data }): Promise<VpnPerson> => {
    await assertAdmin(context.userId);
    return personOf(data);
  });

export const grantVpnDays = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = input && typeof input === "object" ? (input as { email?: unknown; days?: unknown }) : {};
    return { email: emailOf(raw.email), days: daysOf(raw.days) };
  })
  .handler(async ({ context, data }): Promise<VpnDesk> => {
    await assertAdmin(context.userId);
    const userId = await userByEmail(data.email);
    await extendPass(userId, data.days, "base");
    await audit(context.userId, userId, "grant", String(data.days));
    return readDesk();
  });

export const grantVpnTrial = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => emailOf(input && typeof input === "object" ? (input as { email?: unknown }).email : input))
  .handler(async ({ context, data }): Promise<VpnDesk> => {
    await assertAdmin(context.userId);
    const userId = await userByEmail(data);
    await extendPass(userId, 3, "trial");
    await audit(context.userId, userId, "trial", "3");
    return readDesk();
  });

export const setVpnBlocked = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = input && typeof input === "object" ? (input as { email?: unknown; blocked?: unknown }) : {};
    if (typeof raw.blocked !== "boolean") throw new Error("Некорректное действие");
    return { email: emailOf(raw.email), blocked: raw.blocked };
  })
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const userId = await userByEmail(data.email);
    const sql = await getSql();
    await sql`update vpn_passes set blocked_at = ${data.blocked ? new Date().toISOString() : null}, updated_at = now() where user_id = ${userId}`;
    await audit(context.userId, userId, data.blocked ? "block" : "unblock", "");
    return personOf(data.email);
  });

export const revokeVpnKeys = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => emailOf(input && typeof input === "object" ? (input as { email?: unknown }).email : input))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const userId = await userByEmail(data);
    const sql = await getSql();
    await sql`update vpn_keys set revoked_at = now() where user_id = ${userId} and revoked_at is null`;
    await sql`update vpn_devices set revoked_at = now() where user_id = ${userId} and revoked_at is null`;
    await audit(context.userId, userId, "revoke-keys", "");
    return personOf(data);
  });

export const resetVpnQuota = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => emailOf(input && typeof input === "object" ? (input as { email?: unknown }).email : input))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const userId = await userByEmail(data);
    const sql = await getSql();
    await sql`update vpn_counters set baseline_upload = upload_bytes, baseline_download = download_bytes where user_id = ${userId}`;
    await sql`update vpn_passes set quota_reset_at = now(), updated_at = now() where user_id = ${userId}`;
    await sql`delete from vpn_usage_days where user_id = ${userId}`;
    await audit(context.userId, userId, "reset-quota", "");
    return personOf(data);
  });

export const rotateVpnToken = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<VpnShowcase> => {
    await assertActive(context.userId);
    const sql = await getSql();
    const rows = await sql<{ token: string }>`
      update vpn_passes set token = ${newToken()}, updated_at = now()
      where user_id = ${context.userId}
      returning token
    `;
    if (!rows.length) throw new Error("Сначала оформите подписку");
    await audit(context.userId, context.userId, "rotate-token", "");
    return readShowcase(context.userId);
  });

export const setVpnAutoRenew = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const on = input && typeof input === "object" ? (input as { on?: unknown }).on : input;
    if (typeof on !== "boolean") throw new Error("Некорректное действие");
    return on;
  })
  .handler(async ({ context, data }): Promise<VpnShowcase> => {
    await assertActive(context.userId);
    const sql = await getSql();
    const rows = await sql<{ user_id: string }>`
      update vpn_passes set auto_renew = ${data}, updated_at = now() where user_id = ${context.userId} returning user_id
    `;
    if (!rows.length) throw new Error("Сначала оформите подписку");
    return readShowcase(context.userId);
  });

export const addVpnDevice = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => nodeName(input && typeof input === "object" ? (input as { name?: unknown }).name : input))
  .handler(async ({ context, data }): Promise<VpnShowcase> => {
    await assertActive(context.userId);
    const sql = await getSql();
    const pass = await sql<{ ok: number }>`
      select 1 as ok from vpn_passes where user_id = ${context.userId} and blocked_at is null and until_at > now()
    `;
    if (!pass.length) throw new Error("Нужна действующая подписка");
    const count = await sql<{ n: number }>`select count(*)::int as n from vpn_devices where user_id = ${context.userId} and revoked_at is null`;
    const passPlan = await sql<{ plan_id: string }>`select plan_id from vpn_passes where user_id = ${context.userId}`;
    const cap = await planCap(passPlan[0]?.plan_id || "base");
    if (Number(count[0]?.n ?? 0) >= cap) throw new Error(`Уже ${cap} устройств. Отзовите одно, чтобы добавить новое.`);
    await sql`
      insert into vpn_devices (id, user_id, name, token)
      values (${crypto.randomUUID()}, ${context.userId}, ${data}, ${newToken()})
    `;
    return readShowcase(context.userId);
  });

export const revokeVpnDevice = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    if (typeof input !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(input)) throw new Error("Устройство не найдено");
    return input;
  })
  .handler(async ({ context, data }): Promise<VpnShowcase> => {
    await assertActive(context.userId);
    const sql = await getSql();
    await sql`update vpn_devices set revoked_at = now() where id = ${data} and user_id = ${context.userId} and revoked_at is null`;
    await sql`update vpn_keys set revoked_at = now() where user_id = ${context.userId} and device_id = ${data} and revoked_at is null`;
    return readShowcase(context.userId);
  });

export const reissueVpnDevice = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    if (typeof input !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(input)) throw new Error("Устройство не найдено");
    return input;
  })
  .handler(async ({ context, data }): Promise<VpnShowcase> => {
    await assertActive(context.userId);
    const sql = await getSql();
    const rows = await sql<{ id: string }>`
      update vpn_devices set token = ${newToken()}
      where id = ${data} and user_id = ${context.userId} and revoked_at is null
      returning id
    `;
    if (!rows.length) throw new Error("Устройство не найдено");
    await sql`update vpn_keys set revoked_at = now() where user_id = ${context.userId} and device_id = ${data} and revoked_at is null`;
    await audit(context.userId, context.userId, "reissue-device", "");
    return readShowcase(context.userId);
  });

export async function renewDueVpn(): Promise<number> {
  const sql = await getSql();
  const rows = await sql<{ user_id: string }>`
    select user_id from vpn_passes
    where auto_renew = true and blocked_at is null
      and until_at <= now() + interval '1 day' and until_at > now() - interval '1 day'
  `;
  const day = new Date().toISOString().slice(0, 10);
  let done = 0;
  for (const row of rows) {
    try {
      await purchaseVpn(row.user_id, `auto-${row.user_id.slice(0, 20)}-${day}`);
      done += 1;
    } catch {
      /* a short balance is not charged */
    }
  }
  return done;
}

export async function handleVpnAgent(request: Request): Promise<Response> {
  const deny = (status: number, message: string) => Response.json({ message }, { status, headers: { "cache-control": "no-store" } });
  if (!process.env.VPN_AGENT_TOKEN?.trim()) return deny(503, "Агент не настроен");
  if (!(await agentTokenOk(request.headers.get("authorization")))) return deny(401, "Нет доступа");
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return deny(400, "Некорректный JSON");
  }
  const nodeId = typeof body.nodeId === "string" ? body.nodeId.trim() : "";
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(nodeId)) return deny(404, "Сервер не найден");
  const sql = await getSql();
  const nodes = await sql<{ id: string; name: string; protocol: string; uri: string; agent_enrolled: boolean; shared_cut: boolean; reach: string }>`
    select id, name, protocol, uri, agent_enrolled, shared_cut, reach from vpn_nodes where id = ${nodeId} limit 1
  `;
  const node = nodes[0];
  if (!node) return deny(404, "Сервер не найден");
  const quiet = { headers: { "cache-control": "no-store" } };
  if (body.op === "enroll") {
    const mark = afterAgent({ wasEnrolled: Boolean(node.agent_enrolled), event: "seen" });
    await sql`update vpn_nodes set last_check_at = now() where id = ${nodeId}`;
    await audit(null, null, "seen", nodeId);
    return Response.json({ enrolled: mark.enrolled, seen: true }, quiet);
  }
  if (body.op === "pull") {
    const protocol = protocolOf(node.uri, node.protocol);
    const quota = await trafficBytes();
    const people = await sql<{ user_id: string; plan_id: string }>`
      select user_id, plan_id from vpn_passes where blocked_at is null and until_at > now()
    `;
    const users: { userId: string; deviceId: string; protocol: string; secret: string; email: string }[] = [];
    for (const person of people) {
      const state = accessOf({
        found: true,
        untilMs: Date.now() + 60_000,
        now: Date.now(),
        blocked: false,
        used: usedBytes(await readUsage(person.user_id)),
        quota,
      });
      if (state !== "ok") {
        await sql`
          insert into vpn_sync (id, node_id, user_id, action, status, detail)
          select ${crypto.randomUUID()}, ${nodeId}, ${person.user_id}, 'revoke', 'pending', ${state}
          where not exists (
            select 1 from vpn_sync
            where node_id = ${nodeId} and user_id = ${person.user_id} and created_at > now() - interval '6 hours'
          )
        `;
        continue;
      }
      const devices = await sql<{ id: string }>`
        select id from vpn_devices where user_id = ${person.user_id} and revoked_at is null order by created_at asc
      `;
      for (const slot of openSlots(devices.map((item) => item.id), await planCap(person.plan_id || "base"))) {
        const secret = await ensureKey(person.user_id, nodeId, slot, protocol);
        users.push({ userId: person.user_id, deviceId: slot, protocol, secret, email: keyEmail(person.user_id, slot) });
      }
    }
    const shared = sharedCredential(node.uri);
    const install = clientsToInstall({
      secrets: users.map((item) => item.secret),
      dropShared: Boolean(node.shared_cut),
      shared: shared && shared.protocol === protocol ? shared.secret : null,
    });
    await sql`update vpn_nodes set last_check_at = now(), client_count = ${users.length} where id = ${nodeId}`;
    return Response.json({
      enforced: Boolean(node.agent_enrolled) && Boolean(node.shared_cut),
      replaceManaged: true,
      dropShared: !install.sharedKept,
      shared: install.sharedKept ? shared?.secret ?? null : null,
      users,
    }, quiet);
  }
  if (body.op === "applied") {
    const mark = afterAgent({ wasEnrolled: Boolean(node.agent_enrolled), event: body.ok === true ? "applied" : "apply-failed" });
    const error = typeof body.error === "string" ? body.error.trim().slice(0, 160) : "";
    const count = Number(body.clients);
    const status = syncState({ applyError: error, retryApplied: body.ok === true });
    await sql`
      update vpn_nodes
      set agent_enrolled = ${mark.enrolled},
          reach = ${mark.reach},
          last_error = ${error},
          last_check_at = now(),
          client_count = ${Number.isFinite(count) && count >= 0 ? Math.floor(count) : null}
      where id = ${nodeId}
    `;
    await sql`
      update vpn_sync set status = ${status}, detail = ${error}
      where node_id = ${nodeId} and status = 'pending'
    `;
    await audit(null, null, body.ok === true ? "applied" : "apply-failed", nodeId);
    return Response.json({ enrolled: mark.enrolled, reach: mark.reach }, quiet);
  }
  if (body.op === "report") {
    const reported = body.reach === "up" || body.reach === "down" ? body.reach : "unknown";
    const mark = afterAgent({ wasEnrolled: Boolean(node.agent_enrolled), event: reported === "down" ? "down" : reported === "up" ? "up" : "seen" });
    const note = typeof body.load === "string" ? body.load.trim().slice(0, 80) : "";
    const error = typeof body.error === "string" ? body.error.trim().slice(0, 160) : "";
    const ping = Number(body.pingMs);
    const pingMs = Number.isFinite(ping) && ping >= 0 && ping <= 60000 ? Math.floor(ping) : null;
    await sql`
      update vpn_nodes
      set reach = ${mark.reach},
          load_note = ${note},
          last_error = ${error},
          last_check_at = now(),
          ping_ms = ${pingMs}
      where id = ${nodeId}
    `;
    if (reported === "down" && node.reach !== "down") {
      void import("@/lib/social/push.server")
        .then((mod) => mod.pushVpnNodeDown(nodeId, node.name))
        .catch(() => undefined);
    }
    let saved = false;
    if (Array.isArray(body.users)) {
      saved = true;
      for (const item of body.users) {
        if (!item || typeof item !== "object") continue;
        const row = item as { userId?: unknown; upload?: unknown; download?: unknown };
        if (typeof row.userId !== "string" || row.userId.length > 80) continue;
        const upload = Number(row.upload);
        const download = Number(row.download);
        if (!Number.isFinite(upload) || !Number.isFinite(download) || upload < 0 || download < 0) continue;
        const prev = await sql<{ upload_bytes: string | number; download_bytes: string | number; baseline_upload: string | number; baseline_download: string | number }>`
          select upload_bytes, download_bytes, baseline_upload, baseline_download
          from vpn_counters where user_id = ${row.userId} and node_id = ${nodeId}
        `;
        const known = Boolean(prev[0]);
        const baseUp = nextBaseline(known ? Number(prev[0]?.upload_bytes) : null, known ? Number(prev[0]?.baseline_upload) : null, upload);
        const baseDown = nextBaseline(known ? Number(prev[0]?.download_bytes) : null, known ? Number(prev[0]?.baseline_download) : null, download);
        const deltaUp = counterDelta(known ? Number(prev[0]?.upload_bytes) : null, upload);
        const deltaDown = counterDelta(known ? Number(prev[0]?.download_bytes) : null, download);
        await sql`
          insert into vpn_counters (user_id, node_id, upload_bytes, download_bytes, baseline_upload, baseline_download, reported_at)
          values (${row.userId}, ${nodeId}, ${Math.floor(upload)}, ${Math.floor(download)}, ${baseUp}, ${baseDown}, now())
          on conflict (user_id, node_id) do update
            set upload_bytes = excluded.upload_bytes,
                download_bytes = excluded.download_bytes,
                baseline_upload = excluded.baseline_upload,
                baseline_download = excluded.baseline_download,
                reported_at = now()
        `;
        if (known && (deltaUp > 0 || deltaDown > 0)) {
          await sql`
            insert into vpn_usage_days (user_id, node_id, day, upload_bytes, download_bytes)
            values (${row.userId}, ${nodeId}, current_date, ${deltaUp}, ${deltaDown})
            on conflict (user_id, node_id, day) do update
              set upload_bytes = vpn_usage_days.upload_bytes + excluded.upload_bytes,
                  download_bytes = vpn_usage_days.download_bytes + excluded.download_bytes
          `;
        }
      }
    }
    return Response.json({ saved }, quiet);
  }
  if (body.op === "ack") {
    const id = typeof body.id === "string" ? body.id.slice(0, 80) : "";
    if (id) {
      await sql`
        update vpn_sync set status = ${body.ok === true ? "ok" : "error"}, detail = ${typeof body.detail === "string" ? body.detail.slice(0, 160) : ""}
        where id = ${id} and node_id = ${nodeId}
      `;
    }
    return Response.json({ ok: true }, quiet);
  }
  return deny(400, "Неизвестное действие");
}

export const setVpnSharedCut = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = input && typeof input === "object" ? (input as { id?: unknown; cut?: unknown }) : {};
    if (typeof raw.id !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(raw.id)) throw new Error("Сервер не найден");
    if (typeof raw.cut !== "boolean") throw new Error("Некорректное действие");
    return { id: raw.id, cut: raw.cut };
  })
  .handler(async ({ context, data }): Promise<VpnDesk> => {
    await assertAdmin(context.userId);
    const sql = await getSql();
    const rows = await sql<{ agent_enrolled: boolean }>`select agent_enrolled from vpn_nodes where id = ${data.id}`;
    if (!rows.length) throw new Error("Сервер не найден");
    if (data.cut && !rows[0]?.agent_enrolled) throw new Error("Сначала агент должен записать личные ключи");
    await sql`update vpn_nodes set shared_cut = ${data.cut} where id = ${data.id}`;
    await audit(context.userId, null, data.cut ? "cut-shared" : "keep-shared", data.id);
    return readDesk();
  });

export const saveVpnPlan = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = input && typeof input === "object" ? (input as { id?: unknown; enabled?: unknown; price?: unknown; days?: unknown; deviceCap?: unknown }) : {};
    const id = typeof raw.id === "string" ? raw.id : "";
    if (id !== "trial" && id !== "plus" && id !== "family") throw new Error("Базовый тариф остаётся 2000 вублей и 30 дней");
    if (typeof raw.enabled !== "boolean") throw new Error("Некорректное действие");
    const price = Number(raw.price);
    const days = Number(raw.days);
    const deviceCap = Number(raw.deviceCap);
    if (!Number.isInteger(price) || price < 0 || price > 1_000_000) throw new Error("Цена некорректна");
    if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error("Срок некорректен");
    if (!Number.isInteger(deviceCap) || deviceCap < 1 || deviceCap > 20) throw new Error("Лимит устройств некорректен");
    return { id, enabled: raw.enabled, price, days, deviceCap };
  })
  .handler(async ({ context, data }): Promise<VpnDesk> => {
    await assertAdmin(context.userId);
    const sql = await getSql();
    await sql`
      update vpn_plans
      set enabled = ${data.enabled}, price = ${data.price}, days = ${data.days}, device_cap = ${data.deviceCap}
      where id = ${data.id}
    `;
    await audit(context.userId, null, "plan", data.id);
    return readDesk();
  });

