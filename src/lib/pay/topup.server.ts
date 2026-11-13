import { createHash } from "node:crypto";
import { auth } from "@/lib/auth/server";
import { getSql, withTransaction, type Sql } from "@/lib/db";
import { assertActive } from "@/lib/social/access";
import {
  acceptedAssets,
  createInvoice,
  deleteInvoice,
  getInvoices,
  getPaidInvoices,
  invoiceView,
  type CryptoInvoice,
} from "./cryptopay.ts";
import { payFlags, warnIfPayMisconfigured } from "./flags.ts";
import { rubAmount, toCents } from "./money.ts";
import { settleInvoice, type SettleOutcome } from "./settle.ts";
import { quote, type Quote } from "./vubli-rate.ts";

export type TopupResult = { status: number; body: Record<string, unknown> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type TopupDb = {
  id: string;
  user_id: string;
  status: string;
  fiat: string;
  fiat_amount: string;
  tier_id: string;
  rate_x1000: number;
  rate_version: string;
  vubli_total: number;
  vubli_purchased: number;
  vubli_bonus: number;
  return_to: string;
  invoice_url: string | null;
  mini_app_url: string | null;
  web_app_url: string | null;
  expires_at: string;
  paid_at: string | null;
  provider_invoice_id: string | null;
  idem_key: string;
  network: string;
  created_at: string;
};

function num(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function requireUser(request: Request): Promise<string | TopupResult> {
  const session = await auth.api.getSession({ headers: request.headers });
  const userId = session?.user?.id;
  if (!userId) return { status: 401, body: { code: "unauthorized" } };
  try {
    await assertActive(userId);
  } catch {
    return { status: 403, body: { code: "forbidden" } };
  }
  return userId;
}

export function clientIpHash(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || request.headers.get("x-real-ip")?.trim() || "";
  if (!ip) return null;
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

function publicTopup(row: TopupDb, balance?: number) {
  return {
    id: row.id,
    status: row.status,
    rub: num(row.fiat_amount),
    vubli: {
      total: num(row.vubli_total),
      purchased: num(row.vubli_purchased),
      bonus: num(row.vubli_bonus),
    },
    tier: {
      id: row.tier_id,
      label: null as string | null,
      bonusPct: Math.round((num(row.rate_x1000) / 10000 - 1) * 1000) / 10,
    },
    expiresAt: row.expires_at,
    ...(row.paid_at ? { paidAt: row.paid_at } : {}),
    urls: {
      bot: row.invoice_url,
      miniApp: row.mini_app_url,
      web: row.web_app_url,
    },
    ...(typeof balance === "number" ? { balance } : {}),
  };
}

const ROW = `id, user_id, status, fiat, fiat_amount::text as fiat_amount, tier_id, rate_x1000,
  rate_version, vubli_total::int as vubli_total, vubli_purchased::int as vubli_purchased,
  vubli_bonus::int as vubli_bonus, return_to, invoice_url, mini_app_url, web_app_url,
  expires_at::text as expires_at, paid_at::text as paid_at, provider_invoice_id::text as provider_invoice_id,
  idem_key, network, created_at::text as created_at`;

async function readRow(sql: Sql, id: string): Promise<TopupDb | null> {
  const rows = await sql.query<TopupDb>(`select ${ROW} from vubli_topups where id = $1`, [id]);
  return rows[0] ?? null;
}

async function balanceOf(sql: Sql, userId: string): Promise<number> {
  const rows = await sql.query<{ balance: number }>(`select balance::int as balance from wallets where user_id = $1`, [userId]);
  return num(rows[0]?.balance);
}

export async function readWalletBalance(userId: string): Promise<number> {
  const sql = await getSql();
  return balanceOf(sql, userId);
}

async function verified(sql: Sql, userId: string): Promise<boolean> {
  const rows = await sql.query<{ ok: boolean | null }>(`select "emailVerified" as ok from "user" where id = $1`, [userId]);
  return Boolean(rows[0]?.ok);
}

function present(row: TopupDb, balance?: number, http = 200): TopupResult {
  const body = publicTopup(row, balance);
  if (row.status === "failed") return { status: 502, body: { code: "provider_unavailable", ...body } };
  return { status: http, body };
}

async function issue(sql: Sql, row: TopupDb): Promise<TopupResult> {
  const flags = payFlags();
  if (row.provider_invoice_id && row.invoice_url) return present(row);
  const rub = num(row.fiat_amount);
  try {
    const inv = await createInvoice({
      currency_type: "fiat",
      fiat: "RUB",
      amount: rubAmount(rub),
      accepted_assets: acceptedAssets(flags.network),
      description: `VVVion: ${num(row.vubli_total).toLocaleString("ru-RU")} вублей`,
      payload: row.id,
      expires_in: 1800,
      paid_btn_name: "callback",
      paid_btn_url: `https://vvvion.space/?place=${row.return_to}&topup=${row.id}`,
      allow_comments: false,
      hidden_message: "Вубли начислятся автоматически, это занимает до минуты",
    });
    await sql.query(
      `update vubli_topups
       set provider_invoice_id = $2::bigint,
           provider_hash = $3,
           invoice_url = $4,
           mini_app_url = $5,
           web_app_url = $6,
           updated_at = now()
       where id = $1`,
      [
        row.id,
        String(inv.invoice_id),
        inv.hash ?? null,
        inv.bot_invoice_url ?? null,
        inv.mini_app_invoice_url ?? null,
        inv.web_app_invoice_url ?? null,
      ],
    );
    const next = await readRow(sql, row.id);
    return present(next ?? row);
  } catch (err) {
    console.error("[pay] createInvoice", err instanceof Error ? err.name : "error");
    await sql.query(`update vubli_topups set status = 'failed', updated_at = now() where id = $1 and status = 'pending'`, [row.id]);
    return { status: 502, body: { code: "provider_unavailable" } };
  }
}

export async function createTopup(
  userId: string,
  input: { rub: number; returnTo: "shop" | "bank"; idem: string; ipHash: string | null },
): Promise<TopupResult> {
  warnIfPayMisconfigured();
  const flags = payFlags();
  if (!flags.cryptoEnabled || !flags.payTopup || !flags.token) {
    if ((flags.cryptoEnabled || flags.payTopup) && !flags.token) console.error("[pay] CRYPTOPAY_TOKEN не задан");
    return { status: 503, body: { code: "topup_disabled" } };
  }
  if (!flags.currencies.includes("RUB")) return { status: 400, body: { code: "amount_out_of_range" } };
  const sql = await getSql();
  if (flags.requireVerified && !(await verified(sql, userId))) {
    return { status: 403, body: { code: "email_not_verified" } };
  }
  let quoted: Quote;
  try {
    quoted = quote(input.rub);
  } catch {
    return { status: 400, body: { code: "amount_out_of_range" } };
  }
  const same = await sql.query<TopupDb>(
    `select ${ROW} from vubli_topups where user_id = $1 and idem_key = $2`,
    [userId, input.idem],
  );
  if (same[0]) {
    if (same[0].status === "pending" && !same[0].provider_invoice_id) return issue(sql, same[0]);
    return present(same[0]);
  }
  const reused = await sql.query<TopupDb>(
    `select ${ROW} from vubli_topups
     where user_id = $1 and status = 'pending' and fiat = 'RUB' and network = $2
       and fiat_amount = $3::numeric and expires_at > now() + interval '5 minutes'
       and provider_invoice_id is not null
     order by created_at desc
     limit 1`,
    [userId, flags.network, rubAmount(quoted.rub)],
  );
  if (reused[0]) return present(reused[0]);

  const hour = await sql.query<{ n: number }>(
    `select count(*)::int as n from vubli_topups where user_id = $1 and created_at > now() - interval '1 hour'`,
    [userId],
  );
  if (num(hour[0]?.n) >= 10) return { status: 429, body: { code: "rate_limited" } };
  if (input.ipHash) {
    const byIp = await sql.query<{ n: number }>(
      `select count(*)::int as n from vubli_topups where ip_hash = $1 and created_at > now() - interval '1 hour'`,
      [input.ipHash],
    );
    if (num(byIp[0]?.n) >= 30) return { status: 429, body: { code: "rate_limited" } };
  }
  const active = await sql.query<{ n: number }>(
    `select count(*)::int as n from vubli_topups
     where user_id = $1 and status = 'pending' and expires_at > now()`,
    [userId],
  );
  if (num(active[0]?.n) >= 3) return { status: 429, body: { code: "rate_limited" } };
  const daily = await sql.query<{ s: string }>(
    `select coalesce(sum(fiat_amount), 0)::text as s from vubli_topups
     where user_id = $1 and status in ('pending','paid') and created_at > now() - interval '1 day'`,
    [userId],
  );
  const spent = toCents(daily[0]?.s) ?? 0n;
  const next = toCents(rubAmount(quoted.rub)) ?? 0n;
  if (spent + next > BigInt(flags.dailyMaxRub) * 100n) return { status: 429, body: { code: "daily_cap" } };

  const id = crypto.randomUUID();
  try {
    await sql.query(
      `insert into vubli_topups (
         id, user_id, provider, network, status, fiat, fiat_amount, tier_id, rate_x1000, rate_version,
         vubli_total, vubli_purchased, vubli_bonus, return_to, expires_at, idem_key, ip_hash
       ) values (
         $1, $2, 'cryptobot', $3, 'pending', 'RUB', $4::numeric, $5, $6, $7,
         $8, $9, $10, $11, now() + interval '30 minutes', $12, $13
       )`,
      [
        id,
        userId,
        flags.network,
        rubAmount(quoted.rub),
        quoted.tierId,
        quoted.perRubX1000,
        quoted.rateVersion,
        quoted.vubliTotal,
        quoted.vubliPurchased,
        quoted.vubliBonus,
        input.returnTo,
        input.idem,
        input.ipHash,
      ],
    );
  } catch (err) {
    const again = await sql.query<TopupDb>(`select ${ROW} from vubli_topups where user_id = $1 and idem_key = $2`, [userId, input.idem]);
    if (again[0]) return present(again[0]);
    throw err;
  }
  const row = await readRow(sql, id);
  if (!row) return { status: 502, body: { code: "provider_unavailable" } };
  return issue(sql, row);
}

export async function settleFromProvider(inv: CryptoInvoice, stale: boolean): Promise<SettleOutcome> {
  const flags = payFlags();
  const view = invoiceView(inv);
  const outcome = await withTransaction((sql) => settleInvoice(sql, flags.network, view, flags.walletSplit));
  if (outcome === "credited" && !stale) {
    const sql = await getSql();
    const rows = await sql.query<{ user_id: string; vubli_total: number }>(
      `select user_id, vubli_total::int as vubli_total from vubli_topups
       where provider = 'cryptobot' and network = $1 and provider_invoice_id = $2::bigint`,
      [flags.network, view.invoiceId],
    );
    const row = rows[0];
    if (row) {
      void import("@/lib/social/push.server")
        .then((mod) =>
          mod.pushNotice(row.user_id, "money", {
            id: `topup:${view.invoiceId}`,
            title: "Вубли начислены",
            body: `+${row.vubli_total} вублей`,
            url: "/c/bank",
          }),
        )
        .catch(() => undefined);
    }
  }
  if (outcome === "mismatch" || outcome === "unknown_invoice") {
    console.error("[pay]", outcome, "invoice", view.invoiceId);
  }
  return stale && outcome === "credited" ? "credited" : outcome;
}

export async function logWebhook(entry: {
  signatureOk: boolean;
  outcome: string;
  invoiceId?: string | null;
  updateId?: number | null;
  updateType?: string | null;
}): Promise<void> {
  const flags = payFlags();
  const sql = await getSql();
  await sql.query(
    `insert into payment_webhook_log (provider, network, provider_invoice_id, update_id, update_type, signature_ok, outcome)
     values ('cryptobot', $1, $2::bigint, $3, $4, $5, $6)`,
    [
      flags.network,
      entry.invoiceId && /^\d+$/.test(entry.invoiceId) ? entry.invoiceId : null,
      entry.updateId ?? null,
      entry.updateType ?? null,
      entry.signatureOk,
      entry.outcome,
    ],
  );
}

export async function readOwnTopup(userId: string, id: string): Promise<TopupResult> {
  if (!UUID.test(id)) return { status: 404, body: { code: "not_found" } };
  const sql = await getSql();
  const owned = await sql.query<{ id: string }>(`select id from vubli_topups where id = $1 and user_id = $2`, [id, userId]);
  if (!owned.length) return { status: 404, body: { code: "not_found" } };
  const claimed = await sql.query<{ provider_invoice_id: string | null }>(
    `update vubli_topups
     set last_checked_at = now()
     where id = $1 and user_id = $2 and status = 'pending' and provider_invoice_id is not null
       and (last_checked_at is null or last_checked_at < now() - interval '5 seconds')
     returning provider_invoice_id::text as provider_invoice_id`,
    [id, userId],
  );
  if (claimed[0]?.provider_invoice_id && payFlags().token) {
    try {
      const [fresh] = await getInvoices([claimed[0].provider_invoice_id]);
      if (fresh) await settleFromProvider(fresh, false);
    } catch (err) {
      console.error("[pay] reconcile", err instanceof Error ? err.name : "error");
    }
  }
  const row = await readRow(sql, id);
  if (!row || row.user_id !== userId) return { status: 404, body: { code: "not_found" } };
  const balance = row.status === "paid" ? await balanceOf(sql, userId) : undefined;
  return { status: 200, body: publicTopup(row, balance) };
}

export async function listOwnTopups(userId: string): Promise<TopupResult> {
  const sql = await getSql();
  const rows = await sql.query<{ id: string; status: string; fiat_amount: string; vubli_total: number; created_at: string }>(
    `select id, status, fiat_amount::text as fiat_amount, vubli_total::int as vubli_total, created_at::text as created_at
     from vubli_topups where user_id = $1 order by created_at desc limit 20`,
    [userId],
  );
  return {
    status: 200,
    body: {
      items: rows.map((row) => ({
        id: row.id,
        status: row.status,
        rub: num(row.fiat_amount),
        vubliTotal: num(row.vubli_total),
        createdAt: row.created_at,
      })),
    },
  };
}

export async function cancelOwnTopup(userId: string, id: string): Promise<TopupResult> {
  if (!UUID.test(id)) return { status: 404, body: { code: "not_found" } };
  const sql = await getSql();
  const rows = await sql.query<TopupDb>(`select ${ROW} from vubli_topups where id = $1 and user_id = $2`, [id, userId]);
  const row = rows[0];
  if (!row) return { status: 404, body: { code: "not_found" } };
  if (row.status === "pending") {
    await sql.query(`update vubli_topups set status = 'canceled', updated_at = now() where id = $1 and status = 'pending'`, [id]);
    if (row.provider_invoice_id && payFlags().token) {
      try {
        await deleteInvoice(row.provider_invoice_id);
      } catch {
        /* a late payment still settles */
      }
    }
  }
  const next = await readRow(sql, id);
  return { status: 200, body: publicTopup(next ?? row) };
}

export async function reconcilePending(): Promise<{ checked: number }> {
  const flags = payFlags();
  if (!flags.token) return { checked: 0 };
  const sql = await getSql();
  const pending = await sql.query<{ provider_invoice_id: string }>(
    `select provider_invoice_id::text as provider_invoice_id
     from vubli_topups
     where status = 'pending' and provider_invoice_id is not null and network = $1
       and created_at > now() - interval '3 days'
     order by created_at asc
     limit 100`,
    [flags.network],
  );
  const ids = pending.map((row) => row.provider_invoice_id).filter(Boolean);
  if (ids.length) {
    const invoices = await getInvoices(ids);
    for (const inv of invoices) {
      try {
        await settleFromProvider(inv, false);
      } catch (err) {
        console.error("[pay] cron invoice", err instanceof Error ? err.name : "error");
      }
    }
  }
  await sql.query(
    `update vubli_topups
     set status = 'failed', updated_at = now()
     where status = 'pending' and provider_invoice_id is null and created_at < now() - interval '15 minutes'`,
  );
  if (new Date().getUTCHours() === 3) {
    try {
      const paid = await getPaidInvoices(100);
      for (const inv of paid) {
        try {
          await settleFromProvider(inv, false);
        } catch (err) {
          console.error("[pay] cron paid", err instanceof Error ? err.name : "error");
        }
      }
    } catch (err) {
      console.error("[pay] cron paid list", err instanceof Error ? err.name : "error");
    }
  }
  const bad = await sql.query<{ n: number }>(
    `select count(*)::int as n from payment_webhook_log
     where signature_ok = false and created_at > now() - interval '1 hour'`,
  );
  if (num(bad[0]?.n) > 5) console.error("[pay] webhook signatures failing");
  const review = await sql.query<{ n: number }>(
    `select count(*)::int as n from vubli_topups where status = 'manual_review' and updated_at > now() - interval '1 day'`,
  );
  if (num(review[0]?.n) > 0) console.error("[pay] topup manual_review", num(review[0]?.n));
  return { checked: ids.length };
}

export function parseCreateBody(value: unknown): { rub: number; returnTo: "shop" | "bank"; idem: string } | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { rub?: unknown; returnTo?: unknown; idempotencyKey?: unknown };
  const rub = typeof raw.rub === "number" ? raw.rub : Number(raw.rub);
  if (!Number.isInteger(rub)) return null;
  const idem = typeof raw.idempotencyKey === "string" ? raw.idempotencyKey.trim() : "";
  if (!UUID.test(idem)) return null;
  const returnTo = raw.returnTo === "bank" ? "bank" : "shop";
  return { rub, returnTo, idem };
}
