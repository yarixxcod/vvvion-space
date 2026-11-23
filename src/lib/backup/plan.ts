export const NODE_VERSION = "22.23.5";
export const CONFIRM_WORD = "ПЕРЕНЕСТИ";
export const CONFIRM_WORD_EN = "TRANSFER";
export const DELETE_WORD = "УДАЛИТЬ";

export const STEP_DEFS = [
  { key: "preflight", title: "Проверка сервера", weight: 2 },
  { key: "system", title: "Docker и пакеты", weight: 12 },
  { key: "code", title: "Код", weight: 6 },
  { key: "config", title: "Настройки", weight: 2 },
  { key: "build", title: "Сборка", weight: 26 },
  { key: "database", title: "База и пользователи", weight: 24 },
  { key: "mega", title: "Зеркало Мегадиска", weight: 20 },
  { key: "start", title: "Запуск", weight: 5 },
  { key: "verify", title: "Проверка", weight: 3 },
] as const;

export type StepKey = (typeof STEP_DEFS)[number]["key"];
export type StepStatus = "pending" | "running" | "done" | "failed" | "skipped";
export type JobStatus = "new" | "running" | "paused" | "done" | "failed" | "canceled";

export type StepView = {
  key: StepKey;
  title: string;
  weight: number;
  status: StepStatus;
  percent: number;
};

export type CopyOptions = {
  code?: boolean;
  database?: boolean;
  settings?: boolean;
  mega?: boolean;
};

const OPTIONAL = new Set<StepKey>(["mega", "system"]);

export function stepEnabled(key: StepKey, options: CopyOptions): boolean {
  if (key === "code" || key === "build") return options.code !== false;
  if (key === "database") return options.database !== false;
  if (key === "config") return options.settings !== false;
  if (key === "mega") return options.mega === true;
  return true;
}

export function plannedSteps(options: CopyOptions): StepView[] {
  return STEP_DEFS.filter((step) => stepEnabled(step.key, options)).map((step) => ({
    key: step.key,
    title: step.title,
    weight: step.weight,
    status: "pending",
    percent: 0,
  }));
}

export function percentOf(steps: Pick<StepView, "weight" | "status" | "percent">[], previous = 0): number {
  const total = steps.reduce((sum, step) => sum + step.weight, 0) || 1;
  const raw = steps.reduce((sum, step) => {
    const share = step.status === "done" || step.status === "skipped" ? 100 : clamp(step.percent);
    return sum + step.weight * share;
  }, 0);
  const next = Math.round((raw / total) * 100) / 100;
  return Math.max(clamp(previous), Math.min(100, next));
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

const FINAL_JOB = new Set<JobStatus>(["done", "canceled", "failed"]);

export function jobTransition(from: JobStatus, to: JobStatus): JobStatus {
  if (from === to) return from;
  if (FINAL_JOB.has(from)) return from;
  if (from === "new" && (to === "running" || to === "canceled")) return to;
  if (from === "running" && (to === "paused" || to === "done" || to === "failed" || to === "canceled")) return to;
  if (from === "paused" && (to === "running" || to === "canceled" || to === "failed")) return to;
  return from;
}

export function stepTransition(from: StepStatus, to: StepStatus): StepStatus {
  if (from === to) return from;
  if (from === "done" || from === "skipped") return from;
  if (from === "failed" && to === "running") return to;
  if (from === "pending" && (to === "running" || to === "skipped")) return to;
  if (from === "running" && (to === "done" || to === "failed" || to === "skipped" || to === "pending")) return to;
  return from;
}

export function canSkip(key: string): boolean {
  return OPTIONAL.has(key as StepKey);
}

export function scrub(text: string, secrets: readonly string[]): string {
  let out = String(text ?? "");
  out = out.replace(/\/\/([^/\s:@]+):([^/\s@]+)@/g, "//$1:***@");
  out = out.replace(/authorization\s*[:=]\s*bearer\s+\S+/gi, "Authorization: Bearer ***");
  out = out.replace(/\bBearer\s+\S+/gi, "Bearer ***");
  out = out.replace(/authorization\s*[:=]\s*(?!bearer\b)\S+/gi, "Authorization: ***");
  const unique = [...new Set(secrets.map((item) => item.trim()).filter((item) => item.length >= 8))];
  unique.sort((a, b) => b.length - a.length);
  for (const secret of unique) out = out.split(secret).join("***");
  return out.slice(0, 2000);
}

export function maskHost(host: string): string {
  const value = host.trim().toLowerCase();
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)) return value.replace(/\.\d+$/, ".x");
  if (value.includes(":")) return value.replace(/:[0-9a-f]{0,4}$/i, ":x");
  const parts = value.split(".").filter(Boolean);
  if (parts.length <= 1) return value ? `${value.slice(0, 1)}…` : "";
  return `${parts[0]?.slice(0, 1) ?? ""}….${parts.slice(1).join(".")}`;
}

