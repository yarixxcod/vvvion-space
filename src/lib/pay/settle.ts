import { toCents } from "./money.ts";

type Query = <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<T[]>;

export type SqlRunner = { query: Query };

export type SettleOutcome = "credited" | "duplicate" | "ignored" | "unknown_invoice" | "mismatch";

export type ProviderInvoice = {
  invoiceId: string;
  hash: string | null;
  payload: string | null;
  status: string;
  currencyType: string | null;
  fiat: string | null;
  amount: string | null;
  paidAt: string | null;
  paidAsset: string | null;
  paidAmount: string | null;
  paidUsdRate: string | null;
  feeAsset: string | null;
  feeAmount: string | null;
};

type TopupRow = {
  id: string;
  user_id: string;
  status: string;
  fiat: string;
  fiat_amount: string;
  vubli_purchased: number;
  vubli_bonus: number;
  network: string;
  rate_version: string;
  provider_invoice_id: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function redact(inv: ProviderInvoice) {
  return {
    invoice_id: inv.invoiceId,
    status: inv.status,
    currency_type: inv.currencyType,
    fiat: inv.fiat,
    amount: inv.amount,
  };
}

async function creditPart(
  sql: SqlRunner,
  row: TopupRow,
  kind: "topup_cryptobot" | "topup_bonus",
  bucket: "balance" | "purchased" | "earned",
  amount: number,
  idemKey: string,
): Promise<number> {
  if (amount <= 0) return 0;
  const inserted = await sql.query<{ id: string }>(
    `insert into wallet_ledger (id, user_id, kind, bucket, amount, idem_key, ref_type, ref_id, rate_version)
     values ($1, $2, $3, $4, $5, $6, 'topup', $7, $8)
     on conflict (user_id, kind, idem_key) do nothing
     returning id`,
    [crypto.randomUUID(), row.user_id, kind, bucket, amount, idemKey, row.id, row.rate_version],
  );
  return inserted.length ? amount : 0;
}

/**
 * Settle one provider invoice. Caller must hold a DB transaction so FOR UPDATE
 * lasts until commit. Vubles come from the stored row, never from the client.
 */
export async function settleInvoice(
  sql: SqlRunner,
  network: "mainnet" | "testnet",
  inv: ProviderInvoice,
  split: boolean,
): Promise<SettleOutcome> {
  if (!/^\d+$/.test(inv.invoiceId)) return "unknown_invoice";
  const payload = inv.payload && UUID.test(inv.payload) ? inv.payload : "";
  const rows = await sql.query<TopupRow>(
    `select id, user_id, status, fiat, fiat_amount::text as fiat_amount,
            vubli_purchased::int as vubli_purchased, vubli_bonus::int as vubli_bonus,
            network, rate_version, provider_invoice_id::text as provider_invoice_id
     from vubli_topups
     where provider = 'cryptobot' and network = $1
       and (provider_invoice_id = $2::bigint or ($3 <> '' and id = $3))
     order by (provider_invoice_id = $2::bigint) desc
     limit 1
     for update`,
    [network, inv.invoiceId, payload],
  );
  const row = rows[0];
  if (!row) return "unknown_invoice";
  if (row.status === "paid") return "duplicate";
  if (!row.provider_invoice_id) {
    await sql.query(
      `update vubli_topups
       set provider_invoice_id = $2::bigint, provider_hash = coalesce(provider_hash, $3), updated_at = now()
       where id = $1 and provider_invoice_id is null`,
      [row.id, inv.invoiceId, inv.hash],
    );
  }
  if (inv.status === "expired") {
    await sql.query(
      `update vubli_topups set status = 'expired', updated_at = now() where id = $1 and status = 'pending'`,
      [row.id],
    );
    return "ignored";
  }
  if (inv.status !== "paid") return "ignored";
  const fiatOk = inv.currencyType === "fiat" && (inv.fiat ?? "").toUpperCase() === String(row.fiat).toUpperCase();
  const left = toCents(row.fiat_amount);
  const right = toCents(inv.amount);
  const amountOk = left !== null && right !== null && left === right;
  if (!fiatOk || !amountOk) {
    await sql.query(
      `update vubli_topups
       set status = 'manual_review', provider_payload = $2::jsonb, updated_at = now()
       where id = $1`,
      [row.id, JSON.stringify(redact(inv))],
    );
    return "mismatch";
  }
  const key = `cryptobot:${row.network}:${inv.invoiceId}`;
  await sql.query(
    `insert into wallets (user_id, balance, last_grant_at) values ($1, 1000, now()) on conflict (user_id) do nothing`,
    [row.user_id],
  );
  const main = await creditPart(
    sql,
    row,
    "topup_cryptobot",
    split ? "purchased" : "balance",
    Number(row.vubli_purchased),
    key,
  );
  const bonus = await creditPart(
    sql,
    row,
    "topup_bonus",
    split ? "earned" : "balance",
    Number(row.vubli_bonus),
    `${key}:bonus`,
  );
  const added = main + bonus;
  if (added > 0) {
    await sql.query(
      `update wallets
       set balance = balance + $2,
           purchased = purchased + $3,
           earned = earned + $4
       where user_id = $1`,
      [row.user_id, added, split ? main : 0, split ? bonus : 0],
    );
  }
  const paidAt = inv.paidAt && !Number.isNaN(Date.parse(inv.paidAt)) ? inv.paidAt : null;
  await sql.query(
    `update vubli_topups
     set status = 'paid',
         paid_at = coalesce($2::timestamptz, now()),
         paid_asset = $3,
         paid_amount = $4,
         paid_usd_rate = $5,
         fee_asset = $6,
         fee_amount = $7,
         updated_at = now()
     where id = $1 and status <> 'paid'`,
    [row.id, paidAt, inv.paidAsset, inv.paidAmount, inv.paidUsdRate, inv.feeAsset, inv.feeAmount],
  );
  return added > 0 ? "credited" : "duplicate";
}
