import assert from "node:assert/strict";
import test from "node:test";
import { canCreateKey, generateKey, hashKey, KEY_RE, presentedKey, toPublicKey } from "./keys.ts";
import { invalidKeyBody } from "./errors.ts";

test("api keys have the branded format and unique hashes", () => {
  const minted = new Set<string>();
  for (let i = 0; i < 30; i += 1) {
    const row = generateKey();
    assert.match(row.key, KEY_RE);
    assert.equal(row.hash, hashKey(row.key));
    assert.equal(row.prefix, row.key.slice(0, 14));
    assert.equal(row.last4, row.key.slice(-4));
    assert.equal(row.prefix.length, 14);
    minted.add(row.hash);
  }
  assert.equal(minted.size, 30);
});

test("a listed key never contains the secret", () => {
  const secret = generateKey();
  const view = toPublicKey({
    id: "key-1",
    name: "home",
    prefix: secret.prefix,
    last4: secret.last4,
    createdAt: "2026-01-01",
    revoked: false,
    requests24h: 2,
    key: secret.key,
    key_hash: secret.hash,
  });
  const json = JSON.stringify(view);
  assert.equal(json.includes(secret.key), false);
  assert.equal(json.includes(secret.hash), false);
  assert.equal("key" in view, false);
  assert.equal("key_hash" in view, false);
});

test("the sixth active key is rejected and creation is rate limited", () => {
  assert.equal(canCreateKey({ active: 5, createdLastHour: 0, maxKeys: 5 }), "too_many_active");
  assert.equal(canCreateKey({ active: 4, createdLastHour: 10, maxKeys: 5 }), "too_many_recent");
  assert.equal(canCreateKey({ active: 9, createdLastHour: 0, maxKeys: 0 }), "ok");
});

test("missing, malformed and cookie-only credentials are the same absent key", () => {
  assert.equal(presentedKey(new Headers()), null);
  assert.equal(presentedKey(new Headers({ cookie: "better-auth.session_token=abc" })), null);
  assert.equal(presentedKey(new Headers({ authorization: "Bearer not-a-key" })), null);
  assert.equal(presentedKey(new Headers({ "x-api-key": "vvvion-sk-short" })), null);
  const key = generateKey().key;
  assert.equal(presentedKey(new Headers({ authorization: `Bearer ${key}`, cookie: "session=1" })), key);
  assert.equal(presentedKey(new Headers({ "x-api-key": key })), key);
  assert.deepEqual(invalidKeyBody(), invalidKeyBody());
});
