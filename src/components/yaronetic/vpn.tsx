import { useEffect, useState } from "react";
import { ChevronLeft, Copy } from "lucide-react";
import { encode } from "uqr";
import { toast } from "sonner";
import { LoaderMark } from "@/components/yaronetic/page-loader";
import { VerifyMailButton } from "@/components/yaronetic/verify-mail";
import { addVpnDevice, buyVpn, getVpnShowcase, reissueVpnDevice, revokeVpnDevice, rotateVpnToken, setVpnAutoRenew, type VpnShowcase } from "@/lib/social/vpn";
import { useTx } from "@/lib/lang";

function untilLabel(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

function gb(bytes: number | null) {
  if (bytes == null || !Number.isFinite(bytes)) return null;
  return `${(bytes / 1024 ** 3).toFixed(bytes >= 1024 ** 3 ? 1 : 2)} ГБ`;
}

function Qr({ value }: { value: string }) {
  const qr = encode(value);
  const cells: { x: number; y: number }[] = [];
  for (let y = 0; y < qr.size; y++) {
    const row = qr.data[y];
    if (!row) continue;
    for (let x = 0; x < qr.size; x++) if (row[x]) cells.push({ x, y });
  }
  return (
    <svg viewBox={`0 0 ${qr.size} ${qr.size}`} className="size-44 rounded-2xl bg-white p-2" role="img" aria-label="QR-код подписки">
      <rect width={qr.size} height={qr.size} fill="#fff" />
      {cells.map((cell) => (
        <rect key={`${cell.x}-${cell.y}`} x={cell.x} y={cell.y} width="1" height="1" fill="#1c1b19" />
      ))}
    </svg>
  );
}

export function VpnService({ onBack }: { onBack: () => void }) {
  const tx = useTx();
  const [row, setRow] = useState<VpnShowcase | null>(null);
  const [busy, setBusy] = useState(false);
  const [origin, setOrigin] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [failed, setFailed] = useState(false);

  function load() {
    setFailed(false);
    void getVpnShowcase()
      .then(setRow)
      .catch((err: unknown) => {
        setFailed(true);
        toast.error(err instanceof Error ? err.message : "VPN сейчас не открылся");
      });
  }

  useEffect(() => {
    setOrigin(window.location.origin);
    load();
  }, []);

  const url = row?.token && origin ? `${origin}/api/vpn/${row.token}` : "";
  const used = row ? gb(row.usedBytes) : null;
  const quota = row ? gb(row.trafficBytes) : null;
  const usedPct = row && row.usedBytes != null && row.trafficBytes > 0 ? Math.min(100, Math.round((row.usedBytes / row.trafficBytes) * 100)) : null;

  async function run(task: () => Promise<VpnShowcase>, ok: string) {
    if (busy) return;
    setBusy(true);
    try {
      setRow(await task());
      toast(ok);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не получилось");
    } finally {
      setBusy(false);
    }
  }

  async function buy() {
    if (!row) return;
    if (!row.verified) {
      toast.error("Сначала подтвердите почту в профиле");
      return;
    }
    if (!window.confirm(`Потратить ${row.price} вублей? Срок прибавится на ${row.days} дней.`)) return;
    await run(() => buyVpn(), "Подписка открыта");
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast("Ссылка скопирована");
    } catch {
      toast.error("Не удалось скопировать");
    }
  }

  return (
    <div className="h-full overflow-x-hidden overflow-y-auto px-4 py-4">
      <button type="button" className="press inline-flex items-center gap-1 text-sm text-muted" onClick={onBack}>
        <ChevronLeft className="size-4" />
        {tx({ ru: "Сервисы", en: "Services", kk: "Сервистер" })}
      </button>
      <p className="mt-4 text-xs tracking-[0.22em] text-faint uppercase">VVVION</p>
      <h3 className="font-serif text-4xl tracking-tight">VPN</h3>
      <p className="mt-1 max-w-md text-sm text-muted">Личная ссылка для Happ, Incy и Karing. Один акцент, без чужих ключей после подключения агента.</p>

      {!row && !failed ? <LoaderMark className="vv-loader-sm mt-6" /> : null}
      {failed && !row ? (
        <button type="button" className="press mt-4 h-10 rounded-xl border border-line px-3 text-sm" onClick={load}>
          {tx({ ru: "Повторить", en: "Try again", kk: "Қайталау" })}
        </button>
      ) : null}

      {row ? (
        <section className="relative mt-4 overflow-hidden rounded-[1.75rem] border border-line bg-elev p-5">
          <div className="pointer-events-none absolute -top-16 -right-10 size-40 rounded-full bg-accent/25 blur-3xl" />
          <p className="relative text-xs tracking-[0.16em] text-faint uppercase">{row.active ? "Подписка" : row.blocked ? "Пауза" : "Нет подписки"}</p>
          <div className="relative mt-2 flex items-end justify-between gap-3">
            <p className="font-serif text-6xl leading-none tabular-nums">{row.active ? row.daysLeft : 0}</p>
            <p className="pb-1 text-right text-sm text-muted">{row.active ? `до ${untilLabel(row.until)}` : "дней"}</p>
          </div>
          <div className="relative mt-5">
            <div className="flex justify-between gap-3 text-xs text-faint">
              <span>Трафик</span>
              <span className="text-right">{used == null ? "Нет данных" : `${used} из ${quota}`}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-subtle">
              <div className="h-full rounded-full bg-accent" style={{ width: usedPct == null ? "0%" : `${Math.max(usedPct, 4)}%` }} />
            </div>
            <p className="mt-2 text-xs text-faint">
              {used == null
                ? "Счётчик появится после отчёта агента. Пока данных нет — это не ноль."
                : row.quotaReset
                  ? `Отсчёт с ${untilLabel(row.quotaReset)}`
                  : "Отсчёт с первого отчёта сервера"}
            </p>
          </div>
          <p className="relative mt-4 text-sm text-muted">
            {row.places.length === 0
              ? "Локаций пока нет."
              : row.places.some((place) => place.personal && place.cut)
                ? "На подключённых серверах остаются только личные ключи. Истёкшая подписка снимается при следующей сверке."
                : row.places.some((place) => place.personal)
                  ? "Личные ключи уже пишутся. Общий ключ пока оставлен, чтобы текущие приложения не оборвались."
                  : "Агент ещё не записал конфиг. Ссылка общая: сайт прячет её из списка, но уже импортированный ключ погаснет только после агента."}
          </p>
        </section>
      ) : null}

      {row && row.places.length > 0 ? (
        <ul className="mt-3 space-y-1">
          {row.places.map((place) => (
            <li key={place.name} className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-bg px-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="block truncate">{place.name}</span>
                <span className="block text-xs text-faint">{[place.city, place.country].filter(Boolean).join(", ") || "Локация"}</span>
              </span>
              <span className="shrink-0 text-xs text-muted">
                {place.maintenance ? "Обслуживание" : place.personal ? (place.reach === "up" ? "На связи" : place.reach === "down" ? "Нет ответа" : "Ждёт отчёт") : "Общий ключ"}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {row && !row.verified ? (
        <div className="mt-4">
          <VerifyMailButton onVerified={load} />
        </div>
      ) : (
        <button type="button" disabled={busy || !row} className="press mt-4 h-12 w-full rounded-2xl bg-accent text-sm font-medium text-accent-fg disabled:opacity-40" onClick={() => void buy()}>
          {row ? `${row.active ? "Продлить" : "Открыть"} за ${row.price} на ${row.days} дней` : ""}
        </button>
      )}

      {url && row ? (
        <section className="mt-4 rounded-[1.75rem] border border-line bg-bg p-4">
          <p className="text-sm font-medium">Ссылка подписки</p>
          <p className="mt-2 break-all rounded-2xl bg-elev px-3 py-2 font-mono text-xs text-muted">{url}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="press inline-flex h-10 items-center gap-1.5 rounded-xl border border-line px-3 text-sm" onClick={() => void copy(url)}>
              <Copy className="size-3.5" />
              Скопировать
            </button>
            <button type="button" disabled={busy} className="press h-10 rounded-xl border border-line px-3 text-sm disabled:opacity-40" onClick={() => void run(() => rotateVpnToken(), "Ссылка заменена. Старая больше не откроется.")}>
              Новая ссылка
            </button>
          </div>
          <div className="mt-4 flex justify-center">
            <Qr value={url} />
          </div>
          <label className="mt-4 flex items-center justify-between gap-3 text-sm">
            Автопродление
            <button type="button" disabled={busy} className="press h-9 rounded-lg border border-line px-3 text-xs disabled:opacity-40" onClick={() => void run(() => setVpnAutoRenew({ data: { on: !row.autoRenew } }), row.autoRenew ? "Автопродление выключено" : "Автопродление включено")}>
              {row.autoRenew ? "Включено" : "Выключено"}
            </button>
          </label>
          <p className="mt-1 text-xs text-faint">Только если вы сами включили. Списывает стоимость тарифа за 30 дней, когда на балансе хватает.</p>
        </section>
      ) : null}

      {row?.active ? (
        <section className="mt-4">
          <h4 className="text-sm font-medium">Устройства</h4>
          <p className="mt-1 text-xs text-faint">Отдельная ссылка, не счётчик физических телефонов. Лимит {row.deviceCap} держит сервер при сверке.</p>
          <ul className="mt-2 space-y-1">
            {row.devices.filter((item) => !item.revoked).map((item) => (
              <li key={item.id} className="rounded-2xl border border-line bg-bg px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-sm">{item.name}</p>
                  <span className="shrink-0 text-xs text-faint">{item.lastPull ? `запрос ${untilLabel(item.lastPull)}` : "ещё не запрашивали"}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {item.token && origin ? (
                    <button type="button" className="press h-8 rounded-lg border border-line px-2 text-xs" onClick={() => void copy(`${origin}/api/vpn/${item.token}`)}>
                      Скопировать
                    </button>
                  ) : null}
                  <button type="button" disabled={busy} className="press h-8 rounded-lg border border-line px-2 text-xs disabled:opacity-40" onClick={() => void run(() => reissueVpnDevice({ data: item.id }), "Ключ устройства перевыпущен")}>
                    Новый ключ
                  </button>
                  <button type="button" disabled={busy} className="press h-8 rounded-lg border border-line px-2 text-xs text-danger disabled:opacity-40" onClick={() => void run(() => revokeVpnDevice({ data: item.id }), "Ссылка устройства отозвана")}>
                    Отозвать
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <form
            className="mt-2 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const next = await addVpnDevice({ data: { name: deviceName } });
                setDeviceName("");
                return next;
              }, "Устройство добавлено");
            }}
          >
            <input className="field min-w-0" value={deviceName} maxLength={32} placeholder="Название" onChange={(event) => setDeviceName(event.target.value)} />
            <button type="submit" disabled={busy} className="press h-11 shrink-0 rounded-xl border border-line px-3 text-sm disabled:opacity-40">Добавить</button>
          </form>
        </section>
      ) : null}

      {row && row.usageDays.length > 0 ? (
        <section className="mt-4">
          <h4 className="text-sm font-medium">По дням</h4>
          <ul className="mt-2 space-y-1">
            {row.usageDays.map((item) => (
              <li key={item.day} className="flex justify-between gap-3 rounded-2xl border border-line px-3 py-2 text-sm">
                <span className="text-muted">{item.day}</span>
                <span className="tabular-nums">{gb(item.upload + item.download)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {row && row.history.length > 0 ? (
        <section className="mt-4">
          <h4 className="text-sm font-medium">Покупки</h4>
          <ul className="mt-2 space-y-1">
            {row.history.map((item) => (
              <li key={item.id} className="flex justify-between rounded-2xl border border-line px-3 py-2 text-sm">
                <span className="text-muted">{untilLabel(item.at)}</span>
                <span className="tabular-nums">{item.amount} вуб.</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-4 space-y-2 text-sm text-muted">
        <p className="text-fg">Как подключить</p>
        <p>Android и iPhone: Happ, Incy или Karing. Добавьте подписку по ссылке или QR, не вставляйте чужой vless вручную.</p>
        <p>Компьютер: то же приложение или клиент, который понимает ссылку подписки. Список обновляется примерно раз в час.</p>
        <p className="text-xs text-faint">Пока агент на сервере не записал конфиг, отключение на сайте не гасит уже импортированный общий ключ. Это не считается ограничением трафика.</p>
      </section>
    </div>
  );
}