export function fixNeonUrl(raw: string): string {
  const text = raw.trim();
  if (!text) return "";
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return text.replace(/-pooler(?=\.)/g, "");
  }
  url.hostname = url.hostname.replace(/-pooler(?=\.)/g, "");
  if (!url.searchParams.get("sslmode")) url.searchParams.set("sslmode", "require");
  return url.toString();
}

const EXACT_ENV = [
  "BETTER_AUTH_SECRET",
  "XAI_API_KEY",
  "OPENAI_API_KEY",
  "WHISPER_API_KEY",
  "TINYFISH_API_KEY",
  "FREENEWS_API_KEY",
  "FIREBASE_SERVICE_ACCOUNT_JSON",
  "FIREBASE_PROJECT_ID",
  "CRON_SECRET",
  "PUSH_CRON_SECRET",
  "ALTCHA_HMAC_KEY",
  "TELEGRAM_TOKEN_KEY",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "CRYPTOPAY_TOKEN",
  "CRYPTOPAY_NETWORK",
  "CRYPTOPAY_WEBHOOK_SECRET",
  "CRYPTOPAY_ENABLED",
  "PAY_TOPUP",
  "PAY_CURRENCIES",
  "SHOP_V2",
  "WALLET_SPLIT",
  "AI_PAYG",
  "VPN_AGENT_TOKEN",
  "YTDLP_COOKIES",
] as const;

const PREFIX_ENV = ["TOPUP_", "VVVION_S3_", "VVVION_MEMORY_"] as const;

export function envAllowlist(): string[] {
  return [...EXACT_ENV];
}

export function envNameAllowed(name: string): boolean {
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) return false;
  if (name === "DATABASE_URL" || name === "NODE_ENV" || name === "PORT") return false;
  if (name.startsWith("GROK_") || name.startsWith("VITE_") || name.startsWith("VERCEL") || name.startsWith("NITRO_")) return false;
  if ((EXACT_ENV as readonly string[]).includes(name)) return true;
  return PREFIX_ENV.some((prefix) => name.startsWith(prefix));
}

export type EnvForm = {
  publicUrl: string;
  appPort: number;
  postgresPassword: string;
  postgresMajor?: string;
  include: readonly string[];
  source?: Readonly<Record<string, string | undefined>>;
  sourceDatabaseUrl?: string;
  githubToken?: string;
};

export function buildEnv(form: EnvForm): Record<string, string> {
  const source = form.source ?? {};
  const include = new Set(form.include);
  const out: Record<string, string> = {};
  for (const name of Object.keys(source).sort()) {
    if (!include.has(name) || !envNameAllowed(name)) continue;
    const value = source[name]?.trim() ?? "";
    if (!value) continue;
    out[name] = value;
  }
  out.APP_PORT = String(form.appPort);
  out.BETTER_AUTH_URL = form.publicUrl;
  out.BETTER_AUTH_TRUSTED_ORIGINS = form.publicUrl;
  out.POSTGRES_PASSWORD = form.postgresPassword;
  if (form.postgresMajor) out.POSTGRES_MAJOR = form.postgresMajor;
  if (form.sourceDatabaseUrl?.trim()) out.BACKUP_SOURCE_DATABASE_URL = fixNeonUrl(form.sourceDatabaseUrl);
  if (form.githubToken?.trim()) out.BACKUP_GITHUB_TOKEN = form.githubToken.trim();
  delete out.DATABASE_URL;
  return out;
}

export function envPresence(source: Readonly<Record<string, string | undefined>>, names: readonly string[]): { name: string; present: boolean }[] {
  return names.filter(envNameAllowed).map((name) => ({ name, present: Boolean(source[name]?.trim()) }));
}

export function chooseMirror(list: readonly string[], failures: Readonly<Record<string, number>>, limit = 3): string {
  const pending = list.filter((item) => (failures[item] ?? 0) < limit);
  return pending[0] || list[0] || "";
}

export function noteMirrorFailure(failures: Record<string, number>, mirror: string): Record<string, number> {
  return { ...failures, [mirror]: (failures[mirror] ?? 0) + 1 };
}

