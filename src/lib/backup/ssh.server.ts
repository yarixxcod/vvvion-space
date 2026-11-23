import { createRequire } from "node:module";
import agentSource from "../../../scripts/backup-agent.mjs?raw";
import { hostFingerprint, hostKeyMatches } from "@/lib/social/mega-host-key";
import { sshPortOk, sshUserOk } from "@/lib/social/mega-plan";
import { lookupPublic } from "@/lib/security/net-guard";
import {
  NODE_VERSION,
  appPortOk,
  evaluateProbe,
  parseProbe,
  scrub,
  type ProbeFacts,
} from "@/lib/backup/plan";
import { secretValues } from "@/lib/backup/jobs.server";

const require = createRequire(import.meta.url);

type Conn = {
  on: (event: string, cb: (err?: Error) => void) => void;
  connect: (options: Record<string, unknown>) => void;
  exec: (command: string, cb: (err: Error | null, stream: ExecStream) => void) => void;
  sftp: (cb: (err: Error | null, sftp: { writeFile: (path: string, data: Buffer, cb: (err: Error | null) => void) => void }) => void) => void;
  end: () => void;
};

type ExecStream = {
  on: (event: string, cb: (chunk: Buffer | number) => void) => void;
  stderr: { on: (event: string, cb: (chunk: Buffer) => void) => void };
};

export type BackupTarget = {
  host: string;
  port: number;
  username: string;
  secret: string;
  hostKey?: string;
  appPort: number;
};

export const UNIT = `[Unit]
Description=VVVion site migrate
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
WorkingDirectory=/opt/vvvion/.migrate
ExecStart=/opt/vvvion/node/bin/node /opt/vvvion/.migrate/agent.mjs run
Restart=on-failure
RestartSec=20
StartLimitIntervalSec=86400
StartLimitBurst=12
[Install]
WantedBy=multi-user.target
`;

export const BOOTSTRAP = `#!/bin/sh
set -eu
if [ -x /opt/vvvion/node/bin/node ]; then exit 0; fi
if command -v apt-get >/dev/null 2>&1; then
  apt-get update
  apt-get install -y --no-install-recommends curl ca-certificates tar xz-utils
fi
arch=$(uname -m)
case "$arch" in
  x86_64) nodearch=linux-x64 ;;
  aarch64) nodearch=linux-arm64 ;;
  *) echo unsupported-arch; exit 1 ;;
esac
ver=${NODE_VERSION}
name=node-v$ver-$nodearch.tar.xz
ok=0
for base in https://nodejs.org/dist https://npmmirror.com/mirrors/node; do
  curl -fsSL --max-time 60 "$base/v$ver/$name" -o /tmp/node.tar.xz || continue
  sums=$(curl -fsSL --max-time 30 "$base/v$ver/SHASUMS256.txt" || true)
  if [ -z "$sums" ]; then echo sum-mirror; 
  else
    echo "$sums" | awk -v f="$name" '$2==f{print $1"  /tmp/node.tar.xz"}' | sha256sum -c - || continue
  fi
  mkdir -p /opt/vvvion/node
  tar -xJf /tmp/node.tar.xz -C /opt/vvvion/node --strip-components=1
  ok=1
  break
done
test "$ok" = 1
`;

function keyMaterial(secret: string): boolean {
  return /BEGIN [A-Z0-9 ]*PRIVATE KEY/.test(secret);
}

function explain(error: unknown, secret: string): Error {
  const raw = error instanceof Error ? error.message : "SSH не открылся";
  const text = scrub(raw, [secret]);
  if (/host key|fingerprint|verification failed/i.test(text)) return new Error("Отпечаток сервера не совпал");
  if (/authentication|auth fail|all configured/i.test(text)) return new Error("Логин или пароль не подошли");
  if (/timed out|timeout/i.test(text)) return new Error("Сервер не ответил по SSH");
  if (/ECONNREFUSED/i.test(text)) return new Error("Порт SSH закрыт");
  if (/ENOTFOUND|EAI_AGAIN|EHOSTUNREACH/i.test(text)) return new Error("Сервер по этому адресу не находится");
  if (text.includes("no-systemd")) return new Error("На сервере нет systemd");
  return new Error(text.slice(0, 180) || "SSH не открылся");
}

