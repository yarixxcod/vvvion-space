import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { cleanFx, parseFx, type FxBoard, type FxCode } from "@/lib/fx/parse";
import { assertActive } from "@/lib/social/access";

const TTL = 6 * 60 * 60 * 1000;

const cache = new Map<string, { at: number; board: FxBoard }>();

async function pull(url: string, base: FxCode): Promise<FxBoard> {
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "vvvion.space" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error("Курсы сейчас не отвечают");
  const text = await response.text();
  if (text.length > 1_500_000 || text.trim().startsWith("<")) throw new Error("Курсы сейчас не отвечают");
  try {
    return parseFx(JSON.parse(text) as unknown, base);
  } catch (err) {
    if (err instanceof Error && err.message === "Курсы сейчас не отвечают") throw err;
    throw new Error("Курсы сейчас не отвечают");
  }
}

async function fetchFx(base: FxCode): Promise<FxBoard> {
  const hit = cache.get(base);
  if (hit && Date.now() - hit.at < TTL) return hit.board;
  const path = `v1/currencies/${base.toLowerCase()}.min.json`;
  const urls = [
    `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/${path}`,
    `https://latest.currency-api.pages.dev/${path}`,
  ];
  for (const url of urls) {
    try {
      const board = await pull(url, base);
      cache.set(base, { at: Date.now(), board });
      return board;
    } catch {
      /* try the fallback host */
    }
  }
  if (hit) return hit.board;
  throw new Error("Курсы сейчас не отвечают");
}

export const loadRates = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = input && typeof input === "object" ? (input as { base?: unknown }).base : input;
    const base = cleanFx(raw);
    if (!base) throw new Error("Выберите валюту");
    return { base };
  })
  .handler(async ({ context, data }): Promise<FxBoard> => {
    await assertActive(context.userId);
    return fetchFx(data.base);
  });
