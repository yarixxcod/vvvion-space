import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import {
  appPortOk,
  buildEnv,
  confirmWordOk,
  deleteWordOk,
  envAllowlist,
  envNameAllowed,
  envPresence,
  maskHost,
  normalizeMirrors,
  publicUrlOk,
  randomPassword,
  requiredDiskBytes,
} from "@/lib/backup/plan";
import { sshPortOk, sshUserOk } from "@/lib/social/mega-plan";

function denied(): never {
  throw new Error("Недостаточно прав");
}

function bad(): never {
  throw new Error("Данные не подходят");
}

function simulateOn(): boolean {
  return process.env.BACKUP_SIMULATE === "1" && !(process.env.VERCEL && process.env.NODE_ENV === "production");
}

async function admin(userId: string) {
  const { assertAdmin } = await import("@/lib/social/access");
  try {
    await assertAdmin(userId);
  } catch {
    denied();
  }
}

export const backupEnvList = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await admin(context.userId);
    const names = Object.keys(process.env).filter(envNameAllowed).sort();
    const known = [...new Set([...envAllowlist(), ...names])].sort();
    return { names: envPresence(process.env, known), simulate: simulateOn() };
  });

export const backupProbe = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => input)
  .handler(async ({ context, data }) => {
    await admin(context.userId);
    const form = readTarget(data);
    if (simulateOn()) {
      return {
        needConfirm: !form.hostKey,
        fingerprint: form.hostKey ? undefined : "SHA256:SIMULATEDFINGERPRINT",
        checks: form.hostKey ? [{ key: "os", level: "ok" as const, text: "Ubuntu 22.04" }, { key: "mem", level: "warn" as const, text: "Мало памяти: создам swap 2 ГБ" }] : [],
        canStart: Boolean(form.hostKey),
      };
    }
    const { probeServer } = await import("@/lib/backup/ssh.server");
    const neon = neonHost();
    return probeServer({ host: form.host, port: form.sshPort, username: form.user, secret: form.secret, hostKey: form.hostKey, appPort: form.appPort }, requiredDiskBytes(0, 0), form.overwrite, neon);
  });

export const backupStart = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => input)
  .handler(async ({ context, data }) => {
    await admin(context.userId);
    const form = readTarget(data);
    if (!confirmWordOk(form.confirm)) bad();
    if (!form.hostKey || !publicUrlOk(form.publicUrl)) bad();
    const { createJob, withDb } = await import("@/lib/backup/jobs.server");
    const created = await withDb((db) => createJob(db, {
      userId: context.userId,
      hostMasked: maskHost(form.host),
      sshPort: form.sshPort,
      sshUser: form.user,
      appPort: form.appPort,
      publicUrl: form.publicUrl,
      options: { code: form.code, database: form.database, settings: form.settings, mega: form.mega, commit: form.commit, latest: form.latest, overwrite: form.overwrite },
    }));
    if ("error" in created) throw new Error("Уже идёт другой перенос");
    const env = buildEnv({
      publicUrl: form.publicUrl,
      appPort: form.appPort,
      postgresPassword: randomPassword(),
      include: form.include,
      source: process.env,
      sourceDatabaseUrl: form.databaseUrl || process.env.DATABASE_URL,
      githubToken: form.github,
    });
    if (simulateOn()) {
      const { startSimulation } = await import("@/lib/backup/simulate.server");
      startSimulation(created.id, created.token, form.fail);
      return { ok: true, id: created.id };
    }
    try {
      const { launchAgent } = await import("@/lib/backup/ssh.server");
      const origin = form.origin || process.env.BETTER_AUTH_URL || "";
      const commit = form.latest ? "" : (form.commit || process.env.VERCEL_GIT_COMMIT_SHA || "");
      await launchAgent(
        { host: form.host, port: form.sshPort, username: form.user, secret: form.secret, hostKey: form.hostKey, appPort: form.appPort },
        {
          job: { id: created.id, token: created.token, site: origin, commit, branch: "uiux-polish-3.0.1", latest: form.latest, appPort: form.appPort, options: { code: form.code, database: form.database, settings: form.settings, mega: form.mega }, mirrors: form.mirrors },
          envText: renderEnv(env),
        },
      );
      const { readJob, withDb: again } = await import("@/lib/backup/jobs.server");
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        const row = await again((db) => readJob(db, created.id));
        if (row?.heartbeat_at) break;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Перенос не запустился";
      const { failJob, withDb: dbOf } = await import("@/lib/backup/jobs.server");
      await dbOf((db) => failJob(db, created.id, message)).catch(() => undefined);
      throw new Error(message.slice(0, 180));
    }
    return { ok: true, id: created.id };
  });

export const backupStatus = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => input)
  .handler(async ({ context, data }) => {
    await admin(context.userId);
    const id = data && typeof data === "object" && typeof (data as { id?: unknown }).id === "string" ? (data as { id: string }).id : undefined;
    const { jobView, withDb } = await import("@/lib/backup/jobs.server");
    return withDb((db) => jobView(db, id));
  });

