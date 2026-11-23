import { createDecipheriv, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { appendFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

export const STEPS = ["preflight", "system", "code", "config", "build", "database", "mega", "start", "verify"];
const ROOT = "/opt/vvvion";
const STATE = `${ROOT}/.migrate/state.json`;
const OUTBOX = `${ROOT}/.migrate/outbox.jsonl`;

export function megaKey(userId) {
  return createHash("sha256").update(String(userId)).digest("hex").slice(0, 32);
}

export function blobPath(nodeId, userId, fileId) {
  return `${nodeId}/${megaKey(userId)}/${fileId}`;
}

export function scrub(text, secrets) {
  let out = String(text ?? "");
  out = out.replace(/\/\/([^/\s:@]+):([^/\s@]+)@/g, "//$1:***@");
  out = out.replace(/authorization\s*[:=]\s*bearer\s+\S+/gi, "Authorization: Bearer ***");
  out = out.replace(/\bBearer\s+\S+/gi, "Bearer ***");
  out = out.replace(/authorization\s*[:=]\s*(?!bearer\b)\S+/gi, "Authorization: ***");
  const list = [...new Set((secrets || []).map((item) => String(item).trim()).filter((item) => item.length >= 8))];
  list.sort((a, b) => b.length - a.length);
  for (const secret of list) out = out.split(secret).join("***");
  return out.slice(0, 300);
}

export function chooseMirror(list, failures, limit = 3) {
  const pending = list.filter((item) => (failures[item] || 0) < limit);
  return pending[0] || list[0] || "";
}

export function postgresMajor(versionNum) {
  const num = Number(versionNum);
  if (!Number.isFinite(num) || num < 10000) return "";
  return String(Math.floor(num / 10000));
}

export function volumeAction(existingMajor, wanted, volumeEmpty) {
  if (!existingMajor || existingMajor === wanted) return "keep";
  return volumeEmpty ? "drop" : "stop";
}

export function dumpPercent(bytes, dbBytes, finished) {
  if (finished) return 100;
  if (!dbBytes) return bytes > 0 ? 10 : 0;
  return Math.min(95, Math.round((bytes / (dbBytes * 0.35)) * 100));
}

export function compareCounts(source, copy) {
  const keys = ["users", "sessions", "diskFiles", "megaEntries", "fileChunks"];
  const rows = [];
  let failed = false;
  for (const key of keys) {
    const a = Number(source?.[key] || 0);
    const b = Number(copy?.[key] || 0);
    const diff = Math.abs(a - b);
    const tol = Math.max(20, Math.ceil(a * 0.01));
    const level = diff === 0 ? "ok" : diff <= tol ? "warn" : "fail";
    if (level === "fail") failed = true;
    rows.push({ key, source: a, copy: b, diff, level });
  }
  return { rows, failed };
}

export function classifyRestore(text) {
  const warnings = [];
  let failed = false;
  for (const line of String(text || "").split("\n")) {
    const row = line.trim();
    if (!row) continue;
    if (/extension .* is not available|role .* does not exist|could not open extension/i.test(row)) warnings.push(row.slice(0, 240));
    else if (/relation .* does not exist/i.test(row)) failed = true;
  }
  return { failed, warnings: warnings.slice(0, 20) };
}

export function pgDumpArgs(image, file, conn = {}) {
  const args = ["run", "--rm", "--network", "host", "-e", "PGPASSWORD", "-v", `${ROOT}/backup:/out`, image, "pg_dump", "-Fc", "--no-owner", "--no-acl", "--no-comments"];
  if (conn.host) args.push("-h", conn.host);
  if (conn.user) args.push("-U", conn.user);
  if (conn.db) args.push("-d", conn.db);
  args.push("-f", `/out/${file}`);
  return args;
}

export function connectionFromUrl(raw) {
  try {
    const url = new URL(String(raw || ""));
    return {
      host: url.hostname,
      user: decodeURIComponent(url.username),
      db: url.pathname.replace(/^\//, "") || "vvvion",
      password: decodeURIComponent(url.password),
    };
  } catch {
    return null;
  }
}

export function passwordInArgs(args, password) {
  if (!password || password.length < 4) return false;
  return args.some((item) => item === password || item.includes(`:${password}@`) || item.includes(`=${password}`));
}

export function pushOutbox(items, item, limit = 5000) {
  const next = items.concat(item);
  return next.length > limit ? next.slice(next.length - limit) : next;
}

export function enabledSteps(options = {}) {
  return STEPS.filter((key) => {
    if (key === "code" || key === "build") return options.code !== false;
    if (key === "database") return options.database !== false;
    if (key === "config") return options.settings !== false;
    if (key === "mega") return options.mega === true;
    return true;
  });
}

export function resumePlan(partBytes) {
  return partBytes > 0 ? { "X-Start": String(partBytes) } : {};
}

export function megaPercent(done, total) {
  if (!total) return done > 0 ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

function blankState(job) {
  return {
    steps: Object.fromEntries(enabledSteps(job.options).map((key) => [key, { status: "pending", percent: 0 }])),
    seq: 0,
    paused: false,
    canceled: false,
    failures: {},
    restarts: 0,
  };
}

async function gitAuth(ctx) {
  const token = String(ctx.env?.BACKUP_GITHUB_TOKEN || "");
  if (!token) return {};
  if (typeof ctx.writeAskpass === "function") await ctx.writeAskpass();
  return { GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "/opt/vvvion/.migrate/askpass", BACKUP_GITHUB_TOKEN: token };
}

async function mergeDockerMirrors(ctx) {
  const mirrors = Array.isArray(ctx.job.mirrors?.docker) && ctx.job.mirrors.docker.length ? ctx.job.mirrors.docker : ["https://mirror.gcr.io"];
  const current = await ctx.sh("cat", ["/etc/docker/daemon.json"]);
  let json = {};
  try {
    json = JSON.parse(current.out || "{}");
  } catch {
    json = {};
  }
  const have = Array.isArray(json["registry-mirrors"]) ? json["registry-mirrors"] : [];
  json["registry-mirrors"] = [...new Set([...have, ...mirrors])];
  const text = JSON.stringify(json);
  if (typeof ctx.writeText === "function") await ctx.writeText("/etc/docker/daemon.json", text);
  await ctx.sh("systemctl", ["enable", "--now", "docker"]);
  await ctx.sh("systemctl", ["restart", "docker"]);
}

async function loadMega(ctx) {
  if (Array.isArray(ctx.files)) {
    const nodes = ctx.manifest?.megaNodes || ctx.state?.manifest?.megaNodes || [];
    return { nodes, files: ctx.files };
  }
  const sql = "select coalesce(json_agg(row_to_json(t)),'[]') from (select n.id as \"nodeId\", n.host, n.agent_port as port, n.agent_token as token, e.user_id as \"userId\", e.id, e.bytes from mega_nodes n join mega_entries e on e.node_id = n.id and e.kind = 'file' and e.status = 'ok') t";
  const run = await ctx.sh("docker", ["compose", "exec", "-T", "db", "psql", "-U", "vvvion", "-d", "vvvion", "-tA", "-c", sql], { cwd: `${ROOT}/src` });
  let rows = [];
  try { rows = JSON.parse(run.out || "[]"); } catch { rows = []; }
  const secret = ctx.env?.BETTER_AUTH_SECRET || "";
  const nodes = new Map();
  const files = [];
  for (const row of rows) {
    if (!nodes.has(row.nodeId)) nodes.set(row.nodeId, { id: row.nodeId, host: row.host, port: row.port, token: openSeal(row.token, secret) });
    files.push({ nodeId: row.nodeId, userId: row.userId, id: row.id, bytes: Number(row.bytes || 0) });
  }
  return { nodes: [...nodes.values()], files };
}

async function localCounts(ctx) {
  if (ctx.copyCounts) return ctx.copyCounts;
  const sql = "select json_build_object('users',(select count(*) from \"user\"),'sessions',(select count(*) from \"session\"),'diskFiles',(select count(*) from disk_files),'megaEntries',(select count(*) from mega_entries),'fileChunks',(select count(*) from file_chunks))";
  const run = await ctx.sh("docker", ["compose", "exec", "-T", "db", "psql", "-U", "vvvion", "-d", "vvvion", "-tA", "-c", sql], { cwd: `${ROOT}/src` });
  try { return JSON.parse(run.out || "{}"); } catch { return {}; }
}

async function downloadBlob(ctx, node, file) {
  const dest = `/var/lib/vvvion-mirror/${blobPath(node.id, file.userId, file.id)}`;
  const expected = Number(file.bytes || 0);
  const ready = await fileSize(ctx, dest);
  if (expected > 0 && ready === expected) return expected;
  const part = `${dest}.part`;
  let have = await fileSize(ctx, part);
  const url = `http://${node.host}:${node.port}/blob/${megaKey(file.userId)}/${file.id}`;
  const chunk = 8 * 1024 * 1024;
  if (Array.isArray(ctx.files)) {
    const headers = { Authorization: `Bearer ${node.token || ""}`, ...resumePlan(have) };
    if (expected > have) headers["X-End"] = String(Math.min(have + chunk, expected) - 1);
    const res = await ctx.http("GET", url, headers);
    if (!res.ok) throw new Error("down");
    return expected || have;
  }
  let guard = 0;
  while (guard < 200000 && (!expected || have < expected)) {
    guard += 1;
    const headers = { Authorization: `Bearer ${node.token || ""}`, ...resumePlan(have) };
    if (expected) headers["X-End"] = String(Math.min(have + chunk, expected) - 1);
    const buf = await fetchChunk(url, headers);
    if (!buf.length) break;
    await mkdir(dirname(part), { recursive: true });
    await appendFile(part, buf);
    have += buf.length;
  }
  if (expected && have !== expected) throw new Error("size");
  await mkdir(dirname(dest), { recursive: true });
  await rename(part, dest);
  return have;
}

async function fetchChunk(url, headers) {
  let error = new Error("down");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      const response = await fetch(url, { headers, signal: controller.signal });
      if (!response.ok) {
        error = new Error("down");
        continue;
      }
      return Buffer.from(await response.arrayBuffer());
    } catch (cause) {
      error = cause instanceof Error ? cause : new Error("down");
    } finally {
      clearTimeout(timer);
    }
  }
  throw error;
}

export async function executeStep(key, ctx) {
  const state = ctx.state;
  const mark = (percent, detail) => {
    state.steps[key] = { status: "running", percent, detail: scrub(detail || "", ctx.secrets) };
  };
  if (state.steps[key]?.status === "done" || state.steps[key]?.status === "skipped") return state.steps[key];
  state.steps[key] = { status: "running", percent: state.steps[key]?.percent || 0, detail: "" };
  if (key === "preflight") {
    const mem = Number(ctx.facts?.mem || 0);
    const swap = Number(ctx.facts?.swap || 0);
    if (mem && mem < 2 * 1024 ** 3 && swap < 2 * 1024 ** 3) {
      await ctx.sh("fallocate", ["-l", "2G", "/swapfile"]);
      await ctx.sh("mkswap", ["/swapfile"]);
      await ctx.sh("swapon", ["/swapfile"]);
      mark(80, "Создан swap 2 ГБ");
    } else mark(50, "Место и память проверены");
    await ctx.http("GET", "/api/backup/manifest").then((manifest) => {
      if (!manifest?.body) return;
      try { state.manifest = JSON.parse(manifest.body); } catch { /* ответ не json */ }
    });
    state.steps[key] = { status: "done", percent: 100, detail: "Проверка пройдена" };
    return state.steps[key];
  }
  if (key === "system") {
    if (!ctx.facts?.docker) {
      const mirrors = ["https://get.docker.com", "https://get.docker.com/?mirror=Aliyun"];
      let installed = false;
      for (const url of mirrors) {
        const run = await ctx.sh("sh", ["-c", "curl -fsSL " + JSON.stringify(url) + " | sh"], { allowShell: true });
        if (run.code === 0) {
          installed = true;
          break;
        }
        state.failures[url] = (state.failures[url] || 0) + 1;
      }
      if (!installed) {
        const apt = await ctx.sh("apt-get", ["install", "-y", "docker.io", "docker-compose-v2"]);
        if (apt.code !== 0) {
          state.steps[key] = { status: "failed", percent: 30, detail: "Docker не установился" };
          return state.steps[key];
        }
      }
    }
    await mergeDockerMirrors(ctx);
    state.steps[key] = { status: "done", percent: 100, detail: ctx.facts?.docker ? "Docker уже установлен" : "Docker готов" };
    return state.steps[key];
  }
  if (key === "code") {
    const dir = `${ROOT}/src`;
    const branch = ctx.job.branch || "uiux-polish-3.0.1";
    let sha = String(ctx.job.commit || "");
    const authEnv = await gitAuth(ctx);
    if (!sha || sha === "HEAD" || ctx.job.latest) {
      const remote = await ctx.sh("git", ["ls-remote", "https://github.com/yarixxcod/vvvion-space", `refs/heads/${branch}`], { env: authEnv });
      sha = (remote.out || "").trim().split(/\s+/)[0] || "";
    }
    if (!/^[0-9a-f]{6,40}$/i.test(sha)) {
      state.steps[key] = { status: "failed", percent: 20, detail: "Коммит не закреплён" };
      return state.steps[key];
    }
    const exists = await ctx.sh("test", ["-d", `${dir}/.git`]);
    if (exists.code !== 0) {
      const cloned = await ctx.sh("git", ["clone", "--depth", "1", "--branch", branch, "https://github.com/yarixxcod/vvvion-space", dir], { env: authEnv });
      if (cloned.code !== 0) {
        state.steps[key] = { status: "failed", percent: 30, detail: "Репозиторий не скачался" };
        return state.steps[key];
      }
    }
    await ctx.sh("git", ["-C", dir, "fetch", "--depth", "1", "origin", sha], { env: authEnv });
    await ctx.sh("git", ["-C", dir, "checkout", "--detach", sha], { env: authEnv });
    const head = await ctx.sh("git", ["-C", dir, "rev-parse", "HEAD"]);
    if ((head.out || "").trim() !== sha) {
      state.steps[key] = { status: "failed", percent: 40, detail: "Коммит не совпал" };
      return state.steps[key];
    }
    if (ctx.dropSecret) await ctx.dropSecret("BACKUP_GITHUB_TOKEN");
    state.steps[key] = { status: "done", percent: 100, detail: sha.slice(0, 8) };
    return state.steps[key];
  }
  if (key === "config") {
    await ctx.sh("cp", [`${ROOT}/.migrate/.env`, `${ROOT}/src/.env`]);
    state.steps[key] = { status: "done", percent: 100, detail: "Настройки записаны" };
    return state.steps[key];
  }
  if (key === "build") {
    const list = ctx.job.mirrors?.npm?.length ? ctx.job.mirrors.npm : ["https://registry.npmjs.org", "https://registry.npmmirror.com"];
    let built = false;
    for (const registry of list) {
      if ((state.failures[registry] || 0) >= 3) continue;
      const run = await ctx.sh("docker", ["compose", "build", "--build-arg", `NPM_REGISTRY=${registry}`], { cwd: `${ROOT}/src` });
      if (run.code === 0) {
        built = true;
        break;
      }
      state.failures[registry] = (state.failures[registry] || 0) + 1;
    }
    if (!built) {
      state.steps[key] = { status: "failed", percent: 40, detail: "Сборка не прошла" };
      return state.steps[key];
    }
    state.steps[key] = { status: "done", percent: 100, detail: "Образ собран" };
    return state.steps[key];
  }
  if (key === "database") {
    const source = ctx.env.BACKUP_SOURCE_DATABASE_URL || "";
    if (!source) {
      state.steps[key] = { status: "skipped", percent: 100, detail: "Источник базы не задан" };
      return state.steps[key];
    }
    const conn = connectionFromUrl(source);
    const password = conn?.password || "";
    const version = await ctx.sh("docker", [
      "run", "--rm", "--network", "host", "-e", "PGPASSWORD",
      "postgres:16-alpine", "psql", "-h", conn.host, "-U", conn.user, "-d", conn.db,
      "-tAc", "select current_setting('server_version_num')",
    ], { env: { PGPASSWORD: password } });
    const major = postgresMajor((version.out || "").replace(/\D/g, "").slice(0, 6));
    if (major) await ctx.writeEnv("POSTGRES_MAJOR", major);
    const image = `postgres:${major || "16"}-alpine`;
    const dump = `db-${Date.now()}.dump`;
    const args = pgDumpArgs(image, dump, conn || {});
    if (password && passwordInArgs(args, password)) {
      state.steps[key] = { status: "failed", percent: 10, detail: "Пароль нельзя передавать аргументом" };
      return state.steps[key];
    }
    const dumped = await ctx.sh("docker", args, { env: { PGPASSWORD: password } });
    if (dumped.code !== 0) {
      state.steps[key] = { status: "failed", percent: 40, detail: "Дамп не снялся" };
      return state.steps[key];
    }
    const listed = await ctx.sh("docker", ["run", "--rm", "-v", `${ROOT}/backup:/out`, image, "pg_restore", "-l", `/out/${dump}`]);
    if (listed.code !== 0) {
      state.steps[key] = { status: "failed", percent: 70, detail: "Дамп повреждён" };
      return state.steps[key];
    }
    const action = volumeAction(ctx.facts?.pgMajor || "", major, ctx.facts?.volumeEmpty !== false);
    if (action === "stop") {
      state.steps[key] = { status: "failed", percent: 80, detail: "Том базы другой версии и не пуст" };
      return state.steps[key];
    }
    if (action === "drop") await ctx.sh("docker", ["volume", "rm", "vvvion_pgdata"]);
    await ctx.sh("docker", ["compose", "up", "-d", "db"], { cwd: `${ROOT}/src` });
    const restored = await ctx.sh("docker", ["compose", "exec", "-T", "db", "pg_restore", "--no-owner", "--no-acl", "--clean", "--if-exists", "-j", "2", "-d", "vvvion", `/backup/${dump}`], { cwd: `${ROOT}/src` });
    const verdict = classifyRestore(`${restored.out || ""}\n${restored.err || ""}`);
    if (verdict.failed) {
      state.steps[key] = { status: "failed", percent: 90, detail: "Данные не восстановились" };
      return state.steps[key];
    }
    await ctx.dropSecret("BACKUP_SOURCE_DATABASE_URL");
    state.steps[key] = { status: "done", percent: 100, detail: verdict.warnings.length ? "Есть предупреждения" : "База восстановлена" };
    state.warnings = verdict.warnings;
    return state.steps[key];
  }
  if (key === "mega") {
    const loaded = await loadMega(ctx);
    const nodes = loaded.nodes;
    let done = 0;
    const total = Number(ctx.manifest?.megaBytes || ctx.state?.manifest?.megaBytes || 0);
    const down = [];
    for (const node of nodes) {
      try {
        for (const file of loaded.files.filter((item) => item.nodeId === node.id)) {
          const bytes = await downloadBlob(ctx, node, file);
          done += bytes;
          mark(megaPercent(done, total), `${done} байт`);
        }
      } catch {
        down.push(node.host);
      }
    }
    state.steps[key] = down.length
      ? { status: "done", percent: 100, detail: `warn: недоступны ${down.join(", ")}` }
      : { status: "done", percent: 100, detail: "Зеркало собрано" };
    return state.steps[key];
  }
  if (key === "start") {
    const up = await ctx.sh("docker", ["compose", "up", "-d"], { cwd: `${ROOT}/src` });
    if (up.code !== 0) {
      state.steps[key] = { status: "failed", percent: 50, detail: "Контейнеры не запустились" };
      return state.steps[key];
    }
    const tries = ctx.healthTries || 1;
    let healthy = false;
    for (let attempt = 0; attempt < tries; attempt += 1) {
      const health = await ctx.http("GET", `http://127.0.0.1:${ctx.job.appPort || 3000}/api/health`);
      if (health.ok) {
        healthy = true;
        break;
      }
      if (ctx.sleep) await ctx.sleep(5000);
    }
    if (!healthy) {
      state.steps[key] = { status: "failed", percent: 80, detail: "Сайт не ответил на /api/health" };
      return state.steps[key];
    }
    state.steps[key] = { status: "done", percent: 100, detail: "Сайт запущен" };
    return state.steps[key];
  }
  if (key === "verify") {
    const health = await ctx.http("GET", `http://127.0.0.1:${ctx.job.appPort || 3000}/api/health`);
    const manifest = ctx.manifest || state.manifest || {};
    const copy = ctx.job.options?.database === false ? {} : (ctx.copyCounts || await localCounts(ctx));
    const counts = ctx.job.options?.database === false ? { rows: [], failed: false } : compareCounts(manifest.counts || {}, copy);
    if (!health.ok || counts.failed) {
      state.steps[key] = { status: "failed", percent: 70, detail: "Проверка не сошлась" };
      return state.steps[key];
    }
    state.result = { health: health.body, counts: counts.rows, warnings: state.warnings || [] };
    state.steps[key] = { status: "done", percent: 100, detail: "Сайт отвечает" };
    return state.steps[key];
  }
  state.steps[key] = { status: "failed", percent: 0, detail: "Неизвестный этап" };
  return state.steps[key];
}

export async function tick(ctx) {
  if (!ctx.state) ctx.state = blankState(ctx.job);
  if (ctx.command === "cancel") {
    ctx.state.canceled = true;
    return { done: true, report: reportOf(ctx) };
  }
  if (ctx.command === "pause") ctx.state.paused = true;
  if (ctx.command === "continue") ctx.state.paused = false;
  if (ctx.command?.startsWith("retry:")) {
    const key = ctx.command.slice(6);
    if (ctx.state.steps[key]) ctx.state.steps[key] = { status: "pending", percent: 0, detail: "" };
    ctx.state.paused = false;
  }
  if (ctx.command?.startsWith("skip:") && (ctx.command.endsWith("mega") || ctx.command.endsWith("system"))) {
    const key = ctx.command.slice(5);
    if (ctx.state.steps[key]) ctx.state.steps[key] = { status: "skipped", percent: 100, detail: "Пропущен" };
  }
  if (ctx.state.paused || ctx.state.canceled) return { done: ctx.state.canceled, report: reportOf(ctx) };
  const next = enabledSteps(ctx.job.options).find((key) => ctx.state.steps[key]?.status !== "done" && ctx.state.steps[key]?.status !== "skipped");
  if (!next) return { done: true, report: reportOf(ctx) };
  if (ctx.state.steps[next]?.status === "failed" && ctx.command !== `retry:${next}`) return { done: false, report: reportOf(ctx) };
  await executeStep(next, ctx);
  return { done: false, report: reportOf(ctx) };
}

function reportOf(ctx) {
  ctx.state.seq += 1;
  const steps = Object.entries(ctx.state.steps).map(([key, step]) => ({ key, status: step.status, percent: step.percent, detail: scrub(step.detail || "", ctx.secrets) }));
  return { jobId: ctx.job.id, seq: ctx.state.seq, steps, logs: ctx.logs || [], result: ctx.state.result };
}

export async function deliver(report, http) {
  const sent = await http(report);
  if (sent.ok) return { queued: [], commands: sent.commands || [] };
  return { queued: [report], commands: [] };
}

async function diskLog(line, secrets) {
  const path = `${ROOT}/.migrate/agent.log`;
  const info = await stat(path).catch(() => null);
  if (info && info.size > 20 * 1024 * 1024) await rename(path, `${path}.1`).catch(() => undefined);
  await appendFile(path, `${scrub(line, secrets)}\n`).catch(() => undefined);
}

async function loadState(job) {
  try {
    const parsed = JSON.parse(await readFile(STATE, "utf8"));
    if (parsed && parsed.steps) return parsed;
  } catch {
    /* первый запуск */
  }
  return blankState(job);
}

async function runLive() {
  const job = JSON.parse(await readFile(`${ROOT}/.migrate/job.json`, "utf8"));
  const envText = await readFile(`${ROOT}/.migrate/.env`, "utf8").catch(() => "");
  const env = parseEnv(envText);
  const secrets = Object.values(env).filter((item) => item && item.length >= 8);
  const ctx = {
    job,
    env,
    secrets,
    state: await loadState(job),
    logs: [],
    facts: {},
    command: "",
    sh: (cmd, args, opts = {}) => spawnText(cmd, args, opts),
    http: siteHttp(job, secrets),
    writeEnv: async (name, value) => {
      const text = await readFile(`${ROOT}/src/.env`, "utf8").catch(() => envText);
      const lines = text.split("\n").filter((line) => line && !line.startsWith(`${name}=`));
      lines.push(`${name}=${value}`);
      await writeFile(`${ROOT}/src/.env`, `${lines.join("\n")}\n`);
    },
    writeText: async (path, text) => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, text);
    },
    writeAskpass: async () => {
      const path = `${ROOT}/.migrate/askpass`;
      await writeFile(path, "#!/bin/sh\ncase \"$1\" in\n  *Username*) printf '%s\\n' x-access-token ;;\n  *) printf '%s\\n' \"$BACKUP_GITHUB_TOKEN\" ;;\nesac\n");
      await spawnText("chmod", ["700", path]);
    },
    dropSecret: async (name) => {
      for (const file of [`${ROOT}/.migrate/.env`, `${ROOT}/src/.env`]) {
        const text = await readFile(file, "utf8").catch(() => "");
        await writeFile(file, text.split("\n").filter((line) => !line.startsWith(`${name}=`) && !line.startsWith("BACKUP_GITHUB_TOKEN=")).join("\n"));
      }
      await spawnText("rm", ["-f", `${ROOT}/.migrate/askpass`]);
    },
  };
  let outbox = [];
  let pending = [];
  try {
    const saved = await readFile(OUTBOX, "utf8");
    outbox = saved.split("\n").filter(Boolean).slice(-5000).map((line) => JSON.parse(line));
  } catch {
    outbox = [];
  }
  let finished = false;
  for (let i = 0; i < 400; i += 1) {
    for (const command of pending) {
      ctx.command = command;
      await tick(ctx);
    }
    ctx.command = "";
    const step = await tick(ctx);
    await diskLog(`${step.report.seq} ${step.report.steps.map((item) => `${item.key}:${item.status}`).join(" ")}`, secrets);
    outbox = pushOutbox(outbox, step.report);
    const sent = await postReports(job, outbox, secrets);
    outbox = sent.left;
    pending = sent.commands;
    await mkdir(dirname(STATE), { recursive: true });
    await writeFile(`${STATE}.tmp`, JSON.stringify(ctx.state));
    await rename(`${STATE}.tmp`, STATE);
    if (step.done || ctx.state.canceled) {
      finished = true;
      break;
    }
    if (Object.values(ctx.state.steps).some((item) => item.status === "failed")) break;
    await new Promise((resolve) => setTimeout(resolve, ctx.state.paused ? 15000 : 4000));
  }
  if (finished) await spawnText("systemctl", ["disable", "--now", "vvvion-migrate"]);
  else process.exitCode = 1;
}

