import assert from "node:assert/strict";
import test from "node:test";
import {
  accessOf,
  accountedBytes,
  afterAgent,
  billingStep,
  clientsToInstall,
  concurrentCharges,
  counterDelta,
  daysLeft,
  deviceRoom,
  expiryReminder,
  keyEmail,
  nextBaseline,
  nextUntil,
  noticeAnchor,
  openSlots,
  personalUri,
  pullLimit,
  purchaseOutcome,
  recovery,
  sharedCredential,
  subscriptionInfo,
  syncState,
  tokenRejected,
  trafficReminder,
  usedBytes,
} from "./vpn-core.ts";

const NOW = Date.parse("2026-11-16T12:00:00Z");
const DAY = 86_400_000;
const VLESS = "vless://11111111-1111-4111-8111-111111111111@vpn.example:443?type=tcp";

test("a live pass is open and an expired one is closed", () => {
  assert.equal(accessOf({ found: true, untilMs: NOW + DAY, now: NOW, blocked: false, used: null, quota: 100 }), "ok");
  assert.equal(accessOf({ found: true, untilMs: NOW - 1, now: NOW, blocked: false, used: null, quota: 100 }), "expired");
  assert.equal(accessOf({ found: true, untilMs: NOW + DAY, now: NOW, blocked: true, used: null, quota: 100 }), "blocked");
  assert.equal(accessOf({ found: false, untilMs: NOW + DAY, now: NOW, blocked: false, used: null, quota: 100 }), "missing");
});

test("unknown traffic is not reported as zero", () => {
  assert.equal(usedBytes(null), null);
  assert.equal(subscriptionInfo(null, 100, 50), "total=100; expire=50");
  assert.equal(subscriptionInfo({ upload: 2, download: 3 }, 100, 50), "upload=2; download=3; total=100; expire=50");
  assert.equal(accessOf({ found: true, untilMs: NOW + DAY, now: NOW, blocked: false, used: null, quota: 10 }), "ok");
  assert.equal(accessOf({ found: true, untilMs: NOW + DAY, now: NOW, blocked: false, used: 10, quota: 10 }), "quota");
});

