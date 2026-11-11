export const FX_CODES = ["USD", "EUR", "RUB", "KZT", "UZS", "KGS", "BYN"] as const;

export type FxCode = (typeof FX_CODES)[number];

export type FxQuote = {
  code: FxCode;
  perBase: number;
};

export type FxBoard = {
  date: string;
  base: FxCode;
  quotes: FxQuote[];
};

const CODES = new Set<string>(FX_CODES);

export function cleanFx(value: unknown): FxCode | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return CODES.has(code) ? (code as FxCode) : null;
}

export function parseFx(payload: unknown, base: FxCode): FxBoard {
  if (!payload || typeof payload !== "object") throw new Error("Курсы сейчас не отвечают");
  const row = payload as Record<string, unknown>;
  const date = typeof row.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.date) ? row.date : "";
  const table = row[base.toLowerCase()];
  if (!table || typeof table !== "object") throw new Error("Курсы сейчас не отвечают");
  const quotes: FxQuote[] = [];
  for (const code of FX_CODES) {
    if (code === base) continue;
    const raw = (table as Record<string, unknown>)[code.toLowerCase()];
    const perBase = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
    if (!Number.isFinite(perBase) || perBase <= 0 || perBase > 1e12) continue;
    quotes.push({ code, perBase });
  }
  if (!quotes.length) throw new Error("Курсы сейчас не отвечают");
  return { date, base, quotes };
}
