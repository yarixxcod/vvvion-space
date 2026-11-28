import { useEffect, useRef, useState } from "react";
import { Check, LoaderCircle, Server, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { probeConnectServer, installConnectServer } from "@/lib/social/connect-install";
import { getVpnDesk, type VpnDesk } from "@/lib/social/vpn";
import type { ConnectPlan } from "@/lib/social/connect-plan";
const INITIAL: ConnectPlan = {
  host: "",
  sshPort: 22,
  username: "root",
  secret: "",
  fingerprint: "",
  name: "Connect",
  country: "",
  city: "",
  protocol: "vless",
  port: 443,
  tls: "reality",
  sni: "www.microsoft.com",
  handshake: "www.microsoft.com",
  handshakePort: 443,
  certPath: "",
  keyPath: "",
  shortId: "",
};
export function ConnectInstaller({ onDesk }: { onDesk: (desk: VpnDesk) => void }) {
  const [plan, setPlan] = useState(INITIAL),
    [confirmed, setConfirmed] = useState(false),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [job, setJob] = useState(""),
    [status, setStatus] = useState(""),
    [error, setError] = useState("");
  const callback = useRef(onDesk);
  callback.current = onDesk;
  function change(patch: Partial<ConnectPlan>) {
    setPlan((p) => ({ ...p, ...patch, fingerprint: "" }));
    setConfirmed(false);
    setReady(false);
    setError("");
  }
  useEffect(() => {
    if (!job) return;
    let active = true;
    const poll = async () => {
      try {
        const desk = await getVpnDesk();
        if (!active) return;
        callback.current(desk);
        const node = desk.nodes.find((n) => n.id === job);
        if (!node) {
          setStatus("Сервер удалён из панели");
          setJob("");
          return;
        }
        setStatus(node.lastError || node.loadNote || "Ожидаем отчёт сервера");
        if (node.agentEnrolled && node.enabled && !node.maintenance) {
          setStatus("Сервер готов. Подписки и статистика подключены");
          setJob("");
        } else if (/Ошибка/i.test(node.loadNote)) {
          setJob("");
        }
      } catch {
        if (active) setStatus("Не удалось получить статус. Повторяем проверку…");
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [job]);
  async function run(install = false) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (install) {
        if (!confirmed || !ready) throw Error("Проверьте сервер и подтвердите отпечаток");
        const result = await installConnectServer({ data: plan });
        setJob(result.nodeId);
        setStatus("Установка запущена. Сборка со счётчиками может занять несколько минут");
        setPlan((p) => ({ ...p, secret: "" }));
        setReady(false);
        callback.current(await getVpnDesk());
      } else {
        const result = await probeConnectServer({ data: plan });
        setPlan((p) => ({ ...p, fingerprint: result.fingerprint }));
        setReady(result.ready);
        if (result.ready) toast.success("SSH и условия установки проверены");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Сервер не ответил");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mt-4 min-w-0 rounded-3xl border border-line bg-elev p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-accent/15 text-accent">
          <Server className="size-5" />
        </span>
        <div>
          <h3 className="font-medium">Установить Connect на VPS</h3>
          <p className="text-xs text-muted">sing-box · персональные ключи · учёт трафика</p>
        </div>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        Отдельный Debian/Ubuntu VPS с systemd, Python 3, SSH root, от 1 ГБ памяти и 3 ГБ свободного
        места. Действующую установку не перезаписываем. Пароль или SSH-ключ передаётся только для
        установки и не сохраняется на сайте.
      </p>
      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run(ready);
        }}
      >
        <fieldset disabled={busy || Boolean(job)} className="min-w-0 space-y-3 disabled:opacity-60">
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <Field
              label="IP или домен VPS"
              value={plan.host}
              onChange={(v) => change({ host: v })}
            />
            <Field
              label="Название локации"
              value={plan.name}
              onChange={(v) => change({ name: v })}
            />
            <Field
              label="SSH-порт"
              value={String(plan.sshPort)}
              type="number"
              onChange={(v) => change({ sshPort: Number(v) })}
            />
            <Field
              label="SSH-пользователь"
              value={plan.username}
              onChange={(v) => change({ username: v })}
            />
          </div>
          <label className="block text-xs text-muted">
            Пароль или приватный SSH-ключ
            <textarea
              autoComplete="off"
              spellCheck={false}
              className="field mt-1 min-h-20 font-mono text-sm [-webkit-text-security:disc]"
              value={plan.secret}
              onChange={(e) => change({ secret: e.target.value })}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-muted">
              Протокол
              <select
                className="field mt-1"
                value={plan.protocol}
                onChange={(e) =>
                  change({
                    protocol: e.target.value as "vless" | "hy2",
                    tls: e.target.value === "hy2" ? "certificate" : "reality",
                  })
                }
              >
                <option value="vless">VLESS</option>
                <option value="hy2">Hysteria 2 (HY2)</option>
              </select>
            </label>
            <Field
              label={plan.protocol === "hy2" ? "Порт UDP" : "Порт TCP"}
              type="number"
              value={String(plan.port)}
              onChange={(v) => change({ port: Number(v) })}
            />
          </div>
          {plan.protocol === "vless" ? (
            <label className="block text-xs text-muted">
              Защита
              <select
                className="field mt-1"
                value={plan.tls}
                onChange={(e) => change({ tls: e.target.value as ConnectPlan["tls"] })}
              >
                <option value="reality">Reality · TLS-маскировка</option>
                <option value="certificate">TLS · свой сертификат</option>
              </select>
            </label>
          ) : null}
          <Field
            label="SNI · имя TLS-сервера"
            value={plan.sni}
            onChange={(v) =>
              change({ sni: v, ...(plan.handshake === plan.sni ? { handshake: v } : {}) })
            }
          />
          {plan.tls === "reality" ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Reality · адрес handshake"
                  value={plan.handshake}
                  onChange={(v) => change({ handshake: v })}
                />
                <Field
                  label="Reality · порт handshake"
                  type="number"
                  value={String(plan.handshakePort)}
                  onChange={(v) => change({ handshakePort: Number(v) })}
                />
              </div>
              <Field
                label="Short ID · пусто — создать автоматически"
                value={plan.shortId}
                onChange={(v) => change({ shortId: v })}
              />
              <p className="text-xs leading-relaxed text-muted">
                Выберите доступный TLS 1.3 сайт, соответствующий SNI. Ключи Reality создаются на
                VPS. Доступность зависит от сети и выбранного сервера.
              </p>
            </>
          ) : (
            <>
              <Field
                label="Путь к TLS-сертификату на VPS"
                value={plan.certPath}
                placeholder="/etc/letsencrypt/live/example.com/fullchain.pem"
                onChange={(v) => change({ certPath: v })}
              />
              <Field
                label="Путь к приватному ключу TLS на VPS"
                value={plan.keyPath}
                placeholder="/etc/letsencrypt/live/example.com/privkey.pem"
                onChange={(v) => change({ keyPath: v })}
              />
              <p className="text-xs leading-relaxed text-muted">
                Нужен действующий сертификат для SNI на этом VPS. Проверка TLS у клиентов остаётся
                включённой.
              </p>
            </>
          )}
          <details className="rounded-2xl bg-subtle p-3">
            <summary className="cursor-pointer text-sm text-muted">Страна и город</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Страна" value={plan.country} onChange={(v) => change({ country: v })} />
              <Field label="Город" value={plan.city} onChange={(v) => change({ city: v })} />
            </div>
          </details>
          {plan.fingerprint ? (
            <div className="rounded-2xl border border-line p-3">
              <p className="flex items-center gap-2 text-sm">
                <ShieldCheck className="size-4" />
                Отпечаток SSH-сервера
              </p>
              <code className="mt-2 block break-all text-xs">{plan.fingerprint}</code>
              <label className="mt-2 flex min-h-11 items-start gap-2 py-2 text-sm">
                <input
                  className="mt-1"
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                <span>
                  Я сверил отпечаток. Это отдельный VPS; разрешаю установку sing-box и агента
                  Connect.
                </span>
              </label>
            </div>
          ) : null}
          <button
            type="submit"
            disabled={Boolean(plan.fingerprint) && !confirmed}
            className="press flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-accent px-4 text-sm font-medium text-accent-fg disabled:opacity-40"
          >
            {busy ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : ready ? (
              <Check className="size-4" />
            ) : (
              <ShieldCheck className="size-4" />
            )}
            {busy
              ? "Проверяем…"
              : ready
                ? "Установить и подключить к панели"
                : plan.fingerprint
                  ? "Проверить SSH и свободный сервер"
                  : "Получить отпечаток SSH"}
          </button>
        </fieldset>
      </form>
      {status ? (
        <p role="status" className="mt-3 flex items-start gap-2 text-sm text-muted">
          {job ? <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin" /> : null}
          {status}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <p className="mt-3 text-xs leading-relaxed text-faint">
        Если используется внешний firewall хостинга, откройте выбранный TCP/UDP-порт. Сервер
        появится в подписке после применения клиентов и первого успешного отчёта.
      </p>
    </section>
  );
}
function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block min-w-0 text-xs text-muted">
      {label}
      <input
        className="field mt-1 w-full min-w-0"
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
