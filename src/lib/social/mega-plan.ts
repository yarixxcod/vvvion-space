export const MEGA_PRICE = 1500;
export const MEGA_DAYS = 30;
export const MEGA_QUOTA = 2 * 1024 * 1024 * 1024;
export const MEGA_CHUNK = 1536 * 1024;
export const DEFAULT_AGENT_PORT = 8742;

const HEX = /^[a-f0-9]{32,64}$/;

export function agentPortOk(port: number): boolean {
  return Number.isInteger(port) && port >= 1024 && port <= 65535 && port !== 443 && port !== 8443;
}

export function sshPortOk(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535 && port !== 443 && port !== 8443;
}

export function diskNameOk(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(value);
}

export function hostOk(value: string): boolean {
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)) {
    return /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(value) && !value.includes("..");
  }
  return value.split(".").every((part) => Number(part) <= 255);
}

export function sshUserOk(value: string): boolean {
  return /^[a-z_][a-z0-9_-]{0,31}$/.test(value);
}

export function entryName(value: string): string {
  const name = value.replace(/[^\p{L}\p{N}._ ()\-]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!name || name === "." || name === "..") throw new Error("Так не назвать");
  return name;
}

/** A free name in the same folder: `photo (1).png`, then `photo (2).png`. */
export function siblingName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 && name.length - dot <= 8 && !name.slice(dot).includes(" ") ? name.slice(dot) : "";
  const stem = (ext ? name.slice(0, name.length - ext.length) : name).trim() || "Файл";
  for (let n = 1; n < 100; n += 1) {
    const next = `${stem} (${n})${ext}`.slice(0, 80);
    if (!taken.has(next)) return next;
  }
  return `${stem} (${nTail()})${ext}`.slice(0, 80);
}

function nTail(): string {
  return Math.random().toString(36).slice(2, 6);
}