export const backupCommand = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => input)
  .handler(async ({ context, data }) => {
    await admin(context.userId);
    const row = asRecord(data);
    const jobId = String(row.id || "");
    const command = String(row.command || "");
    if (!/^[a-z0-9:-]{3,40}$/.test(command)) bad();
    const { queueCommand, withDb } = await import("@/lib/backup/jobs.server");
    return withDb((db) => queueCommand(db, jobId, command));
  });

export const backupHistory = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await admin(context.userId);
    const { history, withDb } = await import("@/lib/backup/jobs.server");
    return withDb((db) => history(db));
  });

export const backupSettings = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => input)
  .handler(async ({ context, data }) => {
    await admin(context.userId);
    const mirrors = normalizeMirrors(asRecord(data).mirrors ?? data);
    const { withDb } = await import("@/lib/backup/jobs.server");
    await withDb((db) => db.query("update backup_settings set mirrors = $1::jsonb, updated_at = now() where id = 1", [JSON.stringify(mirrors)]));
    return { mirrors };
  });

export const backupLoadSettings = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await admin(context.userId);
    const { withDb } = await import("@/lib/backup/jobs.server");
    const rows = await withDb((db) => db.query<{ mirrors: unknown }>("select mirrors from backup_settings where id = 1"));
    return { mirrors: normalizeMirrors(rows[0]?.mirrors) };
  });

export const backupForget = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => input)
  .handler(async ({ context, data }) => {
    await admin(context.userId);
    const id = String(asRecord(data).id || "");
    const { removeHistory, withDb } = await import("@/lib/backup/jobs.server");
    return withDb((db) => removeHistory(db, id));
  });

export const backupLink = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => input)
  .handler(async ({ context, data }) => {
    await admin(context.userId);
    const form = readTarget(data);
    if (simulateOn()) return { text: "active\nимитация: служба отвечает" };
    const { serviceStatus } = await import("@/lib/backup/ssh.server");
    const text = await serviceStatus({ host: form.host, port: form.sshPort, username: form.user, secret: form.secret, hostKey: form.hostKey, appPort: form.appPort });
    return { text };
  });

export const backupWipe = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => input)
  .handler(async ({ context, data }) => {
    await admin(context.userId);
    const form = readTarget(data);
    if (!deleteWordOk(form.confirm)) bad();
    if (simulateOn()) return { ok: true };
    const { wipeServer } = await import("@/lib/backup/ssh.server");
    await wipeServer({ host: form.host, port: form.sshPort, username: form.user, secret: form.secret, hostKey: form.hostKey, appPort: form.appPort });
    return { ok: true };
  });

export const backupSchedule = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => input)
  .handler(async ({ context, data }) => {
    await admin(context.userId);
    const form = readTarget(data);
    if (simulateOn()) return { ok: true };
    const { setSchedule } = await import("@/lib/backup/ssh.server");
    await setSchedule(
      { host: form.host, port: form.sshPort, username: form.user, secret: form.secret, hostKey: form.hostKey, appPort: form.appPort },
      form.enable,
      process.env.CRON_SECRET || process.env.PUSH_CRON_SECRET || "",
    );
    return { ok: true };
  });

function asRecord(data: unknown): Record<string, unknown> {
  return data && typeof data === "object" ? data as Record<string, unknown> : {};
}

function readTarget(data: unknown) {
  const row = asRecord(data);
  const host = String(row.host || "").trim();
  const sshPort = Number(row.sshPort || 22);
  const user = String(row.user || "root").trim();
  const secret = String(row.secret || "");
  const appPort = Number(row.appPort || 3000);
  const hostKey = String(row.hostKey || "");
  if (!host || !secret || !sshUserOk(user) || !sshPortOk(sshPort) || !appPortOk(appPort, sshPort)) bad();
  return {
    host,
    sshPort,
    user,
    secret,
    appPort,
    hostKey,
    publicUrl: String(row.publicUrl || "").trim(),
    confirm: String(row.confirm || ""),
    code: row.code !== false,
    database: row.database !== false,
    settings: row.settings !== false,
    mega: row.mega === true,
    overwrite: row.overwrite === true,
    latest: row.latest === true,
    commit: String(row.commit || "").trim(),
    include: Array.isArray(row.include) ? row.include.map(String).filter(envNameAllowed) : envAllowlist(),
    github: String(row.github || ""),
    databaseUrl: String(row.databaseUrl || ""),
    origin: String(row.origin || ""),
    mirrors: normalizeMirrors(row.mirrors),
    fail: row.fail === true,
    enable: row.enable !== false,
  };
}

function renderEnv(map: Record<string, string>): string {
  return Object.entries(map).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n") + "\n";
}

function neonHost(): string {
  try {
    return new URL(process.env.DATABASE_URL || "").hostname.replace(/-pooler(?=\.)/g, "");
  } catch {
    return "";
  }
}
