import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { getSql } from "@/lib/db";
import { lookupPublic } from "@/lib/security/net-guard";
import { hostFingerprint, hostKeyMatches } from "@/lib/social/mega-host-key";
import { type ConnectPlan } from "./connect-plan";
import { connectNodeToken } from "./connect-token.server";
import agentSource from "../../../scripts/connect/agent.py?raw";
import bootstrapSource from "../../../scripts/connect/bootstrap.py?raw";
const require = createRequire(import.meta.url);
const ROOT = "/opt/vvvion-connect";
type Conn = {
  on: (name: string, callback: (value?: any) => void) => void;
  connect: (options: Record<string, unknown>) => void;
  end: () => void;
  exec: (command: string, callback: (error: Error | null, stream: any) => void) => void;
  sftp: (callback: (error: Error | null, sftp: any) => void) => void;
};
async function session(
  plan: ConnectPlan,
  scan = false,
): Promise<{ conn: Conn; fingerprint: string }> {
  const [address] = await lookupPublic(plan.host);
  const mod = require("ssh2") as { Client: new () => Conn };
  const conn = new mod.Client();
  return new Promise((resolve, reject) => {
    let settled = false;
    let fingerprint = "";
    const timer = setTimeout(() => finish(new Error("Сервер не ответил по SSH")), 15000);
    function finish(error?: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        conn.end();
        reject(error);
      } else resolve({ conn, fingerprint });
    }
    conn.on("error", () =>
      finish(new Error("SSH: проверьте адрес, пароль или ключ и отпечаток сервера")),
    );
    conn.on("ready", () => finish());
    conn.connect({
      host: address,
      port: plan.sshPort,
      username: plan.username,
      readyTimeout: 12000,
      password: scan
        ? undefined
        : /BEGIN [A-Z0-9 ]*PRIVATE KEY/.test(plan.secret)
          ? undefined
          : plan.secret,
      privateKey: scan
        ? undefined
        : /BEGIN [A-Z0-9 ]*PRIVATE KEY/.test(plan.secret)
          ? plan.secret
          : undefined,
      hostVerifier: (key: Buffer) => {
        fingerprint = hostFingerprint(key);
        if (scan) {
          finish();
          queueMicrotask(() => conn.end());
          return false;
        }
        return hostKeyMatches(plan.fingerprint, key);
      },
    });
  });
}
function command(conn: Conn, text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      conn.end();
      reject(new Error("SSH-команда не завершилась"));
    }, 20000);
    conn.exec(text, (error, stream) => {
      if (error) {
        clearTimeout(timer);
        reject(new Error("Команда SSH не запустилась"));
        return;
      }
      let out = "";
      stream.on("data", (data: Buffer) => {
        out = (out + data.toString()).slice(-16000);
      });
      stream.on("close", (code: number) => {
        clearTimeout(timer);
        if (code !== 0)
          reject(
            new Error(
              "Проверка сервера не пройдена: нужен отдельный Debian/Ubuntu VPS, root, Python 3, systemd и свободный порт",
            ),
          );
        else resolve(out);
      });
      stream.on("error", () => {
        clearTimeout(timer);
        reject(new Error("Команда SSH прервана"));
      });
    });
  });
}
function write(conn: Conn, path: string, value: string): Promise<void> {
  return new Promise((resolve, reject) => {
    conn.sftp((error, sftp) => {
      if (error) {
        reject(new Error("SFTP недоступен"));
        return;
      }
      sftp.writeFile(path, Buffer.from(value), { mode: 0o600 }, (err: Error | null) => {
        sftp.end();
        if (err) reject(new Error("Файл установщика не записался"));
        else resolve();
      });
    });
  });
}
function preflight(plan: ConnectPlan) {
  return `set -eu
[ "$(id -u)" = 0 ]
command -v systemctl >/dev/null
command -v python3 >/dev/null
command -v apt-get >/dev/null
[ ! -e /opt/vvvion-connect ]
[ ! -e /etc/sing-box/config.json ]
! systemctl is-active --quiet sing-box.service
python3 - <<'CONNECT_CHECK'
import socket,shutil,os
assert shutil.disk_usage('/opt').free > 3*1024**3
assert os.sysconf('SC_PAGE_SIZE')*os.sysconf('SC_PHYS_PAGES') >= 700*1024**2
s=socket.socket(socket.AF_INET6,${plan.protocol === "hy2" ? "socket.SOCK_DGRAM" : "socket.SOCK_STREAM"})
s.bind(('::',${plan.port}));s.close()
s=socket.socket();s.bind(('127.0.0.1',10085));s.close()
CONNECT_CHECK
`;
}
export async function probeServer(data: ConnectPlan) {
  if (!data.fingerprint) {
    const { conn, fingerprint } = await session(data, true);
    conn.end();
    return { fingerprint, ready: false };
  }
  const { conn, fingerprint } = await session(data);
  try {
    await command(conn, preflight(data));
    return { fingerprint, ready: true };
  } finally {
    conn.end();
  }
}
export async function installServer(data: ConnectPlan) {
  if (!data.fingerprint) throw Error("Сначала проверьте и подтвердите отпечаток SSH");
  // Resolve all public endpoints before an authenticated SSH connection; pin its IP.
  await lookupPublic(data.handshake);
  const id = crypto.randomUUID(),
    token = connectNodeToken(id);
  const { conn } = await session(data);
  const sql = await getSql();
  let inserted = false;
  try {
    await command(conn, preflight(data));
    await sql`insert into vpn_nodes(id,name,uri,host,protocol,country,city,enabled,maintenance,shared_cut,load_note) values(${id},${data.name},${"connect-pending://" + id},${data.host},${data.protocol},${data.country},${data.city},false,true,true,'Установка: подготовка')`;
    inserted = true;
    await command(conn, `umask 077; mkdir ${ROOT}`);
    const { secret: _secret, fingerprint: _fingerprint, ...plan } = data;
    plan.shortId = plan.shortId || randomBytes(8).toString("hex");
    // Production endpoint is fixed; credentials are never forwarded to a client-supplied URL.
    const settings = {
      nodeId: id,
      url: "https://vvvion.space/api/vpn-agent",
      token,
      protocol: data.protocol,
      plan,
    };
    await write(conn, ROOT + "/settings.json", JSON.stringify(settings));
    await write(conn, ROOT + "/agent.py", agentSource);
    await write(conn, ROOT + "/bootstrap.py", bootstrapSource);
    await command(
      conn,
      `systemd-run --unit=vvvion-connect-install-${id} --property=RuntimeMaxSec=3600 /usr/bin/python3 ${ROOT}/bootstrap.py`,
    );
    return { nodeId: id };
  } catch (error) {
    if (inserted)
      await sql`update vpn_nodes set last_error='Установка не запущена. Проверьте SSH и свободный VPS',load_note='Ошибка запуска установки' where id=${id}`;
    throw error;
  } finally {
    conn.end();
  }
}
