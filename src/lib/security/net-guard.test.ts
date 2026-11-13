import assert from "node:assert/strict";
import { test } from "node:test";
import { hostInList, hostMatches, isBlockedHost, isBlockedIp, lookupPublic } from "./net-guard.ts";

test("hostMatches rejects lookalike domains", () => {
  assert.equal(hostMatches("tiktok.com", "tiktok.com"), true);
  assert.equal(hostMatches("vm.tiktok.com", "tiktok.com"), true);
  assert.equal(hostMatches("evil-tiktok.com", "tiktok.com"), false);
  assert.equal(hostMatches("tiktok.com.evil.com", "tiktok.com"), false);
  assert.equal(hostMatches("notinstagram.com", "instagram.com"), false);
  assert.equal(hostInList("m.youtube.com", ["youtube.com", "youtu.be"]), true);
  assert.equal(hostInList("evil.youtube.com.attacker.test", ["youtube.com"]), false);
});

test("isBlockedIp covers private, link-local, mapped and reserved ranges", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.0.5", "172.16.0.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "224.0.0.1", "255.255.255.255", "::1", "::", "fd12::1", "fe80::1", "::ffff:127.0.0.1", "2001:db8::1", "::ffff:169.254.169.254"]) {
    assert.equal(isBlockedIp(ip), true, ip);
  }
  assert.equal(isBlockedIp("8.8.8.8"), false);
  assert.equal(isBlockedIp("1.1.1.1"), false);
  assert.equal(isBlockedHost("localhost"), true);
  assert.equal(isBlockedHost("metadata.google.internal"), true);
  assert.equal(isBlockedHost("api.openai.com"), false);
});

test("lookupPublic rejects a name that resolves to a private address", async () => {
  await assert.rejects(
    lookupPublic("rebind.test", async () => [{ address: "169.254.169.254", family: 4 }]),
    /недоступен/,
  );
  await assert.rejects(
    lookupPublic("dual.test", async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "fd00::1", family: 6 },
    ]),
    /недоступен/,
  );
  const ok = await lookupPublic("8.8.8.8");
  assert.deepEqual(ok, ["8.8.8.8"]);
});