async function client(): Promise<Conn> {
  const mod = require("ssh2") as { Client?: new () => Conn };
  if (!mod.Client) throw new Error("SSH-клиент не собрался");
  return new mod.Client();
}

function connect(conn: Conn, target: BackupTarget): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      conn.end();
      reject(new Error("Сервер не ответил по SSH"));
    }, 20_000);
    conn.on("ready", () => {
      clearTimeout(timer);
      resolve();
    });
    conn.on("error", (error) => {
      clearTimeout(timer);
      reject(error ?? new Error("SSH не открылся"));
    });
    const key = keyMaterial(target.secret);
    conn.connect({
      host: target.host,
      port: target.port,
      username: target.username,
      password: key ? undefined : target.secret,
      privateKey: key ? target.secret : undefined,
      readyTimeout: 15_000,
      hostVerifier: (seen: Buffer) => Boolean(target.hostKey) && hostKeyMatches(target.hostKey || "", seen),
    });
  });
}

export function peekBackupKey(target: BackupTarget): Promise<string> {
  return new Promise((resolve, reject) => {
    void client().then((conn) => {
      const timer = setTimeout(() => {
        conn.end();
        reject(new Error("Сервер не ответил по SSH"));
      }, 12_000);
      let done = false;
      conn.on("error", (error) => {
        if (!done) {
          clearTimeout(timer);
          reject(error ?? new Error("SSH не открылся"));
        }
      });
      conn.connect({
        host: target.host,
        port: target.port,
        username: target.username,
        password: "probe",
        readyTimeout: 10_000,
        hostVerifier: (seen: Buffer) => {
          if (done) return false;
          done = true;
          clearTimeout(timer);
          resolve(hostFingerprint(seen));
          conn.end();
          return false;
        },
      });
    }).catch(reject);
  });
}

function exec(conn: Conn, command: string): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve, reject) => {
    conn.exec(command, (error, stream) => {
      if (error || !stream) {
        reject(error ?? new Error("Команда не запустилась"));
        return;
      }
      let out = "";
      let err = "";
      stream.on("data", (chunk) => {
        if (typeof chunk !== "number") out += chunk.toString("utf8");
      });
      stream.stderr.on("data", (chunk) => {
        err += chunk.toString("utf8");
      });
      stream.on("close", (code) => resolve({ code: typeof code === "number" ? code : 1, out, err }));
    });
  });
}

function writeFile(conn: Conn, path: string, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    conn.sftp((error, sftp) => {
      if (error || !sftp) {
        reject(error ?? new Error("Файл не записался"));
        return;
      }
      sftp.writeFile(path, data, (writeError) => (writeError ? reject(writeError) : resolve()));
    });
  });
}

function probeScript(appPort: number, neonHost: string): string {
  const hosts = ["github.com", "codeload.github.com", "nodejs.org", "registry.npmjs.org", "registry.npmmirror.com", "registry-1.docker.io", "get.docker.com"];
  const reach = hosts.map((host) => `if curl -fsS -o /dev/null --max-time 8 https://${host}; then echo reach_${host}=1; else echo reach_${host}=0; fi`).join("\n");
  const neon = neonHost ? `if timeout 8 bash -c 'echo >/dev/tcp/${neonHost}/5432'; then echo reach_neon=1; else echo reach_neon=0; fi` : "";
  return `set +e
. /etc/os-release
echo os=$ID
echo version=$VERSION_ID
echo arch=$(uname -m)
if [ "$(id -u)" = 0 ]; then echo root=1; else echo root=0; fi
sudo -n true >/dev/null 2>&1 && echo sudo=1 || echo sudo=0
command -v systemctl >/dev/null && echo systemd=1 || echo systemd=0
echo disk=$(df -B1 /opt 2>/dev/null | awk 'NR==2{print $4}')
echo mem=$(awk '/MemTotal/{print $2*1024}' /proc/meminfo)
echo swap=$(awk '/SwapTotal/{print $2*1024}' /proc/meminfo)
echo cores=$(nproc)
if ss -ltn | awk '{print $4}' | grep -q ':${appPort}$'; then echo port=1; else echo port=0; fi
docker version --format '{{.Server.Version}}' 2>/dev/null | awk 'NR==1{print "docker="$0}'
if [ -d /opt/vvvion ] || docker ps -a --format '{{.Names}}' | grep -q vvvion; then echo exists=1; else echo exists=0; fi
${reach}
${neon}
`;
}

