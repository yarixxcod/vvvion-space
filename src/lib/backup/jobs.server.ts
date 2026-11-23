import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Sql } from "../db.ts";
import {
  jobTransition,
  percentOf,
  plannedSteps,
  scrub,
  stepTransition,
  type CopyOptions,
  type JobStatus,
  type StepKey,
  type StepStatus,
  type StepView,
} from "./plan.ts";

export type Db = Pick<Sql, "query">;

export type ReportBody = {
  jobId?: unknown;
  seq?: unknown;
  heartbeat?: unknown;
  steps?: unknown;
  logs?: unknown;
  metrics?: unknown;
  result?: unknown;
};

const TOKEN_FAIL = { ok: false as const };
const BODY_LIMIT = 256 * 1024;
const hits = new Map<string, number[]>();

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sameToken(storedHash: string, token: string): boolean {
  if (!storedHash || !token) return false;
  const left = Buffer.from(storedHash);
  const right = Buffer.from(hashToken(token));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function bodyTooBig(request: Request): boolean {
  const size = Number(request.headers.get("content-length") || 0);
  return Number.isFinite(size) && size > BODY_LIMIT;
}

export function rateLimited(jobId: string, now = Date.now()): boolean {
  const recent = (hits.get(jobId) ?? []).filter((at) => now - at < 10_000);
  if (recent.length >= 20) {
    hits.set(jobId, recent);
    return true;
  }
  recent.push(now);
  hits.set(jobId, recent);
  return false;
}

export function secretValues(source: NodeJS.ProcessEnv = process.env): string[] {
  return Object.values(source).flatMap((value) => {
    const text = value?.trim() ?? "";
    return text.length >= 8 ? [text] : [];
  });
}

type JobRow = {
  id: string;
  created_by: string;
  status: JobStatus;
  host_masked: string;
  ssh_port: number;
  ssh_user: string;
  app_port: number;
  public_url: string;
  options: CopyOptions & { pending?: string[]; lastSeq?: number; commit?: string; branch?: string; mirrors?: unknown; overwrite?: boolean; latest?: boolean };
  token_hash: string;
  token_expires_at: string | null;
  percent: string | number;
  stage: string;
  message: string;
  error: string;
  heartbeat_at: string | null;
  result: Record<string, unknown>;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

function num(value: string | number | null | undefined): number {
  const next = Number(value ?? 0);
  return Number.isFinite(next) ? next : 0;
}

export async function createJob(db: Db, input: {
  userId: string;
  hostMasked: string;
  sshPort: number;
  sshUser: string;
  appPort: number;
  publicUrl: string;
  options: CopyOptions & Record<string, unknown>;
}): Promise<{ id: string; token: string } | { error: "active" }> {
  const existing = await db.query<{ id: string }>(
    "select id from backup_jobs where status in ('running','paused') limit 1",
  );
  if (existing.length) return { error: "active" };
  const id = randomBytes(16).toString("hex");
  const token = newToken();
  const steps = plannedSteps(input.options);
  try {
    await db.query(
      `insert into backup_jobs
        (id, created_by, status, host_masked, ssh_port, ssh_user, app_port, public_url, options, token_hash, token_expires_at, stage, started_at, updated_at)
       values ($1,$2,'running',$3,$4,$5,$6,$7,$8::jsonb,$9, now() + interval '72 hours', 'preflight', now(), now())`,
      [id, input.userId, input.hostMasked, input.sshPort, input.sshUser, input.appPort, input.publicUrl, JSON.stringify({ ...input.options, pending: [], lastSeq: 0 }), hashToken(token)],
    );
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "23505") return { error: "active" };
    throw error;
  }
  for (const [index, step] of steps.entries()) {
    await db.query(
      `insert into backup_steps (job_id, key, title, weight, position) values ($1,$2,$3,$4,$5)`,
      [id, step.key, step.title, step.weight, index],
    );
  }
  await addLog(db, id, "info", "", "Перенос запущен");
  return { id, token };
}

export async function readJob(db: Db, id: string): Promise<JobRow | null> {
  const rows = await db.query<JobRow>("select * from backup_jobs where id = $1", [id]);
  return rows[0] ?? null;
}

export async function activeJob(db: Db): Promise<JobRow | null> {
  const rows = await db.query<JobRow>(
    "select * from backup_jobs where status in ('running','paused') order by created_at desc limit 1",
  );
  return rows[0] ?? null;
}

async function stepsOf(db: Db, id: string): Promise<Array<StepView & { detail: string }>> {
  const rows = await db.query<StepView & { position: number; detail: string }>(
    "select key, title, weight, status, percent, detail from backup_steps where job_id = $1 order by position",
    [id],
  );
  return rows.map((row) => ({ ...row, percent: num(row.percent), weight: num(row.weight), detail: String(row.detail || "") }));
}

export async function applyReport(db: Db, token: string, body: ReportBody, now = new Date()) {
  const jobId = typeof body.jobId === "string" ? body.jobId : "";
  const job = jobId ? await readJob(db, jobId) : null;
  if (!job || !sameToken(job.token_hash, token)) return TOKEN_FAIL;
  if (job.token_expires_at && new Date(job.token_expires_at).getTime() < now.getTime()) return TOKEN_FAIL;
  if (job.status === "done" || job.status === "canceled" || job.status === "failed") return TOKEN_FAIL;
  const seq = Number(body.seq);
  if (!Number.isInteger(seq) || seq < 0) return TOKEN_FAIL;
  const options = job.options || {};
  const lastSeq = Number(options.lastSeq ?? 0);
  const pending = Array.isArray(options.pending) ? options.pending.map(String) : [];
  if (seq <= lastSeq) return { ok: true as const, commands: pending, now: now.toISOString() };
  const current = await stepsOf(db, job.id);
  const incoming = Array.isArray(body.steps) ? body.steps : [];
  const failedTitles: string[] = [];
  for (const item of incoming) {
    if (!item || typeof item !== "object") continue;
    const row = item as { key?: unknown; status?: unknown; percent?: unknown; detail?: unknown };
    const key = String(row.key || "");
    const found = current.find((step) => step.key === key);
    if (!found) continue;
    const previous = found.status;
    const status = stepTransition(found.status, String(row.status || found.status) as StepStatus);
    const percent = status === "done" || status === "skipped" ? 100 : Math.max(found.percent, num(row.percent as number));
    found.status = status;
    found.percent = percent;
    if (previous !== "failed" && status === "failed") failedTitles.push(found.title);
    const detail = scrub(String(row.detail || ""), secretValues()).slice(0, 300);
    await db.query(
      `update backup_steps set status = $3, percent = $4, detail = $5,
         attempts = attempts + case when $3 = 'running' and status <> 'running' then 1 else 0 end,
         started_at = coalesce(started_at, case when $3 = 'running' then now() else null end),
         finished_at = case when $3 in ('done','failed','skipped') then now() else finished_at end
       where job_id = $1 and key = $2`,
      [job.id, key, status, percent, detail],
    );
  }
  const logs = Array.isArray(body.logs) ? body.logs.slice(0, 40) : [];
  for (const item of logs) {
    if (!item || typeof item !== "object") continue;
    const row = item as { level?: unknown; step?: unknown; text?: unknown };
    await addLog(db, job.id, String(row.level || "info"), String(row.step || ""), scrub(String(row.text || ""), secretValues()));
  }
  const percent = percentOf(current, num(job.percent));
  const stage = current.find((step) => step.status === "running")?.key || current.find((step) => step.status === "failed")?.key || job.stage;
  let status: JobStatus = job.status;
  const failed = current.some((step) => step.status === "failed");
  const finished = current.every((step) => step.status === "done" || step.status === "skipped");
  if (pending.includes("cancel")) status = jobTransition(status, "canceled");
  else if (pending.includes("pause")) status = jobTransition(status, "paused");
  else if (pending.includes("continue")) status = jobTransition(status, "running");
  else if (failed) status = jobTransition(status, "failed");
  else if (finished) status = jobTransition(status, "done");
  const result = scrubTree({ ...(job.result || {}), ...(body.result && typeof body.result === "object" ? body.result as Record<string, unknown> : {}), ...(body.metrics && typeof body.metrics === "object" ? { metrics: body.metrics } : {}) });
  await db.query(
    `update backup_jobs set status = $2, percent = $3, stage = $4, heartbeat_at = now(),
       token_expires_at = now() + interval '72 hours',
       options = $5::jsonb, result = $6::jsonb, error = $7,
       finished_at = case when $2 in ('done','failed','canceled') then coalesce(finished_at, now()) else null end,
       updated_at = now()
     where id = $1`,
    [job.id, status, percent, stage, JSON.stringify({ ...options, lastSeq: seq, pending: [] }), JSON.stringify(result), status === "failed" ? scrub(String((body.result as { error?: string } | undefined)?.error || job.error || "Этап остановился"), secretValues()) : ""],
  );
  const events: { id: string; title: string; body: string }[] = [];
  if (status === "done") events.push({ id: `backup-done:${job.id}`, title: "Перенос завершён", body: "Копия сайта готова. Проверьте адрес и HTTPS." });
  for (const title of failedTitles) events.push({ id: `backup-fail:${job.id}:${title}`, title: "Ошибка переноса", body: `Ошибка на этапе ${title}` });
  await notifyOwner(job.created_by, events);
  return { ok: true as const, commands: pending, now: now.toISOString() };
}

export async function failJob(db: Db, jobId: string, message: string) {
  const text = scrub(message, secretValues()).slice(0, 300) || "Перенос не запустился";
  await db.query(
    `update backup_jobs set status = 'failed', error = $2, token_hash = '', token_expires_at = now(), finished_at = now(), updated_at = now()
     where id = $1 and status in ('running','paused','new')`,
    [jobId, text],
  );
  await addLog(db, jobId, "error", "", text);
}

export async function queueCommand(db: Db, jobId: string, command: string) {
  const job = await readJob(db, jobId);
  if (!job) return { ok: false as const };
  if (job.status === "done" || job.status === "canceled") return { ok: false as const };
  const options = job.options || {};
  const pending = Array.isArray(options.pending) ? options.pending.map(String) : [];
  if (!pending.includes(command)) pending.push(command);
  let status: JobStatus = job.status;
  if (command === "pause") status = jobTransition(status, "paused");
  if (command === "continue") status = jobTransition(status, "running");
  if (command === "cancel") status = jobTransition(status, "canceled");
  if (command.startsWith("retry:")) {
    const key = command.slice(6) as StepKey;
    await db.query("update backup_steps set status = 'pending', percent = 0, finished_at = null where job_id = $1 and key = $2 and status = 'failed'", [jobId, key]);
    status = job.status === "failed" ? "running" : status;
  }
  await db.query(
    "update backup_jobs set status = $2, options = $3::jsonb, updated_at = now(), finished_at = case when $2 = 'canceled' then now() else finished_at end where id = $1",
    [jobId, status, JSON.stringify({ ...options, pending })],
  );
  await addLog(db, jobId, "info", "", `Команда: ${command}`);
  return { ok: true as const };
}

async function addLog(db: Db, jobId: string, level: string, step: string, text: string) {
  const clean = scrub(text, secretValues()).slice(0, 300);
  if (!clean) return;
  await db.query("insert into backup_log (job_id, level, step, text) values ($1,$2,$3,$4)", [jobId, level.slice(0, 16), step.slice(0, 32), clean]);
}

export async function jobView(db: Db, id?: string) {
  const job = id ? await readJob(db, id) : (await activeJob(db)) || (await db.query<JobRow>("select * from backup_jobs order by created_at desc limit 1"))[0];
  if (!job) return null;
  const steps = await stepsOf(db, job.id);
  const logs = await db.query<{ id: string; at: string; level: string; step: string; text: string }>(
    "select id, at, level, step, text from backup_log where job_id = $1 order by id desc limit 200",
    [job.id],
  );
  const heartbeat = job.heartbeat_at ? Date.now() - new Date(job.heartbeat_at).getTime() : null;
  return {
    id: job.id,
    status: job.status,
    hostMasked: job.host_masked,
    sshPort: job.ssh_port,
    sshUser: job.ssh_user,
    appPort: job.app_port,
    publicUrl: job.public_url,
    percent: num(job.percent),
    stage: job.stage,
    message: job.message,
    error: job.error,
    result: viewResult(job.result || {}),
    staleSeconds: heartbeat == null ? null : Math.max(0, Math.round(heartbeat / 1000)),
    steps,
    logs: logs.reverse(),
  };
}

export async function history(db: Db) {
  const rows = await db.query<{ id: string; status: string; host_masked: string; percent: string; created_at: string; finished_at: string | null; started_at: string | null }>(
    "select id, status, host_masked, percent, created_at, started_at, finished_at from backup_jobs order by created_at desc limit 20",
  );
  return rows.map((row) => ({ id: row.id, status: row.status, hostMasked: row.host_masked, percent: num(row.percent), createdAt: row.created_at, startedAt: row.started_at, finishedAt: row.finished_at }));
}

export async function removeHistory(db: Db, id: string) {
  const job = await readJob(db, id);
  if (!job || job.status === "running" || job.status === "paused") return { ok: false as const };
  await db.query("delete from backup_jobs where id = $1", [id]);
  return { ok: true as const };
}

export async function pruneBackup(db: Db) {
  await db.query("delete from backup_log where at < now() - interval '30 days'");
  await db.query("delete from backup_jobs where status in ('done','failed','canceled') and coalesce(finished_at, created_at) < now() - interval '90 days'");
}

export async function manifestOf(db: Db, token: string, jobId: string, commit: string) {
  const job = await readJob(db, jobId);
  if (!job || !sameToken(job.token_hash, token)) return TOKEN_FAIL;
  if (job.status === "done" || job.status === "canceled" || job.status === "failed") return TOKEN_FAIL;
  const count = async (sql: string) => {
    try {
      const rows = await db.query<{ n: string }>(sql);
      return num(rows[0]?.n);
    } catch {
      return 0;
    }
  };
  const nodes = await db.query<{ id: string; host: string; port: number; bytes: string }>(
    `select n.id, n.host, n.agent_port as port, coalesce(sum(e.bytes),0)::text as bytes
     from mega_nodes n left join mega_entries e on e.node_id = n.id and e.kind = 'file' and e.status = 'ok'
     group by n.id, n.host, n.agent_port`,
  ).catch(() => [] as { id: string; host: string; port: number; bytes: string }[]);
  return {
    ok: true as const,
    commit,
    branch: "uiux-polish-3.0.1",
    counts: {
      users: await count('select count(*)::text as n from "user"'),
      sessions: await count('select count(*)::text as n from "session"'),
      diskFiles: await count("select count(*)::text as n from disk_files"),
      megaEntries: await count("select count(*)::text as n from mega_entries"),
      megaFiles: await count("select count(*)::text as n from mega_entries where kind = 'file' and status = 'ok'"),
      fileChunks: await count("select count(*)::text as n from file_chunks"),
    },
    dbBytes: await count("select pg_database_size(current_database())::text as n"),
    megaBytes: nodes.reduce((sum, node) => sum + num(node.bytes), 0),
    megaNodes: nodes.map((node) => ({ id: node.id, host: node.host, port: node.port, bytes: num(node.bytes) })),
    siteTime: new Date().toISOString(),
  };
}

export async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const { getSql } = await import("../db.ts");
  return fn(await getSql());
}

