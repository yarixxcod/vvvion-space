import { payFlags } from "./flags.ts";

export const RATE_VERSION = "2026-11-v1";
export const BASE_VUB_PER_RUB = 10;

export type Tier = {
  id: "xs" | "s" | "m" | "l" | "xl";
  fromRub: number;
  perRubX1000: number;
  label: string | null;
};

export const TIERS: readonly Tier[] = [
  { id: "xs", fromRub: 0, perRubX1000: 9600, label: "малый платёж −4 %" },
  { id: "s", fromRub: 100, perRubX1000: 9800, label: "малый платёж −2 %" },
  { id: "m", fromRub: 500, perRubX1000: 10000, label: null },
  { id: "l", fromRub: 2000, perRubX1000: 10200, label: "+2 % бонус" },
  { id: "xl", fromRub: 5000, perRubX1000: 10400, label: "+4 % бонус" },
];

export const PRESETS_RUB = [50, 100, 300, 500, 1000, 2500, 5000, 10000] as const;

export class TopupError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "TopupError";
    this.code = code;
  }
}

export function tierFor(rub: number): Tier {
  let tier: Tier = TIERS[0];
  for (const item of TIERS) if (rub >= item.fromRub) tier = item;
  return tier;
}

export type Quote = {
  rub: number;
  tierId: Tier["id"];
  perRubX1000: number;
  rateVersion: string;
  vubliTotal: number;
  vubliPurchased: number;
  vubliBonus: number;
  bonusPct: number;
  label: string | null;
};

export function quote(rub: number): Quote {
  const { minRub, maxRub } = payFlags();
  if (!Number.isInteger(rub) || rub < minRub || rub > maxRub) throw new TopupError("amount_out_of_range");
  const tier = tierFor(rub);
  const total = Math.floor((rub * tier.perRubX1000) / 1000);
  const base = rub * BASE_VUB_PER_RUB;
  const purchased = Math.min(total, base);
  return {
    rub,
    tierId: tier.id,
    perRubX1000: tier.perRubX1000,
    rateVersion: RATE_VERSION,
    vubliTotal: total,
    vubliPurchased: purchased,
    vubliBonus: total - purchased,
    bonusPct: Math.round((tier.perRubX1000 / 10000 - 1) * 1000) / 10,
    label: tier.label,
  };
}

/** Smallest whole-ruble payment that yields at least needVub. */
export function minRubForVub(needVub: number): number {
  const { minRub, maxRub } = payFlags();
  if (!Number.isFinite(needVub) || needVub <= 0) return minRub;
  if (quote(maxRub).vubliTotal < needVub) return maxRub;
  let lo = minRub;
  let hi = maxRub;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (quote(mid).vubliTotal >= needVub) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

export function packagesBody() {
  const { minRub, maxRub } = payFlags();
  return {
    baseVubPerRub: BASE_VUB_PER_RUB,
    currency: "RUB" as const,
    rateVersion: RATE_VERSION,
    minRub,
    maxRub,
    tiers: TIERS.map((tier) => ({
      id: tier.id,
      fromRub: tier.fromRub,
      vubPerRub: tier.perRubX1000 / 1000,
      bonusPct: Math.round((tier.perRubX1000 / 10000 - 1) * 1000) / 10,
      label: tier.label,
    })),
    presets: PRESETS_RUB.filter((rub) => rub >= minRub && rub <= maxRub).map((rub) => {
      const row = quote(rub);
      return {
        rub,
        vubli: row.vubliTotal,
        bonusPct: row.bonusPct,
        label: row.label,
        ...(rub === 5000 ? { popular: true as const } : {}),
      };
    }),
  };
}
