import assert from "node:assert/strict";
import test from "node:test";
import { judgeGuard, type GuardFacts } from "./guard-order.ts";

function facts(patch: Partial<GuardFacts> = {}): GuardFacts {
  return {
    serviceEnabled: true,
    authenticated: true,
    admin: false,
    banned: false,
    suspended: false,
    premium: true,
    minuteCount: 1,
    minuteLimit: 30,
    dailyRequests: null,
    dailyRequestsUsed: 1,
    dailyTokens: null,
    dailyTokensUsed: 0,
    dailyImages: 20,
    dailyImagesUsed: 0,
    imageRequest: false,
    ...patch,
  };
}

test("guard order is disabled, key, ban, premium, then rate limit", () => {
  const disabled = judgeGuard(facts({ serviceEnabled: false }));
  assert.equal(disabled.ok, false);
  if (!disabled.ok) {
    assert.equal(disabled.code, "service_disabled");
    assert.equal(disabled.status, 503);
  }
  assert.equal(judgeGuard(facts({ serviceEnabled: false, admin: true, premium: true })).ok, true);
  const missing = judgeGuard(facts({ authenticated: false }));
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.code, "invalid_api_key");
  const banned = judgeGuard(facts({ banned: true }));
  assert.equal(banned.ok, false);
  if (!banned.ok) assert.equal(banned.code, "account_suspended");
  const suspended = judgeGuard(facts({ suspended: true }));
  assert.equal(suspended.ok, false);
  if (!suspended.ok) assert.equal(suspended.status, 403);
  const premium = judgeGuard(facts({ premium: false }));
  assert.equal(premium.ok, false);
  if (!premium.ok) assert.equal(premium.code, "premium_required");
  const minute = judgeGuard(facts({ minuteCount: 31, minuteLimit: 30 }));
  assert.equal(minute.ok, false);
  if (!minute.ok) assert.equal(minute.code, "rate_limit_exceeded");
  const daily = judgeGuard(facts({ dailyRequests: 2, dailyRequestsUsed: 3 }));
  assert.equal(daily.ok, false);
  if (!daily.ok) assert.equal(daily.retryAfter, 3600);
});

test("a small token overrun is allowed and the next call is not", () => {
  assert.equal(judgeGuard(facts({ dailyTokens: 100, dailyTokensUsed: 90 })).ok, true);
  const blocked = judgeGuard(facts({ dailyTokens: 100, dailyTokensUsed: 100 }));
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.code, "daily_limit_exceeded");
});

test("image calls stop at the daily image cap", () => {
  const images = judgeGuard(facts({ imageRequest: true, dailyImages: 2, dailyImagesUsed: 2 }));
  assert.equal(images.ok, false);
  if (!images.ok) assert.equal(images.code, "daily_limit_exceeded");
  assert.equal(judgeGuard(facts({ imageRequest: false, dailyImages: 2, dailyImagesUsed: 2 })).ok, true);
});
