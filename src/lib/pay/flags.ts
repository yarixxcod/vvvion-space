export type PayNetwork = "mainnet" | "testnet";

function on(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return fallback;
  return n;
}

/** Server-only payment flags. Defaults stay off so a deploy cannot charge anyone. */
export function payFlags() {
  const currencies = (process.env.PAY_CURRENCIES?.trim() || "RUB")
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
  return {
    cryptoEnabled: on("CRYPTOPAY_ENABLED"),
    payTopup: on("PAY_TOPUP"),
    shopV2: on("SHOP_V2"),
    walletSplit: on("WALLET_SPLIT"),
    aiPayg: on("AI_PAYG"),
    network: (process.env.CRYPTOPAY_NETWORK?.trim() === "testnet" ? "testnet" : "mainnet") as PayNetwork,
    token: process.env.CRYPTOPAY_TOKEN?.trim() || "",
    webhookSecret: process.env.CRYPTOPAY_WEBHOOK_SECRET?.trim() || "",
    cronSecret: process.env.CRON_SECRET?.trim() || process.env.PUSH_CRON_SECRET?.trim() || "",
    minRub: intEnv("TOPUP_MIN_RUB", 50),
    maxRub: intEnv("TOPUP_MAX_RUB", 50000),
    dailyMaxRub: intEnv("TOPUP_DAILY_MAX_RUB", 100000),
    requireVerified: (() => {
      const v = process.env.TOPUP_REQUIRE_VERIFIED?.trim().toLowerCase();
      if (!v) return true;
      return !(v === "0" || v === "false" || v === "no" || v === "off");
    })(),
    currencies: currencies.length ? currencies : ["RUB"],
  };
}

let warned = false;

export function warnIfPayMisconfigured(): void {
  const flags = payFlags();
  if ((flags.cryptoEnabled || flags.payTopup) && !flags.token && !warned) {
    warned = true;
    console.error("[pay] CRYPTOPAY_TOKEN не задан");
  }
}
