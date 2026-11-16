#!/usr/bin/env node
/**
 * VVVION VPN node agent. Run this on the VPS, never on Vercel.
 *
 * Env:
 *   VPN_AGENT_URL     https://vvvion.space/api/vpn-agent
 *   VPN_AGENT_TOKEN   same value as Vercel, never commit it
 *   VPN_NODE_ID       server id from the admin desk
 *   VPN_CLIENTS_FILE  optional path for the client list, mode 0600
 *   XRAY_CONFIG       optional Xray JSON config to edit in place
 *   HYSTERIA_CONFIG   optional Hysteria2 JSON config (userpass). YAML is refused.
 *   VPN_RELOAD_CMD    optional absolute path of a reload binary, no shell
 *
 * The agent installs only the clients the site returns. It does not invent
 * traffic. Real counters, if you have them:
 *   node scripts/vpn-agent.mjs --report ./counters.json
 * counters.json: [{ "userId": "...", "upload": 1, "download": 2 }]
 *
 * Until the first successful apply, the site keeps serving the shared link.
 * After apply, personal keys are served too. Expired access is actually
 * removed only after the admin cuts the shared key and the agent applies again.
 */
import { execFile } from "node:child_process";
import { readFile, rename, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { patchHysteria, patchXray } from "./vpn-apply.mjs";

const execFileAsync = promisify(execFile);
const url = process.env.VPN_AGENT_URL || "";
const token = process.env.VPN_AGENT_TOKEN || "";
const nodeId = process.env.VPN_NODE_ID || "";
if (!url || !token || !nodeId) {
  console.error("Need VPN_AGENT_URL, VPN_AGENT_TOKEN and VPN_NODE_ID");
  process.exit(1);
}

async function call(body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ nodeId, ...body }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${text.slice(0, 180)}`);
  return text ? JSON.parse(text) : {};
}

async function writeJson(path, value) {
  const tmp = `${path}.vvvion-tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(tmp, path);
}

const reportArg = process.argv.indexOf("--report");
let counters;
if (reportArg >= 0) {
  counters = JSON.parse(await readFile(process.argv[reportArg + 1], "utf8"));
}

await call({ op: "enroll" });
const pulled = await call({ op: "pull" });
const users = Array.isArray(pulled.users) ? pulled.users : [];
if (process.env.VPN_CLIENTS_FILE) await writeJson(process.env.VPN_CLIENTS_FILE, users);

let applied = false;
const errors = [];
const input = { users, dropShared: pulled.dropShared === true, shared: typeof pulled.shared === "string" ? pulled.shared : null };
if (process.env.XRAY_CONFIG) {
  try {
    const current = JSON.parse(await readFile(process.env.XRAY_CONFIG, "utf8"));
    const patched = patchXray(current, input);
    if (!patched.ok) errors.push(patched.error);
    else {
      await writeJson(process.env.XRAY_CONFIG, patched.config);
      applied = true;
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : "xray");
  }
}
if (process.env.HYSTERIA_CONFIG) {
  try {
    const raw = await readFile(process.env.HYSTERIA_CONFIG, "utf8");
    if (!raw.trim().startsWith("{")) errors.push("hysteria config must be json");
    else {
      const patched = patchHysteria(JSON.parse(raw), input);
      if (!patched.ok) errors.push(patched.error);
      else {
        await writeJson(process.env.HYSTERIA_CONFIG, patched.config);
        applied = true;
      }
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : "hysteria");
  }
}
if ((process.env.XRAY_CONFIG || process.env.HYSTERIA_CONFIG) && applied && !errors.length && process.env.VPN_RELOAD_CMD) {
  try {
    await execFileAsync(process.env.VPN_RELOAD_CMD, [], { timeout: 20000 });
  } catch (err) {
    applied = false;
    errors.push(err instanceof Error ? err.message.slice(0, 160) : "reload");
  }
}
if (process.env.XRAY_CONFIG || process.env.HYSTERIA_CONFIG) {
  await call({ op: "applied", ok: applied && errors.length === 0, error: errors.join("; ").slice(0, 160), clients: users.length });
}

let reported = false;
if (counters) {
  await call({ op: "report", reach: errors.length ? "down" : "up", error: errors.join("; ").slice(0, 160), users: counters });
  reported = true;
} else if (errors.length) {
  await call({ op: "report", reach: "down", error: errors.join("; ").slice(0, 160) });
}
console.log(JSON.stringify({ applied: applied && errors.length === 0, clients: users.length, reported, sharedCut: pulled.dropShared === true }));
if (errors.length) {
  console.error(errors.join("; ").slice(0, 180));
  process.exit(1);
}
