import test from "node:test";
import assert from "node:assert/strict";
import { connectNodeToken, verifyConnectToken } from "./connect-token.server.ts";
test("per-node tokens cannot authenticate as a different VPS; legacy agents remain supported", () => {
  const old = process.env.VPN_AGENT_TOKEN;
  process.env.VPN_AGENT_TOKEN = "unit-test-master";
  try {
    const token = connectNodeToken("node-a");
    assert.equal(verifyConnectToken("Bearer " + token, "node-a"), true);
    assert.equal(verifyConnectToken("Bearer " + token, "node-b"), false);
    assert.equal(verifyConnectToken("Bearer unit-test-master", "node-b"), true);
    assert.equal(verifyConnectToken("Bearer wrong", "node-a"), false);
  } finally {
    if (old === undefined) delete process.env.VPN_AGENT_TOKEN;
    else process.env.VPN_AGENT_TOKEN = old;
  }
});
