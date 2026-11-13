import assert from "node:assert/strict";
import { test } from "node:test";
import { hostFingerprint, hostKeyMatches } from "./mega-host-key.ts";

test("ssh fingerprint is stable and a different key does not match", () => {
  const key = Buffer.from("vvvion-host-key");
  const other = Buffer.from("other-host-key");
  const fingerprint = hostFingerprint(key);
  assert.match(fingerprint, /^SHA256:[A-Za-z0-9+/]+$/);
  assert.equal(hostKeyMatches(fingerprint, key), true);
  assert.equal(hostKeyMatches(fingerprint, other), false);
  assert.equal(hostKeyMatches("", key), false);
});
