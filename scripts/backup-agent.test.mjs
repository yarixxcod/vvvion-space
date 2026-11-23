import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  blobPath,
  chooseMirror,
  classifyRestore,
  compareCounts,
  deliver,
  executeStep,
  megaKey,
  megaPercent,
  passwordInArgs,
  pgDumpArgs,
  postgresMajor,
  pushOutbox,
  resumePlan,
  scrub,
  tick,
  volumeAction,
} from "./backup-agent.mjs";

test("blob path matches the site hash", () => {
  const source = readFileSync(new URL("../src/lib/social/mega.ts", import.meta.url), "utf8");
  assert.match(source, /createHash\("sha256"\)\.update\(userId\)\.digest\("hex"\)\.slice\(0, 32\)/);
  const user = "user-42";
  assert.equal(megaKey(user), createHash("sha256").update(user).digest("hex").slice(0, 32));
  assert.equal(blobPath("node", user, "file"), `node/${megaKey(user)}/file`);
});

test("a second run skips a finished step and a bad network moves to the next mirror", async () => {
  const calls = [];
  const ctx = base({
    sh: async (cmd, args) => {
      calls.push([cmd, args]);
      if (cmd === "git" && args.includes("rev-parse")) return { code: 0, out: "abc123\n", err: "" };
      return { code: 0, out: "", err: "" };
    },
  });
  ctx.state.steps.code = { status: "done", percent: 100, detail: "" };
  await executeStep("code", ctx);
  assert.equal(calls.length, 0);
  assert.equal(chooseMirror(["https://registry.npmjs.org", "https://registry.npmmirror.com"], { "https://registry.npmjs.org": 3 }), "https://registry.npmmirror.com");
});

test("git checkout must land on the pinned commit", async () => {
  const ctx = base({
    sh: async (cmd, args) => (cmd === "git" && args.includes("rev-parse") ? { code: 0, out: "wrong\n", err: "" } : { code: 0, out: "", err: "" }),
  });
  const step = await executeStep("code", ctx);
  assert.equal(step.status, "failed");
});

test("secrets stay out of reports and offline reports are queued", async () => {
  const secret = "github-token-value";
  assert.equal(scrub(`token ${secret} Bearer ${secret}`, [secret]).includes(secret), false);
  const report = { jobId: "j", seq: 1, steps: [], logs: [{ text: secret }] };
  const missed = await deliver(report, async () => ({ ok: false }));
  assert.equal(missed.queued.length, 1);
  const sent = await deliver(report, async () => ({ ok: true, commands: ["continue"] }));
  assert.deepEqual(sent.commands, ["continue"]);
  assert.equal(pushOutbox([1, 2], 3, 2).length, 2);
});

test("cancel stops the runner and percent is monotonic by bytes", async () => {
  const ctx = base({});
  const stopped = await tick({ ...ctx, command: "cancel" });
  assert.equal(stopped.done, true);
  assert.equal(megaPercent(50, 200), 25);
  const part = resumePlan(8);
  assert.equal(part["X-Start"], "8");
  assert.deepEqual(resumePlan(0), {});
});

test("swap is created only when memory is short", async () => {
  const calls = [];
  const low = base({
    facts: { mem: 512 * 1024 * 1024, swap: 0 },
    sh: async (cmd) => {
      calls.push(cmd);
      return { code: 0, out: "", err: "" };
    },
  });
  await executeStep("preflight", low);
  assert.ok(calls.includes("fallocate"));
  calls.length = 0;
  const enough = base({ facts: { mem: 4 * 1024 ** 3, swap: 0 }, sh: async (cmd) => { calls.push(cmd); return { code: 0, out: "", err: "" }; } });
  await executeStep("preflight", enough);
  assert.equal(calls.includes("fallocate"), false);
});

test("database version is chosen before the db container and the password is not an argument", async () => {
  const calls = [];
  const ctx = base({
    env: { BACKUP_SOURCE_DATABASE_URL: "postgres://u:p@db/vv", PGPASSWORD: "db-password-value" },
    sh: async (cmd, args) => {
      calls.push([cmd, args]);
      if (cmd === "docker" && args.includes("psql")) return { code: 0, out: "160008", err: "" };
      return { code: 0, out: "", err: "" };
    },
  });
  let major = "";
  ctx.writeEnv = async (name, value) => {
    if (name === "POSTGRES_MAJOR") major = value;
  };
  const step = await executeStep("database", ctx);
  assert.equal(step.status, "done");
  assert.equal(major, "16");
  assert.equal(postgresMajor("160008"), "16");
  const dump = calls.find((item) => item[0] === "docker" && item[1].includes("pg_dump"));
  assert.ok(dump);
  assert.equal(passwordInArgs(dump[1], "db-password-value"), false);
  assert.equal(pgDumpArgs("postgres:16-alpine", "db.dump").includes("PGPASSWORD=db-password-value"), false);
  assert.equal(volumeAction("15", "16", false), "stop");
  assert.equal(compareCounts({ users: 10 }, { users: 12 }).failed, false);
  assert.equal(classifyRestore('role "nope" does not exist').failed, false);
  assert.equal(classifyRestore('relation "user" does not exist').failed, true);
});

test("a dead mega node does not fail the mirror", async () => {
  const ctx = base({
    manifest: { megaBytes: 10, megaNodes: [{ id: "n1", host: "203.0.113.8", port: 8742, token: "node-token-secret" }] },
    files: [{ nodeId: "n1", userId: "u", id: "f", bytes: 10 }],
    http: async () => ({ ok: false, body: "" }),
  });
  const step = await executeStep("mega", ctx);
  assert.equal(step.status, "done");
  assert.match(step.detail, /warn/);
  assert.equal(step.detail.includes("node-token-secret"), false);
});

test("a complete file is skipped and a partial file resumes", async () => {
  const seen = [];
  const ctx = base({
    files: [{ nodeId: "n1", userId: "u", id: "f", bytes: 10 }],
    manifest: { megaBytes: 10, megaNodes: [{ id: "n1", host: "203.0.113.8", port: 8742, token: "node-token-secret" }] },
    stat: async (path) => (path.endsWith(".part") ? 8 : path.endsWith("/f") ? 0 : 0),
    http: async (_method, _url, headers) => {
      seen.push(headers);
      return { ok: true, body: "" };
    },
  });
  let step = await executeStep("mega", ctx);
  assert.equal(step.status, "done");
  assert.equal(seen[0]["X-Start"], "8");
  assert.equal(seen[0].Authorization.startsWith("Bearer "), true);
  seen.length = 0;
  ctx.stat = async (path) => (String(path).endsWith("/f") ? 10 : 0);
  ctx.state.steps.mega = { status: "pending", percent: 0, detail: "" };
  step = await executeStep("mega", ctx);
  assert.equal(seen.length, 0);
  assert.equal(step.status, "done");
});

function base(extra) {
  return {
    job: { id: "j", commit: "abc123", branch: "uiux-polish-3.0.1", appPort: 3000, options: { mega: true, database: true }, mirrors: { npm: ["https://registry.npmjs.org"] } },
    env: {},
    secrets: ["node-token-secret"],
    state: { steps: {}, failures: {}, seq: 0 },
    logs: [],
    facts: { mem: 4 * 1024 ** 3, swap: 0, volumeEmpty: true },
    manifest: { counts: { users: 1 } },
    copyCounts: { users: 1 },
    sh: async () => ({ code: 0, out: "", err: "" }),
    http: async () => ({ ok: true, body: "{\"ok\":true}" }),
    writeEnv: async () => undefined,
    dropSecret: async () => undefined,
    ...extra,
  };
}
