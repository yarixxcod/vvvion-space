import { getSql } from "@/lib/db";
import { isUniqueViolation } from "@/lib/social/sql-error";
import { purchaseLimitBoost } from "@/lib/social/bank";
import { purchaseDiskSpace } from "@/lib/social/disk.fn";
import { purchaseMega } from "@/lib/social/mega";
import { PERSONAS } from "@/lib/social/persona-data";
import { purchasePersona } from "@/lib/social/personas";
import { PREMIUM_DAYS, PREMIUM_PRICE, purchasePremium } from "@/lib/social/premium";
import { MEGA_PRICE } from "@/lib/social/mega-plan";
import { VPN_PRICE, purchaseVpn } from "@/lib/social/vpn";
import { DISK_COST } from "@/lib/social/disk";
import { loadPrices, priceOf } from "@/lib/social/prices";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Sku =
  | { sku: string; kind: "premium" | "vpn" | "mega" | "boost" | "disk"; price: number; ledger: string }
  | { sku: string; kind: "persona"; price: number; ledger: string; persona: string };

async function parseSku(sku: string): Promise<Sku | null> {
  if (sku === "premium") return { sku, kind: "premium", price: await priceOf("premium", PREMIUM_PRICE), ledger: "shop_premium" };
  if (sku === "vpn") return { sku, kind: "vpn", price: await priceOf("vpn", VPN_PRICE), ledger: "shop_vpn" };
  if (sku === "mega") return { sku, kind: "mega", price: await priceOf("mega", MEGA_PRICE), ledger: "shop_mega" };
  if (sku === "boost") return { sku, kind: "boost", price: await priceOf("boost", 1000), ledger: "shop_boost" };
  if (sku === "disk") return { sku, kind: "disk", price: await priceOf("disk", DISK_COST), ledger: "shop_disk" };
  if (sku.startsWith("persona:")) {
    const id = sku.slice("persona:".length);
    const persona = PERSONAS.find((item) => item.id === id);
    if (!persona) return null;
    return { sku, kind: "persona", price: await priceOf(sku, persona.price), ledger: "shop_persona", persona: id };
  }
  return null;
}

function httpError(err: unknown): { status: number; body: Record<string, unknown> } {
  const message = err instanceof Error ? err.message : "Покупка не прошла";
  if (/почт/i.test(message)) return { status: 403, body: { code: "email_not_verified", message } };
  if (/уже куплен/i.test(message)) return { status: 409, body: { code: "already", message } };
  if (/Нужно|не хватает|вубл/i.test(message)) return { status: 402, body: { code: "insufficient", message } };
  return { status: 400, body: { code: "purchase_failed", message } };
}

async function sideEffect(userId: string, sku: Sku, idem: string): Promise<boolean> {
  const sql = await getSql();
  if (sku.kind === "boost") {
    const rows = await sql.query(`select id from limit_boosts where id = $1 and user_id = $2`, [`boost-${idem}`, userId]);
    return rows.length > 0;
  }
  const transfer =
    sku.kind === "premium"
      ? `prem-${idem}`
      : sku.kind === "vpn"
        ? `vpn-${idem}`
        : sku.kind === "mega"
          ? `mega-${idem}`
          : sku.kind === "disk"
            ? `disk-${idem}`
            : `persona-${idem}`;
  const rows = await sql.query(`select id from wallet_transfers where id = $1 and from_id = $2`, [transfer, userId]);
  return rows.length > 0;
}

async function perform(userId: string, sku: Sku, idem: string): Promise<void> {
  if (sku.kind === "persona") {
    await purchasePersona(userId, sku.persona, idem);
    return;
  }
  if (sku.kind === "premium") await purchasePremium(userId, idem);
  else if (sku.kind === "vpn") await purchaseVpn(userId, idem);
  else if (sku.kind === "mega") await purchaseMega(userId, idem);
  else if (sku.kind === "boost") await purchaseLimitBoost(userId, idem);
  else await purchaseDiskSpace(userId, idem);
}

async function remember(userId: string, sku: Sku, idem: string): Promise<void> {
  const sql = await getSql();
  await sql.query(
    `insert into wallet_ledger (id, user_id, kind, bucket, amount, idem_key, ref_type, ref_id)
     values ($1, $2, $3, 'balance', $4, $5, 'sku', $6)
     on conflict (user_id, kind, idem_key) do nothing`,
    [crypto.randomUUID(), userId, sku.ledger, -sku.price, idem, sku.sku],
  );
}

