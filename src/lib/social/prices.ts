import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { assertActive, assertAdmin } from "@/lib/social/access";

const GIFT_SKU = /^gift:[a-z][a-z0-9-]{1,23}$/;
const PERSONA_SKU = /^persona:[a-z0-9-]{1,40}$/;
const CORE = new Set(["premium", "vpn", "mega", "boost", "disk"]);

export type ShopPrice = {
  sku: string;
  title: string;
  note: string;
  section: string;
  price: number;
  enabled: boolean;
};

export async function priceOf(sku: string, fallback: number): Promise<number> {
  const sql = await getSql();
  const rows = await sql<{ price: number }>`
    select price from shop_prices where sku = ${sku} and enabled = true
  `;
  const price = Number(rows[0]?.price);
  if (!Number.isInteger(price) || price < 0 || price > 1_000_000) return fallback;
  return price;
}

export async function loadPrices(): Promise<Map<string, number>> {
  const sql = await getSql();
  const rows = await sql<{ sku: string; price: number }>`
    select sku, price from shop_prices where enabled = true
  `;
  return new Map(rows.map((row) => [row.sku, Number(row.price)]));
}

function cleanTitle(value: unknown, fallback: string): string {
  const title = typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 48) : "";
  return title || fallback;
}

function cleanNote(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 120) : "";
}

function cleanPrice(value: unknown): number {
  const price = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(price) || price < 1 || price > 1_000_000) throw new Error("Цена: целое число от 1 до 1 000 000");
  return price;
}

function knownSku(sku: string): boolean {
  return CORE.has(sku) || GIFT_SKU.test(sku) || PERSONA_SKU.test(sku);
}

export const getShopShelf = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<{ boost: number; disk: number }> => {
    await assertActive(context.userId);
    return { boost: await priceOf("boost", 1000), disk: await priceOf("disk", 1000) };
  });

export async function listPriceRows(): Promise<ShopPrice[]> {
  const sql = await getSql();
  const rows = await sql<ShopPrice>`
    select sku, title, note, section, price, enabled
    from shop_prices
    order by section, price, sku
  `;
  return rows.map((row) => ({ ...row, price: Number(row.price), enabled: Boolean(row.enabled) }));
}

export const listShopPrices = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<ShopPrice[]> => {
    await assertAdmin(context.userId);
    return listPriceRows();
  });

export const saveShopPrice = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Нечего сохранять");
    const raw = input as { sku?: unknown; price?: unknown; title?: unknown; note?: unknown; enabled?: unknown };
    const sku = typeof raw.sku === "string" ? raw.sku.trim() : "";
    if (!knownSku(sku)) throw new Error("Такой позиции нет");
    return {
      sku,
      price: cleanPrice(raw.price),
      title: typeof raw.title === "string" ? cleanTitle(raw.title, "") : undefined,
      note: typeof raw.note === "string" ? cleanNote(raw.note) : undefined,
      enabled: typeof raw.enabled === "boolean" ? raw.enabled : undefined,
    };
  })
  .handler(async ({ context, data }): Promise<ShopPrice[]> => {
    await assertAdmin(context.userId);
    const sql = await getSql();
    const current = await sql<ShopPrice>`select sku, title, note, section, price, enabled from shop_prices where sku = ${data.sku}`;
    const row = current[0];
    if (!row && !data.sku.startsWith("gift:")) throw new Error("Такой позиции нет");
    const title = data.title || row?.title || data.sku;
    const note = data.note ?? row?.note ?? "";
    const section = row?.section ?? "gifts";
    const enabled = data.enabled ?? row?.enabled ?? true;
    await sql`
      insert into shop_prices (sku, title, note, section, price, enabled, updated_at)
      values (${data.sku}, ${title}, ${note}, ${section}, ${data.price}, ${enabled}, now())
      on conflict (sku) do update
        set title = ${title},
            note = ${note},
            price = ${data.price},
            enabled = ${enabled},
            updated_at = now()
    `;
    return listPriceRows();
  });

export const createGiftPrice = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Заполните подарок");
    const raw = input as { slug?: unknown; title?: unknown; note?: unknown; price?: unknown };
    const slug = typeof raw.slug === "string" ? raw.slug.trim().toLowerCase() : "";
    const sku = `gift:${slug}`;
    if (!GIFT_SKU.test(sku)) throw new Error("Код подарка: латиница, от 2 знаков");
    const title = cleanTitle(raw.title, "");
    if (title.length < 2) throw new Error("Напишите название");
    return { sku, title, note: cleanNote(raw.note), price: cleanPrice(raw.price) };
  })
  .handler(async ({ context, data }): Promise<ShopPrice[]> => {
    await assertAdmin(context.userId);
    const sql = await getSql();
    const done = await sql`
      insert into shop_prices (sku, title, note, section, price, enabled, updated_at)
      values (${data.sku}, ${data.title}, ${data.note}, 'gifts', ${data.price}, true, now())
      on conflict (sku) do nothing
      returning sku
    `;
    if (!done.length) throw new Error("Такой подарок уже есть");
    return listPriceRows();
  });