function siteHttp(job, secrets) {
  return async (method, url) => {
    const response = await fetch(url.startsWith("http") ? url : `${job.site}${url}?jobId=${job.id}`, {
      method,
      headers: { authorization: `Bearer ${job.token}` },
    });
    const text = scrub(await response.text(), secrets);
    return { ok: response.ok, body: text };
  };
}

async function postReports(job, reports, secrets) {
  const left = [];
  const commands = [];
  for (const report of reports) {
    try {
      const response = await fetch(`${job.site}/api/backup/report`, {
        method: "POST",
        headers: { authorization: `Bearer ${job.token}`, "content-type": "application/json" },
        body: JSON.stringify({ ...report, logs: (report.logs || []).map((row) => ({ ...row, text: scrub(row.text, secrets) })) }),
      });
      if (!response.ok) {
        left.push(report);
        continue;
      }
      const body = await response.json().catch(() => ({}));
      if (Array.isArray(body.commands)) {
        for (const command of body.commands) if (typeof command === "string") commands.push(command);
      }
    } catch {
      left.push(report);
    }
  }
  const capped = left.slice(-5000);
  await mkdir(dirname(OUTBOX), { recursive: true });
  await writeFile(OUTBOX, capped.map((item) => JSON.stringify(item)).join("\n"));
  return { left: capped, commands };
}

