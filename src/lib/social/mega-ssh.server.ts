import { createRequire } from "node:module";
import { AGENT_SOURCE, diskNameOk, installShell, unitText } from "@/lib/social/mega-plan";

const require = createRequire(import.meta.url);

type Conn = {
  on: (event: string, cb: (err?: Error) => void) => void;
  connect: (options: {
    host: string;
    port: number;
    username: string;
    password: string;
    readyTimeout: number;
    hostVerifier: () => boolean;
  }) => void;
  exec: (command: string, cb: (err: Error | null, stream: ExecStream) => void) => void;
  sftp: (cb: (err: Error | null, sftp: { writeFile: (path: string, data: Buffer, cb: (err: Error | null) => void) => void }) => void) => void;
  end: () => void;
};

type ExecStream = {
  on: (event: string, cb: (chunk: Buffer | number) => void) => void;
  stderr: { on: (event: string, cb: (chunk: Buffer) => void) => void };
};

export type SshTarget = {
  host: string;
  port: number;
  username: string;
  password: string;
  disk: string;
  agentPort: number;
  token: string;
};

function scrub(text: string, token: string): string {
  return text.replaceAll(token, "…").replace(/\s+/g, " ").trim().slice(0, 180);
}

function explain(error: unknown, token: string): Error {
  const raw = error instanceof Error ? error.message : "SSH не открылся";
  const text = scrub(raw, token);
  if (/authentication|auth fail|all configured/i.test(text)) return new Error("Логин или пароль не подошли");
  if (/timed out|timeout/i.test(text)) return new Error("Сервер не ответил по SSH");
  if (/ECONNREFUSED/i.test(text)) return new Error("Порт SSH закрыт");
  if (/ENOTFOUND|EAI_AGAIN|EHOSTUNREACH/i.test(text)) return new Error("Сервер по этому адресу не находится");
  if (/cannot find module/i.test(text) && /ssh2/i.test(text)) return new Error("Клиент связи с сервером не попал в сборку");
  if (text.includes("no-python")) return new Error("На сервере нет python3");
  if (text.includes("no-systemd")) return new Error("На сервере нет systemd, скрипт некуда поставить");
  return new Error(text || "SSH не открылся");
}

async function client(): Promise<Conn> {
  const mod = require("ssh2") as { Client?: new () => Conn };
  const Client = mod.Client;
  if (!Client) throw new Error("SSH-клиент не собрался");
  return new Client();
}

function connect(conn: Conn, target: SshTarget): Promise<void> {
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
    conn.connect({
      host: target.host,
      port: target.port,
      username: target.username,
      password: target.password,
      readyTimeout: 15_000,
      hostVerifier: () => true,
    });
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
      stream.on("close", (code) => {
        resolve({ code: typeof code === "number" ? code : 1, out, err });
      });
    });
  });
}

function writeFile(conn: Conn, path: string, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    conn.sftp((error, sftp) => {
      if (error || !sftp) {
        reject(error ?? new Error("Файлы на сервер не легли"));
        return;
      }
      sftp.writeFile(path, data, (writeError) => (writeError ? reject(writeError) : resolve()));
    });
  });
}

export async function installAgent(target: SshTarget): Promise<void> {
  if (!diskNameOk(target.disk)) throw new Error("Диск собран неверно");
  const conn = await client();
  try {
    await connect(conn, target);
    const found = await exec(conn, "command -v python3; command -v systemctl");
    const lines = found.out.split("\n").map((line) => line.trim()).filter(Boolean);
    const python = lines.find((line) => line.includes("python"));
    const systemd = lines.find((line) => line.endsWith("systemctl") || line.includes("systemctl"));
    if (!python) throw new Error("no-python");
    if (!systemd) throw new Error("no-systemd");
    const ready = await exec(conn, `mkdir -p /opt/vvvion-mega /var/lib/vvvion-mega/${target.disk}`);
    if (ready.code !== 0) throw new Error(ready.err || "Каталог на сервере не создался");
    const unit = unitText(target.disk, target.agentPort, target.token, python);
    await writeFile(conn, "/opt/vvvion-mega/agent.py", Buffer.from(AGENT_SOURCE, "utf8"));
    await writeFile(conn, "/etc/systemd/system/vvvion-mega.service", Buffer.from(unit, "utf8"));
    const shell = installShell(target.disk, target.agentPort, target.token, python);
    const started = await exec(conn, shell);
    if (started.code !== 0 || !started.out.includes('"ok"')) {
      throw new Error(started.err || started.out || "Скрипт не поднялся");
    }
  } catch (error) {
    throw explain(error, target.token);
  } finally {
    conn.end();
  }
}
