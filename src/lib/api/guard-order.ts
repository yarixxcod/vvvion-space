/**
 * Порядок отказа: 503 (сервис выключен и это не админ) → 401 → 403 бан →
 * 403 Premium → 429. Админ проходит выключенный сервис, но не бан и не отсутствие Premium.
 * Суточный лимит токенов сравнивается с уже записанной суммой: текущий ответ
 * может немного её перешагнуть, следующий запрос после этого уже получит 429.
 */
export type GuardFacts = {
  serviceEnabled: boolean;
  authenticated: boolean;
  admin: boolean;
  banned: boolean;
  suspended: boolean;
  premium: boolean;
  minuteCount: number;
  minuteLimit: number;
  dailyRequests: number | null;
  dailyRequestsUsed: number;
  dailyTokens: number | null;
  dailyTokensUsed: number;
  dailyImages: number | null;
  dailyImagesUsed: number;
  imageRequest: boolean;
};

export type GuardVerdict =
  | { ok: true; minuteLimit: number; minuteRemaining: number }
  | { ok: false; status: number; code: string; retryAfter?: number };

export function judgeGuard(facts: GuardFacts): GuardVerdict {
  if (!facts.serviceEnabled && !facts.admin) {
    return { ok: false, status: 503, code: "service_disabled" };
  }
  if (!facts.authenticated) return { ok: false, status: 401, code: "invalid_api_key" };
  if (facts.banned || facts.suspended) return { ok: false, status: 403, code: "account_suspended" };
  if (!facts.premium) return { ok: false, status: 403, code: "premium_required" };
  if (facts.minuteCount > facts.minuteLimit) {
    return { ok: false, status: 429, code: "rate_limit_exceeded", retryAfter: 60 };
  }
  if (facts.dailyRequests != null && facts.dailyRequestsUsed > facts.dailyRequests) {
    return { ok: false, status: 429, code: "daily_limit_exceeded", retryAfter: 3600 };
  }
  if (facts.dailyTokens != null && facts.dailyTokensUsed >= facts.dailyTokens) {
    return { ok: false, status: 429, code: "daily_limit_exceeded", retryAfter: 3600 };
  }
  if (facts.imageRequest && facts.dailyImages != null && facts.dailyImagesUsed + 1 > facts.dailyImages) {
    return { ok: false, status: 429, code: "daily_limit_exceeded", retryAfter: 3600 };
  }
  return {
    ok: true,
    minuteLimit: facts.minuteLimit,
    minuteRemaining: Math.max(0, facts.minuteLimit - facts.minuteCount),
  };
}