type Json = null | string | number | boolean | Json[] | { [key: string]: Json };
type CountRow = { key: string; source: number; copy: number; diff: number; level: string };
type PublicResult = { counts?: CountRow[]; warnings?: string[]; health?: string };

function scrubTree(value: unknown): Json {
  const secrets = secretValues();
  if (typeof value === "string") return scrub(value, secrets);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.map((item) => scrubTree(item));
  if (value && typeof value === "object") {
    const out: { [key: string]: Json } = {};
    for (const [key, item] of Object.entries(value)) out[key] = scrubTree(item);
    return out;
  }
  return null;
}

function viewResult(value: unknown): PublicResult {
  const clean = scrubTree(value);
  if (!clean || typeof clean !== "object" || Array.isArray(clean)) return {};
  const counts = Array.isArray(clean.counts)
    ? clean.counts.flatMap((item): CountRow[] => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        return [{
          key: typeof item.key === "string" ? item.key : "",
          source: typeof item.source === "number" ? item.source : 0,
          copy: typeof item.copy === "number" ? item.copy : 0,
          diff: typeof item.diff === "number" ? item.diff : 0,
          level: typeof item.level === "string" ? item.level : "",
        }];
      })
    : [];
  const warnings = Array.isArray(clean.warnings)
    ? clean.warnings.flatMap((item) => (typeof item === "string" ? [item] : []))
    : [];
  const health = typeof clean.health === "string" ? clean.health : "";
  return {
    ...(counts.length ? { counts } : {}),
    ...(warnings.length ? { warnings } : {}),
    ...(health ? { health } : {}),
  };
}

async function notifyOwner(userId: string, events: { id: string; title: string; body: string }[]) {
  if (!events.length || !userId) return;
  try {
    const { sendPush } = await import("../social/push.server.ts");
    for (const event of events) {
      await sendPush(userId, "system", { id: event.id, title: event.title, body: event.body, url: "/" });
    }
  } catch {
    // Пуш необязателен: исход уже записан в журнал задания.
  }
}