export function pickNode(nodes: { id: string; used: number; ready: boolean }[]): string | null {
  const ready = nodes.filter((node) => node.ready);
  ready.sort((a, b) => a.used - b.used || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return ready[0]?.id ?? null;
}

export const AGENT_SOURCE = `#!/usr/bin/env python3
# VVVION megadisk. Files only. Refuses ports 443 and 8443.
import json
import os

try:
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
except ImportError:
    from http.server import BaseHTTPRequestHandler, HTTPServer
    from socketserver import ThreadingMixIn

    class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
        daemon_threads = True

ROOT = os.environ["MEGA_ROOT"]
TOKEN = os.environ["MEGA_TOKEN"]
PORT = int(os.environ["MEGA_PORT"])
FORBIDDEN = {443, 8443}
CHUNK = 2000000

if PORT in FORBIDDEN or PORT < 1024 or PORT > 65535:
    raise SystemExit(2)

def ok_user(value):
    return len(value) == 32 and all(c in "0123456789abcdef" for c in value)

def ok_file(value):
    if len(value) != 36:
        return False
    for index in (8, 13, 18, 23):
        if value[index] != "-":
            return False
    return all(c in "0123456789abcdef-" for c in value)

def blob(user, file_id):
    if not ok_user(user) or not ok_file(file_id):
        return None
    return os.path.join(ROOT, user, file_id)

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def setup(self):
        BaseHTTPRequestHandler.setup(self)
        try:
            self.connection.settimeout(90)
        except Exception:
            pass

    def log_message(self, fmt, *args):
        return

    def _auth(self):
        if self.headers.get("Authorization", "") != "Bearer " + TOKEN:
            self.send_error(401)
            return False
        return True

    def _parts(self):
        return [part for part in self.path.split("?", 1)[0].split("/") if part]

    def _json(self, code, body):
        raw = json.dumps(body).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if not self._auth():
            return
        if self.path.split("?", 1)[0] == "/health":
            used = 0
            for dirpath, _, files in os.walk(ROOT):
                for name in files:
                    try:
                        used += os.path.getsize(os.path.join(dirpath, name))
                    except OSError:
                        pass
            self._json(200, {"ok": True, "used": used})
            return
        bits = self._parts()
        if len(bits) != 3 or bits[0] != "blob":
            self.send_error(404)
            return
        path = blob(bits[1], bits[2])
        if not path or not os.path.isfile(path):
            self.send_error(404)
            return
        size = os.path.getsize(path)
        try:
            start = int(self.headers.get("X-Start", "0") or 0)
        except ValueError:
            self.send_error(400)
            return
        end_raw = self.headers.get("X-End")
        end = size - 1 if end_raw in (None, "") else int(end_raw)
        if start < 0 or end < start or start >= size:
            self.send_error(416)
            return
        end = min(end, size - 1)
        length = end - start + 1
        self.send_response(200)
        self.send_header("Content-Length", str(length))
        self.send_header("X-Size", str(size))
        self.end_headers()
        with open(path, "rb") as handle:
            handle.seek(start)
            left = length
            while left:
                chunk = handle.read(min(left, 1024 * 1024))
                if not chunk:
                    break
                self.wfile.write(chunk)
                left -= len(chunk)

    def do_HEAD(self):
        if not self._auth():
            return
        bits = self._parts()
        if len(bits) != 3 or bits[0] != "blob":
            self.send_error(404)
            return
        path = blob(bits[1], bits[2])
        if not path or not os.path.isfile(path):
            self.send_error(404)
            return
        size = os.path.getsize(path)
        self.send_response(200)
        self.send_header("Content-Length", str(size))
        self.end_headers()

    def do_PUT(self):
        if not self._auth():
            return
        bits = self._parts()
        if len(bits) != 3 or bits[0] != "blob":
            self.send_error(404)
            return
        path = blob(bits[1], bits[2])
        if not path:
            self.send_error(400)
            return
        try:
            length = int(self.headers.get("Content-Length", "0") or 0)
            offset = int(self.headers.get("X-Offset", "0") or 0)
        except ValueError:
            self.send_error(400)
            return
        if length < 0 or length > CHUNK or offset < 0:
            self.send_error(413)
            return
        data = self.rfile.read(length)
        if len(data) != length:
            self.send_error(400)
            return
        os.makedirs(os.path.dirname(path), exist_ok=True)
        mode = "r+b" if os.path.exists(path) else "w+b"
        with open(path, mode) as handle:
            handle.seek(offset)
            handle.write(data)
            handle.flush()
            size = handle.seek(0, os.SEEK_END)
        self._json(200, {"ok": True, "size": size})

    def do_DELETE(self):
        if not self._auth():
            return
        bits = self._parts()
        if len(bits) != 3 or bits[0] != "blob":
            self.send_error(404)
            return
        path = blob(bits[1], bits[2])
        if not path:
            self.send_error(400)
            return
        try:
            os.remove(path)
        except OSError:
            pass
        self._json(200, {"ok": True})

if __name__ == "__main__":
    os.makedirs(ROOT, exist_ok=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
`;

export function unitText(disk: string, port: number, token: string, python: string): string {
  if (!diskNameOk(disk) || !agentPortOk(port) || !HEX.test(token) || !python.startsWith("/")) {
    throw new Error("Диск собран неверно");
  }
  return `[Unit]
Description=VVVION megadisk
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=MEGA_ROOT=/var/lib/vvvion-mega/${disk}
Environment=MEGA_TOKEN=${token}
Environment=MEGA_PORT=${port}
ExecStart=${python} /opt/vvvion-mega/agent.py
Restart=on-failure
RestartSec=2

[Install]
WantedBy=multi-user.target
`;
}

export function installShell(disk: string, port: number, token: string, python: string): string {
  if (!diskNameOk(disk) || !agentPortOk(port) || !HEX.test(token)) throw new Error("Диск собран неверно");
  if (!/^\/[A-Za-z0-9._/+-]+$/.test(python)) throw new Error("На сервере нет python3");
  return `set -eu
mkdir -p /opt/vvvion-mega /var/lib/vvvion-mega/${disk}
chmod 755 /opt/vvvion-mega/agent.py
chmod 600 /etc/systemd/system/vvvion-mega.service
if command -v ufw >/dev/null 2>&1; then
  if ufw status 2>/dev/null | head -n 1 | grep -q "Status: active"; then
    ufw allow ${port}/tcp >/dev/null || true
  fi
fi
systemctl daemon-reload
systemctl enable vvvion-mega.service >/dev/null
systemctl restart vvvion-mega.service
ok=0
for _ in 1 2 3 4 5; do
  if ${python} -c 'import urllib.request; req=urllib.request.Request("http://127.0.0.1:${port}/health", headers={"Authorization":"Bearer ${token}"}); print(urllib.request.urlopen(req, timeout=5).read().decode())'; then
    ok=1
    break
  fi
  sleep 0.4
done
test "$ok" = 1
`;
}