export async function probeServer(target: BackupTarget, needBytes: number, overwrite: boolean, neonHost = ""): Promise<{ needConfirm?: boolean; fingerprint?: string; checks: { key: string; level: "ok" | "warn" | "fail"; text: string }[]; canStart: boolean }> {
  await guardTarget(target);
  if (!target.hostKey) {
    const fingerprint = await peekBackupKey(target);
    return { needConfirm: true, fingerprint, checks: [], canStart: false };
  }
  const conn = await client();
  try {
    await connect(conn, target);
    const systemd = await exec(conn, "command -v systemctl || true");
    if (!systemd.out.includes("systemctl")) throw new Error("no-systemd");
    const ran = await exec(conn, probeScript(target.appPort, /^[a-z0-9.-]+$/i.test(neonHost) ? neonHost : ""));
    const facts: ProbeFacts = parseProbe(ran.out);
    return evaluateProbe(facts, needBytes, overwrite);
  } catch (error) {
    throw explain(error, target.secret);
  } finally {
    conn.end();
  }
}

export async function launchAgent(target: BackupTarget, files: { job: unknown; envText: string }): Promise<void> {
  await guardTarget(target);
  if (!target.hostKey) throw new Error("Отпечаток сервера не подтверждён");
  const conn = await client();
  try {
    await connect(conn, target);
    const systemd = await exec(conn, "command -v systemctl || true");
    if (!systemd.out.includes("systemctl")) throw new Error("no-systemd");
    const ready = await exec(conn, "mkdir -p /opt/vvvion/.migrate /opt/vvvion/backup && chmod 700 /opt/vvvion/.migrate");
    if (ready.code !== 0) throw new Error("Каталог на сервере не создался");
    await writeFile(conn, "/opt/vvvion/.migrate/agent.mjs", Buffer.from(agentSource, "utf8"));
    await writeFile(conn, "/opt/vvvion/.migrate/job.json", Buffer.from(JSON.stringify(files.job), "utf8"));
    await writeFile(conn, "/opt/vvvion/.migrate/.env", Buffer.from(files.envText, "utf8"));
    await writeFile(conn, "/opt/vvvion/.migrate/bootstrap.sh", Buffer.from(BOOTSTRAP, "utf8"));
    await writeFile(conn, "/etc/systemd/system/vvvion-migrate.service", Buffer.from(UNIT, "utf8"));
    const started = await exec(conn, "chmod 600 /opt/vvvion/.migrate/.env /opt/vvvion/.migrate/job.json && chmod 755 /opt/vvvion/.migrate/bootstrap.sh && sh /opt/vvvion/.migrate/bootstrap.sh && systemctl daemon-reload && systemctl enable --now vvvion-migrate");
    if (started.code !== 0) throw new Error(started.err || started.out || "Служба не запустилась");
  } catch (error) {
    throw explain(error, target.secret);
  } finally {
    conn.end();
  }
}

export async function serviceStatus(target: BackupTarget): Promise<string> {
  await guardTarget(target);
  if (!target.hostKey) throw new Error("Отпечаток сервера не подтверждён");
  const conn = await client();
  try {
    await connect(conn, target);
    const ran = await exec(conn, "systemctl is-active vvvion-migrate || true; journalctl -u vvvion-migrate -n 30 --no-pager || true");
    return scrub(`${ran.out}\n${ran.err}`, [target.secret, ...secretValues()]).slice(0, 2000);
  } catch (error) {
    throw explain(error, target.secret);
  } finally {
    conn.end();
  }
}

