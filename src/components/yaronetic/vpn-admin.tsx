import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageLoader } from "@/components/yaronetic/page-loader";
import {
  getVpnDesk,
  grantVpn,
  removeVpnNode,
  saveVpnNode,
  saveVpnTraffic,
  setVpnNodeEnabled,
  type VpnDesk,
} from "@/lib/social/vpn";

function gb(bytes: number) {
  return String(Math.max(1, Math.round(bytes / (1024 * 1024 * 1024))));
}

export function VpnDeskCard() {
  const [desk, setDesk] = useState<VpnDesk | null>(null);
  const [name, setName] = useState("");
  const [uri, setUri] = useState("");
  const [traffic, setTraffic] = useState("100");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getVpnDesk()
      .then((next) => {
        setDesk(next);
        setTraffic(gb(next.trafficBytes));
      })
      .catch((err: unknown) => toast.error(err instanceof Error ? err.message : "VPN сейчас не открылся"));
  }, []);

  async function run(task: () => Promise<VpnDesk>, ok: string) {
    if (busy) return;
    setBusy(true);
    try {
      const next = await task();
      setDesk(next);
      setTraffic(gb(next.trafficBytes));
      toast(ok);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не получилось");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6">
      <h3 className="text-sm font-medium">VVVION VPN</h3>
      <p className="mt-1 text-[13px] text-muted">Название и ссылка vless:// или hy2://.</p>
      {desk ? (
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <Stat label="Действует" value={String(desk.activeLinks)} />
          <Stat label="Выдано ссылок" value={String(desk.totalLinks)} />
          <Stat label="Запросов за сутки" value={String(desk.pullsDay)} />
        </div>
      ) : (
        <PageLoader compact />
      )}
      <div className="mt-3 flex items-end gap-2">
        <label className="block min-w-0 flex-1 text-xs text-faint">
          Трафик в программе, ГБ
          <input className="field mt-1 tabular-nums" inputMode="numeric" value={traffic} onChange={(event) => setTraffic(event.target.value.replace(/[^\d]/g, "").slice(0, 5))} />
        </label>
        <button
          type="button"
          disabled={busy}
          className="press h-11 shrink-0 rounded-xl border border-line px-3 text-sm disabled:opacity-40"
          onClick={() => void run(() => saveVpnTraffic({ data: { gb: Number(traffic) } }), "Трафик сохранён")}
        >
          Сохранить
        </button>
      </div>
      <ul className="mt-3 space-y-2">
        {(desk?.nodes ?? []).map((node) => (
          <li key={node.id} className="rounded-2xl border border-line bg-bg px-3 py-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm">{node.name}</p>
                <p className="mt-1 truncate text-xs text-faint">{node.uri}</p>
              </div>
              <span className="shrink-0 text-xs text-muted">{node.enabled ? "В списке" : "Скрыт"}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                disabled={busy}
                className="press h-9 rounded-lg border border-line px-2 text-xs disabled:opacity-40"
                onClick={() => void run(() => setVpnNodeEnabled({ data: { id: node.id, enabled: !node.enabled } }), node.enabled ? "Локация скрыта" : "Локация в списке")}
              >
                {node.enabled ? "Скрыть" : "Показать"}
              </button>
              <button
                type="button"
                disabled={busy}
                className="press h-9 rounded-lg border border-line px-2 text-xs text-danger disabled:opacity-40"
                onClick={() => {
                  if (!window.confirm(`Убрать «${node.name}»? Ссылки пользователей обновятся без этой локации.`)) return;
                  void run(() => removeVpnNode({ data: node.id }), "Сервер убран");
                }}
              >
                Удалить
              </button>
            </div>
          </li>
        ))}
      </ul>
      <form
        className="mt-3 space-y-2 rounded-2xl border border-line bg-bg p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            const next = await saveVpnNode({ data: { name, uri } });
            setName("");
            setUri("");
            return next;
          }, "Сервер сохранён");
        }}
      >
        <p className="text-sm font-medium">Новый сервер</p>
        <input className="field" value={name} maxLength={32} placeholder="Название, как в программе" onChange={(event) => setName(event.target.value)} />
        <textarea className="field min-h-20 font-mono text-xs" value={uri} placeholder="vless:// или hy2://" onChange={(event) => setUri(event.target.value)} />
        <button type="submit" disabled={busy} className="press h-10 rounded-xl bg-accent px-3 text-sm font-medium text-accent-fg disabled:opacity-40">
          Добавить
        </button>
      </form>
      <form
        className="mt-3 flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            const next = await grantVpn({ data: { email } });
            setEmail("");
            return next;
          }, "Подписка выдана на 30 дней");
        }}
      >
        <label className="block min-w-0 flex-1 text-xs text-faint">
          Выдать ссылку по почте
          <input className="field mt-1" type="email" value={email} placeholder="почта участника" onChange={(event) => setEmail(event.target.value)} />
        </label>
        <button type="submit" disabled={busy} className="press h-11 shrink-0 rounded-xl border border-line px-3 text-sm disabled:opacity-40">
          30 дней
        </button>
      </form>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-bg px-2 py-3">
      <p className="font-serif text-2xl tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-faint">{label}</p>
    </div>
  );
}
