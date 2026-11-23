import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEnv,
  chooseMirror,
  compareCounts,
  confirmWordOk,
  dumpPercent,
  envNameAllowed,
  evaluateProbe,
  fixNeonUrl,
  maskHost,
  noteMirrorFailure,
  percentOf,
  plannedSteps,
  postgresMajorOf,
  publicUrlOk,
  scrub,
  stepTransition,
  volumeAction,
  jobTransition,
} from "./plan.ts";

test("weights stay on 100 and drop disabled stages", () => {
  const all = plannedSteps({ mega: true });
  const total = all.reduce((sum, step) => sum + step.weight, 0);
  assert.equal(total, 100);
  const slim = plannedSteps({ mega: false, database: false });
  assert.equal(slim.some((step) => step.key === "mega" || step.key === "database"), false);
  assert.equal(percentOf(slim.map((step) => ({ ...step, status: "done", percent: 100 }))), 100);
});

test("percent does not move backwards", () => {
  const steps = plannedSteps({ mega: false }).map((step) => ({ ...step, percent: 0 }));
  steps[0] = { ...steps[0], status: "done", percent: 100 };
  const first = percentOf(steps, 0);
  steps[0] = { ...steps[0], status: "running", percent: 10 };
  assert.equal(percentOf(steps, first), first);
});

test("status transitions stay final", () => {
  assert.equal(jobTransition("running", "paused"), "paused");
  assert.equal(jobTransition("done", "running"), "done");
  assert.equal(jobTransition("failed", "running"), "failed");
  assert.equal(stepTransition("failed", "running"), "running");
  assert.equal(stepTransition("done", "failed"), "done");
});

test("scrub hides secrets, urls and bearer headers", () => {
  const text = scrub("pass sword-secret-value and https://u:swordfish-pass@db.example/x Authorization: Bearer abcdefghijklmnop", ["sword-secret-value", "abcdefghijklmnop", "swordfish-pass"]);
  assert.equal(text.includes("sword-secret-value"), false);
  assert.equal(text.includes("swordfish-pass"), false);
  assert.equal(text.includes("abcdefghijklmnop"), false);
  assert.match(text, /Bearer \*\*\*/);
});

test("neon url drops the pooler and requires ssl", () => {
  const next = fixNeonUrl("postgres://u:p@ep-name-pooler.region.aws.neon.tech/vv?sslmode=require");
  assert.equal(next.includes("-pooler"), false);
  assert.match(fixNeonUrl("postgres://u:p@ep-name.region.aws.neon.tech/vv"), /sslmode=require/);
});

test("allowlist refuses the database url and build env omits it", () => {
  assert.equal(envNameAllowed("DATABASE_URL"), false);
  assert.equal(envNameAllowed("VITE_AUTH_ENABLED"), false);
  assert.equal(envNameAllowed("GROK_AUTH_SECRET"), false);
  assert.equal(envNameAllowed("TOPUP_MIN_RUB"), true);
  const env = buildEnv({
    publicUrl: "https://copy.example",
    appPort: 3000,
    postgresPassword: "generated-password-value",
    include: ["DATABASE_URL", "BETTER_AUTH_SECRET", "XAI_API_KEY"],
    source: { DATABASE_URL: "postgres://secret-db-url", BETTER_AUTH_SECRET: "auth-secret-value", XAI_API_KEY: "" },
  });
  assert.equal("DATABASE_URL" in env, false);
  assert.equal(env.BETTER_AUTH_SECRET, "auth-secret-value");
  assert.equal(env.XAI_API_KEY, undefined);
  assert.equal(env.APP_PORT, "3000");
});

test("mirror falls through after repeated failures", () => {
  let failures = {};
  assert.equal(chooseMirror(["a", "b"], failures), "a");
  failures = noteMirrorFailure(failures, "a");
  failures = noteMirrorFailure(failures, "a");
  failures = noteMirrorFailure(failures, "a");
  assert.equal(chooseMirror(["a", "b"], failures), "b");
});

test("host mask, public url and probe rules", () => {
  assert.equal(maskHost("203.0.113.10"), "203.0.113.x");
  assert.equal(publicUrlOk("https://copy.example"), true);
  assert.equal(publicUrlOk("http://127.0.0.1:3000"), false);
  assert.equal(publicUrlOk("http://203.0.113.10:3000"), true);
  assert.equal(confirmWordOk("ПЕРЕНЕСТИ"), true);
  const low = evaluateProbe({ os: "ubuntu", version: "22.04", arch: "x86_64", root: true, sudo: false, systemd: true, diskFree: 20 * 1024 ** 3, mem: 1024 ** 3, swap: 0, cores: 2, portBusy: false, docker: "", exists: false, reach: {} }, 15 * 1024 ** 3, false);
  assert.equal(low.checks.find((item) => item.key === "mem")?.level, "warn");
  assert.equal(low.canStart, true);
  assert.equal(postgresMajorOf("160008"), "16");
  assert.equal(volumeAction("15", "16", true), "drop");
  assert.equal(volumeAction("15", "16", false), "stop");
  assert.equal(dumpPercent(100, 1000, false) <= 95, true);
  assert.equal(compareCounts({ users: 100 }, { users: 100 }, ["users"]).failed, false);
  assert.equal(compareCounts({ users: 1000 }, { users: 900 }, ["users"]).failed, true);
});
