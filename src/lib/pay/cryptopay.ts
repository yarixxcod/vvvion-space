import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { payFlags, type PayNetwork } from "./flags.ts";

export class PayError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "PayError";
    this.code = code;
  }
}

export type CryptoInvoice = {
  invoice_id: number;
  hash?: string;
  status?: string;
  currency_type?: string;
  fiat?: string;
  amount?: string | number;
  payload?: string;
  bot_invoice_url?: string;
  mini_app_invoice_url?: string;
  web_app_invoice_url?: string;
  expiration_date?: string;
  paid_at?: string;
  paid_asset?: string;
  paid_amount?: string | number;
  paid_usd_rate?: string | number;
  fee_asset?: string;
  fee_amount?: string | number;
};

export type CreateInvoiceParams = {
  currency_type: "fiat";
  fiat: "RUB";
  amount: string;
  accepted_assets: string;
  description: string;
  payload: string;
  expires_in: number;
  paid_btn_name: "callback";
  paid_btn_url: string;
  allow_comments: false;
  hidden_message: string;
};

type CallOpts = {
  token?: string;
  network?: PayNetwork;
  fetchImpl?: typeof fetch;
};

function baseUrl(network: PayNetwork): string {
  return network === "testnet" ? "https://testnet-pay.crypt.bot/api/" : "https://pay.crypt.bot/api/";
}

function asText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

export function verifySignature(rawBody: string, header: string | null, token: string): boolean {
  if (!header || !token) return false;
  const trimmed = header.trim();
  if (!/^[0-9a-fA-F]+$/.test(trimmed) || trimmed.length % 2 !== 0) return false;
  let got: Buffer;
  try {
    got = Buffer.from(trimmed, "hex");
  } catch {
    return false;
  }
  const key = createHash("sha256").update(token).digest();
  const calc = createHmac("sha256", key).update(rawBody, "utf8").digest();
  if (got.length !== calc.length) return false;
  return timingSafeEqual(got, calc);
}

export function safeEqual(a: string, b: string): boolean {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}

async function call<T>(method: string, params: Record<string, unknown>, opts?: CallOpts): Promise<T> {
  const flags = payFlags();
  const token = opts?.token ?? flags.token;
  if (!token) throw new PayError("not_configured");
  const network = opts?.network ?? flags.network;
  const fetchImpl = opts?.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(baseUrl(network) + method, {
      method: "POST",
      headers: { "Crypto-Pay-API-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new PayError("provider_unavailable");
  }
  const json = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; error?: { name?: string } | string } | null;
  if (!json || json.ok !== true) throw new PayError("provider_error");
  return json.result as T;
}

function listOf(result: CryptoInvoice[] | { items?: CryptoInvoice[] } | null): CryptoInvoice[] {
  if (Array.isArray(result)) return result;
  return Array.isArray(result?.items) ? result.items : [];
}

export function createInvoice(params: CreateInvoiceParams, opts?: CallOpts): Promise<CryptoInvoice> {
  return call<CryptoInvoice>("createInvoice", params, opts);
}

export async function getInvoices(ids: Array<number | string>, opts?: CallOpts): Promise<CryptoInvoice[]> {
  const clean = ids.map((id) => String(id)).filter((id) => /^\d+$/.test(id));
  if (!clean.length) return [];
  const result = await call<CryptoInvoice[] | { items?: CryptoInvoice[] }>(
    "getInvoices",
    { invoice_ids: clean.join(","), count: Math.min(clean.length, 1000) },
    opts,
  );
  return listOf(result);
}

export async function getPaidInvoices(count = 100, opts?: CallOpts): Promise<CryptoInvoice[]> {
  const result = await call<CryptoInvoice[] | { items?: CryptoInvoice[] }>(
    "getInvoices",
    { status: "paid", count: Math.min(count, 1000) },
    opts,
  );
  return listOf(result);
}

export function deleteInvoice(id: number | string, opts?: CallOpts): Promise<boolean> {
  return call<boolean>("deleteInvoice", { invoice_id: id }, opts);
}

export function getMe(opts?: CallOpts): Promise<{ app_id?: number; name?: string }> {
  return call("getMe", {}, opts);
}

export function invoiceView(inv: CryptoInvoice) {
  return {
    invoiceId: String(inv.invoice_id),
    hash: asText(inv.hash),
    payload: asText(inv.payload),
    status: asText(inv.status) ?? "",
    currencyType: asText(inv.currency_type),
    fiat: asText(inv.fiat),
    amount: asText(inv.amount),
    paidAt: asText(inv.paid_at),
    paidAsset: asText(inv.paid_asset),
    paidAmount: asText(inv.paid_amount),
    paidUsdRate: asText(inv.paid_usd_rate),
    feeAsset: asText(inv.fee_asset),
    feeAmount: asText(inv.fee_amount),
  };
}

export function acceptedAssets(network: PayNetwork): string {
  return network === "testnet" ? "USDT,TON,BTC,ETH,LTC,TRX,USDC,JET" : "USDT,TON,BTC,ETH,LTC,TRX,USDC";
}