export async function wipeServer(target: BackupTarget): Promise<void> {
  await guardTarget(target);
  if (!target.hostKey) throw new Error("Отпечаток сервера не подтверждён");
  const conn = await client();
  try {
    await connect(conn, target);
    const ran = await exec(conn, "if [ -d /opt/vvvion/src ]; then docker compose -f /opt/vvvion/src/docker-compose.yml down -v || true; fi; systemctl disable --now vvvion-migrate || true; rm -rf /opt/vvvion /etc/systemd/system/vvvion-migrate.service /var/lib/vvvion-mirror; systemctl daemon-reload || true");
    if (ran.code !== 0) throw new Error("Сервер не очистился");
  } catch (error) {
    throw explain(error, target.secret);
  } finally {
    conn.end();
  }
}

export async function setSchedule(target: BackupTarget, enabled: boolean, secret: string): Promise<void> {
  await guardTarget(target);
  if (!target.hostKey) throw new Error("Отпечаток сервера не подтверждён");
  if (enabled && secret.trim().length < 8) throw new Error("Секрет расписания на сайте не задан");
  const conn = await client();
  const timer = (name: string, hour: string) => `[Unit]
Description=VVVion ${name}
[Timer]
OnCalendar=*-*-* ${hour}:00:00
Persistent=true
[Install]
WantedBy=timers.target
`;
  const service = (path: string) => `[Unit]
Description=VVVion local cron
[Service]
Type=oneshot
EnvironmentFile=/opt/vvvion/.migrate/cron.env
ExecStart=/opt/vvvion/node/bin/node -e "fetch('http://127.0.0.1:${target.appPort}${path}',{headers:{authorization:'Bearer '+process.env.CRON_SECRET}}).then((res)=>process.exit(res.ok?0:1)).catch(()=>process.exit(1))"
`;
  try {
    await connect(conn, target);
    if (!enabled) {
      await exec(conn, "systemctl disable --now vvvion-cron-push.timer vvvion-cron-pay.timer || true; rm -f /etc/systemd/system/vvvion-cron-push.timer /etc/systemd/system/vvvion-cron-pay.timer /etc/systemd/system/vvvion-cron-push.service /etc/systemd/system/vvvion-cron-pay.service /opt/vvvion/.migrate/cron.env; systemctl daemon-reload || true");
      return;
    }
    await exec(conn, "mkdir -p /opt/vvvion/.migrate && chmod 700 /opt/vvvion/.migrate");
    await writeFile(conn, "/opt/vvvion/.migrate/cron.env", Buffer.from(`CRON_SECRET=${secret}\n`, "utf8"));
    await exec(conn, "chmod 600 /opt/vvvion/.migrate/cron.env");
    await writeFile(conn, "/etc/systemd/system/vvvion-cron-push.timer", Buffer.from(timer("push", "03"), "utf8"));
    await writeFile(conn, "/etc/systemd/system/vvvion-cron-push.service", Buffer.from(service("/api/push/cron"), "utf8"));
    await writeFile(conn, "/etc/systemd/system/vvvion-cron-pay.timer", Buffer.from(timer("pay", "04"), "utf8"));
    await writeFile(conn, "/etc/systemd/system/vvvion-cron-pay.service", Buffer.from(service("/api/cron/cryptopay-reconcile"), "utf8"));
    const ran = await exec(conn, "systemctl daemon-reload && systemctl enable --now vvvion-cron-push.timer vvvion-cron-pay.timer");
    if (ran.code !== 0) throw new Error("Расписание не включилось");
  } catch (error) {
    throw new Error(scrub(explain(error, target.secret).message, [secret]));
  } finally {
    conn.end();
  }
}

async function guardTarget(target: BackupTarget): Promise<void> {
  if (!sshUserOk(target.username) || !sshPortOk(target.port) || !appPortOk(target.appPort, target.port)) throw new Error("Данные сервера не подходят");
  await lookupPublic(target.host);
}

export function agentText(): string {
  return agentSource;
}
