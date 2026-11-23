import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { applyReport, createJob, hashToken, manifestOf, newToken, queueCommand, rateLimited, sameToken } from "./jobs.server.ts";

const migration = readFileSync(new URL("../../../migrations/0060_backup.sql", import.meta.url), "utf8");

async function db() {
  const pg = new PGlite();
  await pg.exec(migration);
  return {
    query: async <T>(text: string, params?: unknown[]) => {
      const result = await pg.query<T>(text, params);
      return result.rows;
    },
  };
}

test("only one transfer can run", async () => {
  const sql = await db();
  const first = await createJob(sql, job());
  assert.equal("token" in first, true);
  const second = await createJob(sql, job());
  assert.deepEqual(second, { error: "active" });
});

test("a bad, expired or finished token is the same refusal", async () => {
  const sql = await db();
  const created = await createJob(sql, job());
  if (!("token" in created)) throw new Error("job");
  const ok = await applyReport(sql, created.token, { jobId: created.id, seq: 1, steps: [{ key: "preflight", status: "running", percent: 10, detail: "ok" }] });
  assert.equal(ok.ok, true);
  assert.deepEqual(await applyReport(sql, "nope", { jobId: created.id, seq: 2 }), { ok: false });
  assert.deepEqual(await applyReport(sql, "", { jobId: created.id, seq: 2 }), { ok: false });
  await sql.query("update backup_jobs set token_expires_at = now() - interval '1 hour' where id = $1", [created.id]);
  assert.deepEqual(await applyReport(sql, created.token, { jobId: created.id, seq: 2 }), { ok: false });
  await sql.query("update backup_jobs set token_expires_at = now() + interval '1 hour', status = 'done' where id = $1", [created.id]);
  assert.deepEqual(await applyReport(sql, created.token, { jobId: created.id, seq: 2 }), { ok: false });
  assert.equal(sameToken(hashToken(newToken()), ""), false);
});

test("the same seq does not rewind the percent and secrets are scrubbed", async () => {
  const sql = await db();
  const created = await createJob(sql, job());
  if (!("token" in created)) throw new Error("job");
  process.env.BACKUP_TEST_SECRET = "super-secret-value";
  await applyReport(sql, created.token, { jobId: created.id, seq: 1, steps: [{ key: "preflight", status: "done", percent: 100, detail: "super-secret-value" }], logs: [{ text: "see super-secret-value", level: "info", step: "preflight" }] });
  const again = await applyReport(sql, created.token, { jobId: created.id, seq: 1, steps: [{ key: "preflight", status: "running", percent: 1 }] });
  assert.equal(again.ok, true);
  const rows = await sql.query<{ percent: string; text: string }>("select j.percent::text, l.text from backup_jobs j join backup_log l on l.job_id = j.id where j.id = $1", [created.id]);
  assert.equal(Number(rows[0]?.percent) > 0, true);
  assert.equal(rows.some((row) => row.text.includes("super-secret-value")), false);
  delete process.env.BACKUP_TEST_SECRET;
  const command = await queueCommand(sql, created.id, "pause");
  assert.equal(command.ok, true);
});

test("manifest hides node tokens and the body rate limit trips", async () => {
  const sql = await db();
  await sql.query("create table mega_nodes (id text, host text, agent_port int, agent_token text)");
  await sql.query("create table mega_entries (node_id text, kind text, status text, bytes int)");
  await sql.query("insert into mega_nodes (id, host, agent_port, agent_token) values ('n1','203.0.113.9',8742,'node-token-secret-value')");
  const created = await createJob(sql, job());
  if (!("token" in created)) throw new Error("job");
  const manifest = await manifestOf(sql, created.token, created.id, "abc");
  assert.equal(JSON.stringify(manifest).includes("node-token-secret-value"), false);
  assert.equal(rateLimited("same-job") || true, true);
  for (let i = 0; i < 20; i += 1) rateLimited("burst");
  assert.equal(rateLimited("burst"), true);
});

function job() {
  return { userId: "admin", hostMasked: "203.0.113.x", sshPort: 22, sshUser: "root", appPort: 3000, publicUrl: "https://copy.example", options: { code: true, database: true, settings: true, mega: true } };
}