export function appPortOk(port: number, sshPort: number): boolean {
  return Number.isInteger(port) && port >= 1024 && port <= 65535 && port !== 22 && port !== 443 && port !== 8443 && port !== 5432 && port !== sshPort;
}

export function publicUrlOk(value: string): boolean {
  try {
    const url = new URL(value.trim());
    if (url.username || url.password) return false;
    if (url.protocol === "https:" && url.hostname && !isBlockedHost(url.hostname)) return true;
    if (url.protocol === "http:" && isPublicIp(url.hostname)) return true;
    return false;
  } catch {
    return false;
  }
}

function isPublicIp(host: string): boolean {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host) && !isBlockedHost(host);
}

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (host === "metadata.google.internal" || host === "metadata.google.com") return true;
  const parts = host.split(".").map((item) => Number(item));
  if (parts.length === 4 && parts.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)) {
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }
  return false;
}

export function mirrorUrlOk(value: string): boolean {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password) return false;
    if (isBlockedHost(url.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

export const DEFAULT_MIRRORS = {
  npm: ["https://registry.npmjs.org", "https://registry.npmmirror.com"],
  docker: ["https://mirror.gcr.io"],
  node: ["https://nodejs.org/dist", "https://npmmirror.com/mirrors/node"],
  code: [] as string[],
  ytdlp: [] as string[],
};

export function normalizeMirrors(input: unknown): typeof DEFAULT_MIRRORS {
  const row = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const take = (key: keyof typeof DEFAULT_MIRRORS, fallback: string[]) => {
    const list = Array.isArray(row[key]) ? row[key] : fallback;
    return [...new Set(list.map((item) => String(item).trim()).filter(mirrorUrlOk))].slice(0, 8);
  };
  return {
    npm: take("npm", DEFAULT_MIRRORS.npm),
    docker: take("docker", DEFAULT_MIRRORS.docker),
    node: take("node", DEFAULT_MIRRORS.node),
    code: take("code", []),
    ytdlp: take("ytdlp", []),
  };
}

export function requiredDiskBytes(dbBytes: number, megaBytes: number): number {
  const need = Math.max(0, dbBytes) * 3 + Math.max(0, megaBytes) + 6 * 1024 ** 3;
  return Math.max(15 * 1024 ** 3, need);
}

export type ProbeFacts = {
  os: string;
  version: string;
  arch: string;
  root: boolean;
  sudo: boolean;
  systemd: boolean;
  diskFree: number;
  mem: number;
  swap: number;
  cores: number;
  portBusy: boolean;
  docker: string;
  exists: boolean;
  reach: Record<string, boolean>;
};

export type Check = { key: string; level: "ok" | "warn" | "fail"; text: string };

export function evaluateProbe(facts: ProbeFacts, needBytes: number, overwrite: boolean): { checks: Check[]; canStart: boolean } {
  const checks: Check[] = [];
  const os = facts.os.toLowerCase();
  const major = Number(facts.version.split(".")[0] || 0);
  const osOk = (os === "ubuntu" && major >= 20) || (os === "debian" && major >= 11);
  checks.push(osOk ? { key: "os", level: "ok", text: `${facts.os} ${facts.version}` } : { key: "os", level: "fail", text: "Нужна Ubuntu 20.04+ или Debian 11+" });
  const archOk = facts.arch === "x86_64" || facts.arch === "aarch64";
  checks.push(archOk ? { key: "arch", level: "ok", text: facts.arch } : { key: "arch", level: "fail", text: "Нужна архитектура x86_64 или aarch64" });
  checks.push(facts.root || facts.sudo ? { key: "root", level: "ok", text: facts.root ? "root" : "sudo без пароля" } : { key: "root", level: "fail", text: "Нужен root или sudo без пароля" });
  checks.push(facts.systemd ? { key: "systemd", level: "ok", text: "systemd есть" } : { key: "systemd", level: "fail", text: "На сервере нет systemd" });
  if (facts.mem >= 2 * 1024 ** 3) checks.push({ key: "mem", level: "ok", text: "Памяти достаточно" });
  else if (facts.swap >= 2 * 1024 ** 3) checks.push({ key: "mem", level: "warn", text: "Мало памяти, но swap уже есть" });
  else checks.push({ key: "mem", level: "warn", text: "Мало памяти: создам swap 2 ГБ" });
  checks.push(facts.diskFree >= needBytes ? { key: "disk", level: "ok", text: "Места достаточно" } : { key: "disk", level: "fail", text: "Мало свободного места" });
  checks.push(facts.portBusy ? { key: "port", level: "fail", text: "Порт сайта уже занят" } : { key: "port", level: "ok", text: "Порт сайта свободен" });
  checks.push(facts.docker ? { key: "docker", level: "ok", text: `Docker ${facts.docker}` } : { key: "docker", level: "warn", text: "Docker поставлю во время переноса" });
  if (facts.exists && !overwrite) checks.push({ key: "exists", level: "fail", text: "Каталог уже есть: включите перезапись" });
  else checks.push({ key: "exists", level: "ok", text: facts.exists ? "Каталог будет перезаписан" : "Каталог свободен" });
  for (const [name, ok] of Object.entries(facts.reach)) {
    checks.push(ok ? { key: `reach-${name}`, level: "ok", text: `${name} доступен` } : { key: `reach-${name}`, level: "warn", text: `${name} с сервера не открылся` });
  }
  return { checks, canStart: checks.every((item) => item.level !== "fail") };
}

export function compareCounts(source: Record<string, number>, copy: Record<string, number>, keys: readonly string[]) {
  const rows: { key: string; source: number; copy: number; diff: number; level: "ok" | "warn" | "fail" }[] = [];
  for (const key of keys) {
    const a = source[key] ?? 0;
    const b = copy[key] ?? 0;
    const diff = Math.abs(a - b);
    const tol = Math.max(20, Math.ceil(a * 0.01));
    rows.push({ key, source: a, copy: b, diff, level: diff === 0 ? "ok" : diff <= tol ? "warn" : "fail" });
  }
  return { rows, failed: rows.some((row) => row.level === "fail") };
}

export function classifyRestore(text: string): { failed: boolean; warnings: string[] } {
  const warnings: string[] = [];
  let failed = false;
  for (const line of text.split("\n")) {
    const row = line.trim();
    if (!row) continue;
    if (/extension .* is not available|role .* does not exist|could not open extension/i.test(row)) warnings.push(row.slice(0, 240));
    else if (/relation .* does not exist/i.test(row)) failed = true;
  }
  return { failed, warnings: warnings.slice(0, 20) };
}

export function volumeAction(existingMajor: string, wanted: string, volumeEmpty: boolean): "keep" | "drop" | "stop" {
  if (!existingMajor || existingMajor === wanted) return "keep";
  return volumeEmpty ? "drop" : "stop";
}

export function dumpPercent(bytes: number, dbBytes: number, finished: boolean): number {
  if (finished) return 100;
  if (dbBytes <= 0) return bytes > 0 ? 10 : 0;
  return Math.min(95, Math.round((bytes / (dbBytes * 0.35)) * 100));
}

export function confirmWordOk(value: string): boolean {
  const word = value.trim();
  return word === CONFIRM_WORD || word.toUpperCase() === CONFIRM_WORD_EN;
}

export function deleteWordOk(value: string): boolean {
  return value.trim().toUpperCase() === DELETE_WORD;
}

export function randomPassword(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return [...bytes].map((item) => alphabet[item % alphabet.length]).join("");
}

export function postgresMajorOf(versionNum: string): string {
  const num = Number(versionNum);
  if (!Number.isFinite(num) || num < 10000) return "";
  return String(Math.floor(num / 10000));
}

export function pgDumpArgs(image: string, file: string): string[] {
  return ["run", "--rm", "--network", "host", "-e", "PGPASSWORD", "-v", "/opt/vvvion/backup:/out", image, "pg_dump", "-Fc", "--no-owner", "--no-acl", "--no-comments", "-f", `/out/${file}`];
}

export function parseProbe(text: string): ProbeFacts {
  const map: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const index = line.indexOf("=");
    if (index <= 0) continue;
    map[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  const reach: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(map)) {
    if (key.startsWith("reach_")) reach[key.slice(6)] = value === "1";
  }
  return {
    os: map.os || "",
    version: map.version || "0",
    arch: map.arch || "",
    root: map.root === "1",
    sudo: map.sudo === "1",
    systemd: map.systemd === "1",
    diskFree: Number(map.disk || 0),
    mem: Number(map.mem || 0),
    swap: Number(map.swap || 0),
    cores: Number(map.cores || 0),
    portBusy: map.port === "1",
    docker: map.docker || "",
    exists: map.exists === "1",
    reach,
  };
}

export function staleLabel(seconds: number): "ok" | "quiet" | "stalled" {
  if (seconds >= 15 * 60) return "stalled";
  if (seconds >= 3 * 60) return "quiet";
  return "ok";
}
