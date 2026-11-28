export type ConnectPlan = {
  host: string;
  sshPort: number;
  username: string;
  secret: string;
  fingerprint: string;
  name: string;
  country: string;
  city: string;
  protocol: "vless" | "hy2";
  port: number;
  tls: "reality" | "certificate";
  sni: string;
  handshake: string;
  handshakePort: number;
  certPath: string;
  keyPath: string;
  shortId: string;
};
const domain = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i;
const clean = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const port = (v: unknown, fallback: number) => {
  const n = Number(v ?? fallback);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw Error("Порт должен быть от 1 до 65535");
  return n;
};
export function connectPlan(input: unknown): ConnectPlan {
  if (!input || typeof input !== "object") throw Error("Укажите сервер");
  const r = input as Record<string, unknown>;
  const host = clean(r.host, 253).replace(/^\[|\]$/g, "");
  if (!host || !/^[a-zA-Z0-9.:-]+$/.test(host)) throw Error("Укажите IP или домен сервера");
  const username = clean(r.username, 32) || "root";
  if (username !== "root") throw Error("Автоустановка требует SSH-доступ root на отдельном VPS");
  const secret = typeof r.secret === "string" ? r.secret : "";
  if (secret.length < 1 || secret.length > 20000)
    throw Error("Нужен пароль или приватный SSH-ключ");
  const fingerprint = clean(r.fingerprint, 100);
  if (fingerprint && !/^SHA256:[A-Za-z0-9+/]{43}$/.test(fingerprint))
    throw Error("Некорректный отпечаток SSH");
  const protocol = r.protocol === "hy2" ? "hy2" : "vless";
  const tls = protocol === "hy2" || r.tls === "certificate" ? "certificate" : "reality";
  const sni = clean(r.sni, 253).toLowerCase();
  const handshake = clean(r.handshake, 253).toLowerCase() || sni;
  if (
    !domain.test(sni) ||
    sni.includes("..") ||
    !domain.test(handshake) ||
    handshake.includes("..")
  )
    throw Error("Укажите корректный SNI и адрес TLS-сервера");
  const sshPort = port(r.sshPort, 22),
    listenPort = port(r.port, 443);
  if (sshPort === listenPort || listenPort === 10085)
    throw Error("Порт подключения занят SSH или статистикой");
  const certPath = clean(r.certPath, 300),
    keyPath = clean(r.keyPath, 300);
  if (
    tls === "certificate" &&
    ![certPath, keyPath].every((v) => /^\/[A-Za-z0-9/_.-]+$/.test(v) && !v.includes(".."))
  )
    throw Error("Укажите абсолютные пути к сертификату и ключу TLS на VPS");
  const shortId = clean(r.shortId, 16);
  if (shortId && !/^(?:[0-9a-f]{2}){1,8}$/i.test(shortId))
    throw Error("Short ID: чётное число hex-символов, до 16");
  return {
    host,
    sshPort,
    username,
    secret,
    fingerprint,
    name: clean(r.name, 32) || "Connect",
    country: clean(r.country, 40),
    city: clean(r.city, 40),
    protocol,
    port: listenPort,
    tls,
    sni,
    handshake,
    handshakePort: port(r.handshakePort, 443),
    certPath,
    keyPath,
    shortId,
  };
}
