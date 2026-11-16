import assert from "node:assert/strict";
import test from "node:test";
import { patchHysteria, patchXray } from "./vpn-apply.mjs";

const shared = "11111111-1111-4111-8111-111111111111";
const personal = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

test("xray keeps foreign clients, swaps managed ones, and drops the shared id only on cut", () => {
  const config = {
    inbounds: [
      {
        protocol: "vless",
        settings: {
          clients: [
            { id: shared, email: "legacy", flow: "xtls-rprx-vision" },
            { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", email: "vvvion:old:account", flow: "xtls-rprx-vision" },
            { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", email: "someone-else" },
          ],
        },
      },
    ],
  };
  const overlap = patchXray(config, {
    dropShared: false,
    shared,
    users: [{ protocol: "vless", secret: personal, email: "vvvion:user:account" }],
  });
  assert.equal(overlap.ok, true);
  const ids = overlap.config.inbounds[0].settings.clients.map((item) => item.id);
  assert.ok(ids.includes(shared));
  assert.ok(ids.includes(personal));
  assert.ok(ids.includes("cccccccc-cccc-4ccc-8ccc-cccccccccccc"));
  assert.equal(ids.includes("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"), false);
  const cut = patchXray(config, {
    dropShared: true,
    shared,
    users: [{ protocol: "vless", secret: personal, email: "vvvion:user:account" }],
  });
  const cutIds = cut.config.inbounds[0].settings.clients.map((item) => item.id);
  assert.equal(cutIds.includes(shared), false);
  assert.ok(cutIds.includes(personal));
  assert.equal(cut.config.inbounds[0].settings.clients.find((item) => item.id === personal).flow, "xtls-rprx-vision");
});

test("xray without a vless inbound is not success", () => {
  const result = patchXray({ inbounds: [{ protocol: "vmess", settings: { clients: [] } }] }, { dropShared: true, shared, users: [] });
  assert.equal(result.ok, false);
});

test("hysteria userpass replaces managed passwords and can remove the shared one", () => {
  const config = { auth: { type: "userpass", userpass: { [shared]: "legacy", old: "vvvion:old:account" } } };
  const cut = patchHysteria(config, {
    dropShared: true,
    shared,
    users: [{ protocol: "hy2", secret: "next-pass", email: "vvvion:user:account" }],
  });
  assert.equal(cut.ok, true);
  assert.equal(cut.config.auth.userpass[shared], undefined);
  assert.equal(cut.config.auth.userpass.old, undefined);
  assert.equal(cut.config.auth.userpass["next-pass"], "vvvion:user:account");
  const single = patchHysteria({ auth: { type: "password", password: "x" } }, { dropShared: true, shared, users: [] });
  assert.equal(single.ok, false);
});