test("an enrolled node gets a private id and a shared node stays shared", () => {
  const shared = personalUri(VLESS, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "Алматы", false);
  assert.equal(shared?.shared, true);
  assert.match(shared?.uri ?? "", /11111111-1111-4111-8111-111111111111/);
  const mine = personalUri(VLESS, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "Алматы", true);
  assert.equal(mine?.shared, false);
  assert.match(mine?.uri ?? "", /^vless:\/\/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa@/);
  assert.match(mine?.uri ?? "", /#%D0%90%D0%BB%D0%BC%D0%B0%D1%82%D1%8B$/);
  const hy = personalUri("hy2://old-pass@vpn.example:443", "next-pass", "Астана", true);
  assert.match(hy?.uri ?? "", /^hy2:\/\/next-pass@/);
  assert.equal(personalUri("https://nope", "secret", "X", true), null);
});

test("billing does not charge twice and repairs a pass that was not opened", () => {
  assert.equal(billingStep({ balance: 100, price: 2000, charged: false, pass: false }), "short");
  assert.equal(billingStep({ balance: 5000, price: 2000, charged: false, pass: false }), "charge");
  assert.equal(billingStep({ balance: 0, price: 2000, charged: true, pass: true }), "idempotent");
  assert.equal(billingStep({ balance: 0, price: 2000, charged: true, pass: false }), "repair");
  assert.equal(purchaseOutcome({ balance: 5000, price: 2000, transferExists: false, passExists: false }), "charge");
  assert.equal(purchaseOutcome({ balance: 100, price: 2000, transferExists: false, passExists: false }), "short");
  assert.equal(purchaseOutcome({ balance: 0, price: 2000, transferExists: true, passExists: true }), "idempotent");
  assert.equal(purchaseOutcome({ balance: 0, price: 2000, transferExists: true, passExists: false }), "repair");
});

test("first purchase, renewal and expiry move the end date without stacking a lapsed term", () => {
  assert.equal(nextUntil(NOW, null, 30), NOW + 30 * DAY);
  assert.equal(nextUntil(NOW, NOW + 10 * DAY, 30), NOW + 40 * DAY);
  assert.equal(nextUntil(NOW, NOW - 5 * DAY, 30), NOW + 30 * DAY);
});

test("the same purchase key cannot charge twice and a second purchase needs funds", () => {
  assert.equal(concurrentCharges({ balance: 2000, price: 2000, sameKey: true }), 1);
  assert.equal(concurrentCharges({ balance: 4000, price: 2000, sameKey: true }), 1);
  assert.equal(concurrentCharges({ balance: 4000, price: 2000, sameKey: false }), 2);
  assert.equal(concurrentCharges({ balance: 2000, price: 2000, sameKey: false }), 1);
  assert.equal(concurrentCharges({ balance: 100, price: 2000, sameKey: false }), 0);
});

test("tokens, devices, reminders and quota warnings stay bounded", () => {
  assert.equal(pullLimit(39), "ok");
  assert.equal(pullLimit(40), "limited");
  assert.equal(deviceRoom(2, 3), true);
  assert.equal(deviceRoom(3, 3), false);
  assert.equal(expiryReminder(NOW, NOW + 6.5 * DAY), "7d");
  assert.equal(expiryReminder(NOW, NOW + 2.5 * DAY), "3d");
  assert.equal(expiryReminder(NOW, NOW + 0.5 * DAY), "1d");
  assert.equal(expiryReminder(NOW, NOW - 1000), "expired");
  assert.equal(expiryReminder(NOW, NOW + 10 * DAY), null);
  assert.equal(trafficReminder(null, 100), null);
  assert.equal(trafficReminder(80, 100), "traffic80");
  assert.equal(trafficReminder(95, 100), "traffic95");
  assert.equal(daysLeft(NOW, NOW + 2.1 * DAY), 3);
  assert.equal(daysLeft(NOW, NOW - 1), 0);
  assert.deepEqual(openSlots(["d1", "d2", "d3", "d4"], 3), ["", "d1", "d2", "d3"]);
  assert.equal(noticeAnchor("vpn:traffic95", "2026-11-01"), noticeAnchor("vpn:traffic95", "2026-11-01"));
  assert.notEqual(noticeAnchor("vpn:traffic80", "2026-11-01"), noticeAnchor("vpn:traffic95", "2026-11-01"));
});

test("a rotated token and a rotated key stop matching the previous secret", () => {
  const first = personalUri(VLESS, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "Алматы", true);
  const next = personalUri(VLESS, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "Алматы", true);
  assert.equal(tokenRejected(first?.uri ?? "", next?.uri ?? ""), true);
  assert.equal(tokenRejected("old-link-token-value", "new-link-token-value"), true);
  assert.equal(clientsToInstall({ secrets: ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"], dropShared: true, shared: "11111111-1111-4111-8111-111111111111" }).secrets.includes("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), false);
});

test("traffic is counted from the baseline and a restarted counter keeps what was already used", () => {
  assert.equal(counterDelta(null, 500), 0);
  assert.equal(counterDelta(500, 800), 300);
  assert.equal(counterDelta(800, 50), 0);
  const base = nextBaseline(null, null, 500);
  assert.equal(base, 500);
  assert.equal(accountedBytes(800, base, 20, 20), 300);
  const restarted = nextBaseline(800, base, 50);
  assert.equal(accountedBytes(50, restarted, 20, 20), 300);
});

test("http reachability is not a live VPN session and a failed apply does not enroll the node", () => {
  assert.deepEqual(afterAgent({ wasEnrolled: false, event: "http" }), { enrolled: false, reach: "unknown" });
  assert.deepEqual(afterAgent({ wasEnrolled: false, event: "seen" }), { enrolled: false, reach: "unknown" });
  assert.deepEqual(afterAgent({ wasEnrolled: false, event: "applied" }), { enrolled: true, reach: "up" });
  assert.deepEqual(afterAgent({ wasEnrolled: true, event: "apply-failed" }), { enrolled: true, reach: "down" });
  assert.deepEqual(afterAgent({ wasEnrolled: false, event: "down" }), { enrolled: false, reach: "down" });
  assert.equal(syncState({ applyError: "reload failed", retryApplied: false }), "error");
  assert.equal(syncState({ applyError: "reload failed", retryApplied: true }), "ok");
});

test("a shared key stays only until the cut, and blocked or expired users are not installed", () => {
  const shared = sharedCredential(VLESS);
  assert.equal(shared?.secret, "11111111-1111-4111-8111-111111111111");
  const overlap = clientsToInstall({ secrets: ["personal"], dropShared: false, shared: shared?.secret ?? null });
  assert.equal(overlap.sharedKept, true);
  const cut = clientsToInstall({ secrets: ["personal"], dropShared: true, shared: shared?.secret ?? null });
  assert.equal(cut.sharedKept, false);
  assert.deepEqual(cut.secrets, ["personal"]);
  assert.equal(accessOf({ found: true, untilMs: NOW - 1, now: NOW, blocked: false, used: 0, quota: 100 }), "expired");
  assert.equal(keyEmail("user_1", ""), "vvvion:user_1:account");
  assert.equal(keyEmail("user_1", "device-1"), "vvvion:user_1:device-1");
});

test("a charge without a pass is repaired and a silent VPS is not called connected", () => {
  assert.equal(recovery({ charged: true, pass: false, agentApplied: false, vpsReachable: true }), "repair-pass");
  assert.equal(recovery({ charged: true, pass: true, agentApplied: false, vpsReachable: false }), "vps-down");
  assert.equal(recovery({ charged: true, pass: true, agentApplied: false, vpsReachable: true }), "wait-agent");
  assert.equal(recovery({ charged: true, pass: true, agentApplied: true, vpsReachable: true }), "ok");
  assert.equal(recovery({ charged: false, pass: false, agentApplied: true, vpsReachable: true }), "needs-purchase");
});
