import test from "node:test";
import assert from "node:assert/strict";
import { connectPlan } from "./connect-plan.ts";
const valid = { host: "connect.example.com", secret: "test-only", sni: "www.microsoft.com" };
test("Reality and existing-certificate HY2 settings are explicit", () => {
  assert.equal(connectPlan(valid).tls, "reality");
  assert.throws(() => connectPlan({ ...valid, protocol: "hy2" }), /сертификату/);
  assert.equal(
    connectPlan({
      ...valid,
      protocol: "hy2",
      certPath: "/etc/tls/cert.pem",
      keyPath: "/etc/tls/key.pem",
    }).protocol,
    "hy2",
  );
});
test("rejects shell metacharacters, invalid ports, ssh collisions and malformed fingerprint", () => {
  for (const patch of [
    { host: "host;id" },
    { port: 22 },
    { port: 10085 },
    { port: 0 },
    { sni: "x; id" },
    { fingerprint: "trust me" },
    { shortId: "abc" },
    { username: "user" },
  ])
    assert.throws(() => connectPlan({ ...valid, ...patch }));
});
