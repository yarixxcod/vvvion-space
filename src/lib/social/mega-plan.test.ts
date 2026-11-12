import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_SOURCE,
  agentPortOk,
  diskNameOk,
  entryName,
  hostOk,
  installShell,
  MEGA_CHUNK,
  pickNode,
  puttyScript,
  siblingName,
  siteOrigin,
  sshPortOk,
} from "./mega-plan.ts";

test("agent port stays off 443 and 8443", () => {
  assert.equal(agentPortOk(8742), true);
  assert.equal(agentPortOk(443), false);
  assert.equal(agentPortOk(8443), false);
  assert.equal(agentPortOk(22), false);
  assert.equal(agentPortOk(80), false);
  assert.equal(sshPortOk(22), true);
  assert.equal(sshPortOk(443), false);
  assert.equal(sshPortOk(8443), false);
});

test("names and hosts", () => {
  assert.equal(diskNameOk("disk-1"), true);
  assert.equal(diskNameOk("Disk"), false);
  assert.equal(hostOk("203.0.113.10"), true);
  assert.equal(hostOk("203.0.113.256"), false);
  assert.equal(hostOk("http://203.0.113.10"), false);
  assert.equal(entryName("  Отчёт 2026.pdf "), "Отчёт 2026.pdf");
  assert.equal(siblingName("photo.png", new Set(["photo.png"])), "photo (1).png");
  assert.equal(siblingName("photo.png", new Set(["photo.png", "photo (1).png"])), "photo (2).png");
  assert.ok(MEGA_CHUNK <= 1_800_000);
  assert.ok(MEGA_CHUNK >= 1024 * 1024);
  assert.ok(MEGA_CHUNK < 2_000_000);
});

test("putty script calls the site once and stays off 443", () => {
  const ticket = "ab".repeat(24);
  const script = puttyScript("https://vvvion.space/c/admin", ticket);
  assert.equal(siteOrigin("https://vvvion.space/c/admin"), "https://vvvion.space");
  assert.match(script, /\$SITE\/api\/mega\/join\?ticket=\$TICKET/);
  assert.match(script, new RegExp(ticket));
  assert.match(script, /ufw allow "\$PORT"\/tcp/);
  assert.equal(script.includes(":443"), false);
  assert.equal(script.includes("8443"), false);
  assert.throws(() => puttyScript("notaurl", ticket), /Адрес сайта/);
});

test("least loaded disk wins", () => {
  const id = pickNode([
    { id: "b", used: 20, ready: true },
    { id: "a", used: 5, ready: true },
    { id: "c", used: 1, ready: false },
  ]);
  assert.equal(id, "a");
});

test("installer does not open 443 or 8443", () => {
  const shell = installShell("disk-1", 8742, "ab".repeat(16), "/usr/bin/python3");
  assert.equal(shell.includes("8443"), false);
  assert.equal(shell.includes("allow 443"), false);
  assert.equal(shell.includes("ufw allow 8742/tcp"), true);
  assert.match(AGENT_SOURCE, /FORBIDDEN = \{443, 8443\}/);
  assert.equal(AGENT_SOURCE.includes("systemctl"), false);
});
