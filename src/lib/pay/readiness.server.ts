import { getMe, PayError } from "./cryptopay.ts";
import { payFlags } from "./flags.ts";

export type PaymentAvailability = "ready" | "disabled" | "configuration_error" | "unavailable";
let cached: { until: number; result: Promise<PaymentAvailability> } | undefined;

/** Read-only, coalesced health check. No invoices, credentials or application details are exposed. */
export function paymentAvailability(): Promise<PaymentAvailability> {
  const flags = payFlags();
  if (!flags.cryptoEnabled || !flags.payTopup || !flags.token) return Promise.resolve("disabled");
  if (cached && cached.until > Date.now()) return cached.result;
  const result = getMe()
    .then(() => "ready" as const)
    .catch((error: unknown) => {
      const code = error instanceof PayError ? error.providerCode : null;
      const status = error instanceof PayError ? error.httpStatus : null;
      console.error("[pay] getMe", { code, status, network: flags.network });
      return status === 401 ||
        status === 403 ||
        /^(TOKEN_INVALID|UNAUTHORIZED|AUTH_)/.test(code ?? "")
        ? ("configuration_error" as const)
        : ("unavailable" as const);
    });
  cached = { until: Date.now() + 60_000, result };
  return result;
}