async function balanceOf(userId: string): Promise<number> {
  const sql = await getSql();
  const rows = await sql.query<{ balance: number }>(`select balance::int as balance from wallets where user_id = $1`, [userId]);
  return Number(rows[0]?.balance ?? 0);
}

export async function purchaseSku(userId: string, skuRaw: string, idem: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const sku = await parseSku(skuRaw);
  if (!sku || !UUID.test(idem)) return { status: 400, body: { code: "bad_sku", message: "Такого товара нет" } };
  const sql = await getSql();
  const existing = await sql.query<{ sku: string; status: string; created_at: string }>(
    `select sku, status, created_at::text as created_at from shop_orders where user_id = $1 and idem_key = $2`,
    [userId, idem],
  );
  const hit = existing[0];
  if (hit && hit.sku !== sku.sku) return { status: 409, body: { code: "idempotency_conflict", message: "Этот ключ уже использован" } };
  if (hit?.status === "done" || (hit && (await sideEffect(userId, sku, idem)))) {
    if (hit && hit.status !== "done") {
      await sql.query(`update shop_orders set status = 'done', result = $3::jsonb where user_id = $1 and idem_key = $2`, [
        userId,
        idem,
        JSON.stringify({ ok: true, sku: sku.sku }),
      ]);
    }
    return { status: 200, body: { ok: true, sku: sku.sku, balance: await balanceOf(userId), replay: true } };
  }
  if (hit?.status === "pending") {
    const age = Date.now() - Date.parse(hit.created_at);
    if (Number.isFinite(age) && age < 20_000) {
      return { status: 409, body: { code: "in_progress", message: "Покупка ещё обрабатывается" } };
    }
    await sql.query(`delete from shop_orders where user_id = $1 and idem_key = $2 and status = 'pending'`, [userId, idem]);
  }
  const orderId = crypto.randomUUID();
  try {
    await sql.query(
      `insert into shop_orders (id, user_id, sku, idem_key, status) values ($1, $2, $3, $4, 'pending')`,
      [orderId, userId, sku.sku, idem],
    );
  } catch (err) {
    if (isUniqueViolation(err)) return { status: 409, body: { code: "in_progress", message: "Покупка ещё обрабатывается" } };
    throw err;
  }
  try {
    await perform(userId, sku, idem);
    await remember(userId, sku, idem).catch((err) => {
      console.error("[shop] ledger", err instanceof Error ? err.name : "error");
    });
    await sql.query(`update shop_orders set status = 'done', result = $3::jsonb where user_id = $1 and idem_key = $2`, [
      userId,
      idem,
      JSON.stringify({ ok: true, sku: sku.sku }),
    ]);
    return { status: 200, body: { ok: true, sku: sku.sku, balance: await balanceOf(userId) } };
  } catch (err) {
    await sql.query(`delete from shop_orders where user_id = $1 and idem_key = $2 and status = 'pending'`, [userId, idem]).catch(() => undefined);
    return httpError(err);
  }
}

export async function shopCatalog() {
  const prices = await loadPrices();
  const cost = (sku: string, fallback: number) => prices.get(sku) ?? fallback;
  return {
    items: [
      { sku: "premium", title: "Premium", price: cost("premium", PREMIUM_PRICE), section: "subs", note: `${PREMIUM_DAYS} дней` },
      { sku: "vpn", title: "VPN", price: cost("vpn", VPN_PRICE), section: "subs", note: "30 дней" },
      { sku: "mega", title: "Мегадиск", price: cost("mega", MEGA_PRICE), section: "storage", note: "2 ГБ, 30 дней" },
      { sku: "boost", title: "Сутки подлиннее", price: cost("boost", 1000), section: "ai", note: "+100 запросов на 24 часа" },
      { sku: "disk", title: "Место на диске", price: cost("disk", DISK_COST), section: "storage", note: "+100 МБ" },
      ...PERSONAS.map((persona) => ({
        sku: `persona:${persona.id}`,
        title: persona.name,
        price: cost(`persona:${persona.id}`, persona.price),
        section: "look",
        note: persona.role,
      })),
    ],
  };
}