function spawnText(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, shell: false });
    let out = "";
    let err = "";
    child.stdout?.on("data", (chunk) => {
      out += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk) => {
      err += chunk.toString("utf8");
    });
    child.on("close", (code) => resolve({ code: code ?? 1, out, err }));
    child.on("error", (error) => resolve({ code: 1, out, err: error.message }));
  });
}

const main = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === main && process.argv[2] === "run") {
  runLive().catch(async (error) => {
    await appendFile(`${ROOT}/.migrate/agent.log`, `${scrub(error instanceof Error ? error.message : "fail", [])}\n`).catch(() => undefined);
    process.exitCode = 1;
  });
}

export function openSeal(payload, secret) {
  try {
    const raw = Buffer.from(String(payload || ""), "base64");
    if (raw.length < 29) return String(payload || "");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const data = raw.subarray(28);
    const key = createHash("sha256").update(String(secret || "vvvion-mega-local")).digest();
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return String(payload || "");
  }
}

export function parseEnv(text) {
  const env = {};
  for (const line of String(text || "").split("\n")) {
    const index = line.indexOf("=");
    if (index <= 0) continue;
    let value = line.slice(index + 1);
    if (value.startsWith('"')) {
      try { value = JSON.parse(value); } catch { /* оставляем как в файле */ }
    }
    env[line.slice(0, index)] = value;
  }
  return env;
}

export async function fileSize(ctxOrPath, maybePath) {
  if (typeof ctxOrPath === "string") {
    const info = await stat(ctxOrPath).catch(() => null);
    return info?.size || 0;
  }
  if (ctxOrPath && typeof ctxOrPath.stat === "function") return Number(await ctxOrPath.stat(maybePath)) || 0;
  const info = await stat(maybePath).catch(() => null);
  return info?.size || 0;
}
