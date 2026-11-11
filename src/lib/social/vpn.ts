import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { assertActive, assertAdmin } from "@/lib/social/access";
import { isUniqueViolation } from "@/lib/social/sql-error";
import { priceOf } from "@/lib/social/prices";

export const VPN_PRICE = 2000;
export const VPN_DAYS = 30;
const TOKEN = /^[A-Za-z0-9_-]{20,80}$/;
const GIB = 1024 * 1024 * 1024;

export type VpnNode = {
  id: string;
  name: string;
  uri: string;
  enabled: boolean;
};

export type VpnShowcase = {
  locations: string[];
  price: number;
  days: number;
  trafficBytes: number;
  verified: boolean;
  active: boolean;
  until: string | null;
  token: string | null;
};

export type VpnDesk = {
  nodes: VpnNode[];
  price: number;
  days: number;
  trafficBytes: number;
  activeLinks: number;
  totalLinks: number;
  pullsDay: number;
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

function named(uri: string, name: string): string {
  const cut = uri.indexOf("#");
  const base = cut === -1 ? uri : uri.slice(0, cut);
  return `${base}#${encodeURIComponent(name)}`;
}

export async function renderVpnSubscription(token: string): Promise<Response> {
  const headers = {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
    "profile-update-interval": "1",
    "profile-title": "VVVION",
    "profile-web-page-url": "https://vvvion.space",
    "support-url": "https://vvvion.space",
  };
  if (!TOKEN.test(token)) {
    return new Response("not found", { status: 404, headers });
  }
  const sql = await getSql();
  const passes = await sql<{ user_id: string; until_ms: string | number }>`
    select user_id, floor(extract(epoch from until_at))::bigint as until_ms
    from vpn_passes
    where token = ${token}
    limit 1
  `;
  const pass = passes[0];
  if (!pass) return new Response("not found", { status: 404, headers });
  const expire = Number(pass.until_ms);
  const alive = Number.isFinite(expire) && expire * 1000 > Date.now();
  const total = await trafficBytes();
  const nodes = alive
    ? await sql<{ name: string; uri: string }>`
        select name, uri from vpn_nodes where enabled = true order by created_at asc
      `
    : [];
  const info = `upload=0; download=0; total=${total}; expire=${Number.isFinite(expire) ? expire : 0}`;
  const lines = [
    "#profile-title: VVVION",
    "#profile-update-interval: 1",
    `#subscription-userinfo: ${info}`,
    ...nodes.map((node) => named(node.uri, node.name)),
  ];
  const body = Buffer.from(lines.join("\n"), "utf8").toString("base64");
  await sql`
    insert into vpn_pulls (id, user_id)
    values (${crypto.randomUUID()}, ${pass.user_id})
  `;
  return new Response(body, {
    status: 200,
    headers: {
      ...headers,
      "content-disposition": 'attachment; filename="vvvion"',
      "subscription-userinfo": info,
    },
  });
}

async function readShowcase(userId: string): Promise<VpnShowcase> {
  const sql = await getSql();
  const nodes = await sql<{ name: string }>`
    select name from vpn_nodes where enabled = true order by created_at asc
  `;
  const pass = await sql<{ token: string; until_at: string | null }>`
    select token, until_at::text as until_at
    from vpn_passes
    where user_id = ${userId} and until_at > now()
  `;
  return {
    locations: nodes.map((row) => row.name),
    price: await priceOf("vpn", VPN_PRICE),
    days: VPN_DAYS,
    trafficBytes: await trafficBytes(),
    verified: await verified(userId),
    active: Boolean(pass[0]),
    until: pass[0]?.until_at ?? null,
    token: pass[0]?.token ?? null,
  };
}

async function readDesk(): Promise<VpnDesk> {
  const sql = await getSql();
  const nodes = await sql<{ id: string; name: string; uri: string; enabled: boolean }>`
    select id, name, uri, enabled from vpn_nodes order by created_at asc
  `;
  const stats = await sql<{ active: number; total: number; pulls: number }>`
    select
      (select count(*) from vpn_passes where until_at > now())::int as active,
      (select count(*) from vpn_passes)::int as total,
      (select count(*) from vpn_pulls where at > now() - interval '24 hours')::int as pulls
  `;
  return {
    nodes: nodes.map((row) => ({ id: row.id, name: row.name, uri: row.uri, enabled: Boolean(row.enabled) })),
    price: await priceOf("vpn", VPN_PRICE),
    days: VPN_DAYS,
    trafficBytes: await trafficBytes(),
    activeLinks: Number(stats[0]?.active ?? 0),
    totalLinks: Number(stats[0]?.total ?? 0),
    pullsDay: Number(stats[0]?.pulls ?? 0),
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
    if (prev.length) return readShowcase(userId);
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
        insert into vpn_passes (user_id, token, until_at)
        select user_id, ${newToken()}, now() + interval '30 days'
        from debit
        on conflict (user_id) do update
          set until_at = greatest(vpn_passes.until_at, now()) + interval '30 days',
              updated_at = now()
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
  return readShowcase(userId);
}

export const buyVpn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<VpnShowcase> => {
    await assertActive(context.userId);
    return purchaseVpn(context.userId);
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
    const raw = input && typeof input === "object" ? (input as { id?: unknown; name?: unknown; uri?: unknown }) : {};
    const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : "";
    if (id && !/^[A-Za-z0-9_-]{8,80}$/.test(id)) throw new Error("Сервер не найден");
    return { id, name: nodeName(raw.name), uri: nodeUri(raw.uri) };
  })
  .handler(async ({ context, data }): Promise<VpnDesk> => {
    await assertAdmin(context.userId);
    const sql = await getSql();
    if (data.id) {
      const rows = await sql<{ id: string }>`
        update vpn_nodes set name = ${data.name}, uri = ${data.uri}
        where id = ${data.id}
        returning id
      `;
      if (!rows.length) throw new Error("Сервер не найден");
    } else {
      await sql`
        insert into vpn_nodes (id, name, uri)
        values (${crypto.randomUUID()}, ${data.name}, ${data.uri})
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
    return readDesk();
  });

export const grantVpn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => emailOf(input && typeof input === "object" ? (input as { email?: unknown }).email : input))
  .handler(async ({ context, data }): Promise<VpnDesk> => {
    await assertAdmin(context.userId);
    const sql = await getSql();
    const users = await sql<{ id: string }>`
      select id from "user" where lower(email) = ${data} limit 1
    `;
    const userId = users[0]?.id;
    if (!userId) throw new Error("Такой почты нет");
    await sql`
      insert into vpn_passes (user_id, token, until_at)
      values (${userId}, ${newToken()}, now() + interval '30 days')
      on conflict (user_id) do update
        set until_at = greatest(vpn_passes.until_at, now()) + interval '30 days',
            updated_at = now()
    `;
    return readDesk();
  });
