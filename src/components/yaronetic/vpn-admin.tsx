import { useEffect, useState } from "react";
import { useTx } from "@/lib/lang";
import { toast } from "sonner";
import { PageLoader } from "@/components/yaronetic/page-loader";
import {
  findVpnUser,
  getVpnDesk,
  grantVpn,
  grantVpnDays,
  grantVpnTrial,
  removeVpnNode,
  resetVpnQuota,
  revokeVpnKeys,
  saveVpnNode,
  saveVpnPlan,
  saveVpnTraffic,
  saveVpnThreshold,
  setVpnBlocked,
  setVpnMaintenance,
  setVpnNodeEnabled,
  setVpnSharedCut,
  type VpnDesk,
  type VpnPerson,
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
  const [days, setDays] = useState("30");
  const [person, setPerson] = useState<VpnPerson | null>(null);
  const [country, setCountry] = useState("");
  const [city, setCity] = useState("");
  const [host, setHost] = useState("");
  const [protocol, setProtocol] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getVpnDesk()
      .then((next) => {
        setDesk(next);
        setTraffic(gb(next.trafficBytes));
      })
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "VPN сейчас не открылся"),
      );
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
      {desk ? (
        <VpnPlanEditor desk={desk} busy={busy} save={(task) => run(task, "Сохранено")} />
      ) : null}
      <div className="mt-3 flex items-end gap-2">
        <label className="block min-w-0 flex-1 text-xs text-faint">
          Трафик в программе, ГБ
          <input
            className="field mt-1 tabular-nums"
            inputMode="numeric"
            value={traffic}
            onChange={(event) => setTraffic(event.target.value.replace(/[^\d]/g, "").slice(0, 5))}
          />
        </label>
        <button
          type="button"
          disabled={busy}
          className="press h-11 shrink-0 rounded-xl border border-line px-3 text-sm disabled:opacity-40"
          onClick={() =>
            void run(() => saveVpnTraffic({ data: { gb: Number(traffic) } }), "Трафик сохранён")
          }
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
                <p className="mt-1 truncate text-xs text-faint">
                  {[node.city, node.country].filter(Boolean).join(", ") ||
                    node.host ||
                    "без адреса"}
                </p>
                <p className="mt-1 text-xs text-faint">
                  {node.protocol || "протокол не указан"}
                  {" · "}
                  {node.agentEnrolled
                    ? node.reach === "up"
                      ? "агент на связи"
                      : node.reach === "down"
                        ? "агент молчит"
                        : "агент без отчёта"
                    : "агент не записал конфиг"}
                  {node.sharedCut ? " · общий ключ снят" : " · общий ключ ещё в конфиге"}
                  {node.clientCount == null ? "" : ` · клиентов ${node.clientCount}`}
                  {node.pingMs == null ? "" : ` · ${node.pingMs} мс`}
                  {node.maintenance ? " · обслуживание" : ""}
                  {node.loadNote ? ` · ${node.loadNote}` : ""}
                </p>
                {node.lastError ? (
                  <p className="mt-1 text-xs text-danger">{node.lastError}</p>
                ) : null}
              </div>
              <span className="shrink-0 text-xs text-muted">
                {node.enabled ? "В списке" : "Скрыт"}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                disabled={busy}
                className="press h-9 rounded-lg border border-line px-2 text-xs disabled:opacity-40"
                onClick={() =>
                  void run(
                    () =>
                      setVpnMaintenance({ data: { id: node.id, maintenance: !node.maintenance } }),
                    node.maintenance ? "Обслуживание снято" : "Сервер на обслуживании",
                  )
                }
              >
                {node.maintenance ? "Вернуть" : "Обслуживание"}
              </button>
              <button
                type="button"
                disabled={busy}
                className="press h-9 rounded-lg border border-line px-2 text-xs disabled:opacity-40"
                onClick={() =>
                  void run(
                    () => setVpnSharedCut({ data: { id: node.id, cut: !node.sharedCut } }),
                    node.sharedCut
                      ? "Общий ключ снова можно оставить"
                      : "Общий ключ будет снят при следующей сверке",
                  )
                }
              >
                {node.sharedCut ? "Вернуть общий" : "Снять общий ключ"}
              </button>
              <button
                type="button"
                disabled={busy}
                className="press h-9 rounded-lg border border-line px-2 text-xs disabled:opacity-40"
                onClick={() =>
                  void run(
                    () => setVpnNodeEnabled({ data: { id: node.id, enabled: !node.enabled } }),
                    node.enabled ? "Локация скрыта" : "Локация в списке",
                  )
                }
              >
                {node.enabled ? "Скрыть" : "Показать"}
              </button>
              <button
                type="button"
                disabled={busy}
                className="press h-9 rounded-lg border border-line px-2 text-xs text-danger disabled:opacity-40"
                onClick={() => {
                  if (
                    !window.confirm(
                      `Убрать «${node.name}»? Ссылки пользователей обновятся без этой локации.`,
                    )
                  )
                    return;
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
            const next = await saveVpnNode({ data: { name, uri, country, city, host, protocol } });
            setName("");
            setUri("");
            setCountry("");
            setCity("");
            setHost("");
            return next;
          }, "Сервер сохранён");
        }}
      >
        <p className="text-sm font-medium">Новый сервер</p>
        <input
          className="field"
          value={name}
          maxLength={32}
          placeholder="Название, как в программе"
          onChange={(event) => setName(event.target.value)}
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            className="field"
            value={country}
            maxLength={40}
            placeholder="Страна"
            onChange={(event) => setCountry(event.target.value)}
          />
          <input
            className="field"
            value={city}
            maxLength={40}
            placeholder="Город"
            onChange={(event) => setCity(event.target.value)}
          />
        </div>
        <input
          className="field"
          value={host}
          maxLength={120}
          placeholder="IP или домен"
          onChange={(event) => setHost(event.target.value)}
        />
        <input
          className="field"
          value={protocol}
          maxLength={8}
          placeholder="vless или hy2"
          onChange={(event) => setProtocol(event.target.value)}
        />
        <textarea
          className="field min-h-20 font-mono text-xs"
          value={uri}
          placeholder="vless:// или hy2://"
          onChange={(event) => setUri(event.target.value)}
        />
        <button
          type="submit"
          disabled={busy}
          className="press h-10 rounded-xl bg-accent px-3 text-sm font-medium text-accent-fg disabled:opacity-40"
        >
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
          <input
            className="field mt-1"
            type="email"
            value={email}
            placeholder="почта участника"
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="press h-11 shrink-0 rounded-xl border border-line px-3 text-sm disabled:opacity-40"
        >
          30 дней
        </button>
      </form>
      <form
        className="mt-3 space-y-2 rounded-2xl border border-line bg-bg p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            setPerson(await findVpnUser({ data: { email } }));
            return await getVpnDesk();
          }, "Карточка открыта");
        }}
      >
        <p className="text-sm font-medium">Участник</p>
        <input
          className="field"
          type="email"
          value={email}
          placeholder="почта"
          onChange={(event) => setEmail(event.target.value)}
        />
        <button
          type="submit"
          disabled={busy}
          className="press h-10 rounded-xl border border-line px-3 text-sm disabled:opacity-40"
        >
          Найти
        </button>
        {person ? (
          <div className="text-sm">
            <p>{person.email}</p>
            <p className="text-xs text-faint">
              {person.active ? "действует" : "не действует"} · {person.plan} · трафик{" "}
              {person.usedBytes == null
                ? "нет данных"
                : `${(person.usedBytes / 1024 ** 3).toFixed(2)} ГБ`}{" "}
              · устройств {person.devices}
            </p>
            {person.audit.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {person.audit.map((item, index) => (
                  <li key={`${item.at}-${index}`} className="text-xs text-faint">
                    {item.kind}
                    {item.note ? ` · ${item.note}` : ""}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-1.5">
              <input
                className="field h-9 w-16"
                inputMode="numeric"
                value={days}
                onChange={(event) => setDays(event.target.value.replace(/[^\d]/g, "").slice(0, 3))}
              />
              <button
                type="button"
                disabled={busy}
                className="press h-9 rounded-lg border border-line px-2 text-xs"
                onClick={() =>
                  void run(
                    () => grantVpnDays({ data: { email, days: Number(days) } }),
                    "Срок изменён",
                  )
                }
              >
                Дней
              </button>
              <button
                type="button"
                disabled={busy}
                className="press h-9 rounded-lg border border-line px-2 text-xs"
                onClick={() => void run(() => grantVpnTrial({ data: { email } }), "Пробные 3 дня")}
              >
                Пробный
              </button>
              <button
                type="button"
                disabled={busy}
                className="press h-9 rounded-lg border border-line px-2 text-xs"
                onClick={() =>
                  void run(
                    async () => {
                      await setVpnBlocked({ data: { email, blocked: !person.blocked } });
                      setPerson(await findVpnUser({ data: { email } }));
                      return getVpnDesk();
                    },
                    person.blocked ? "Блок снят" : "Доступ на паузе",
                  )
                }
              >
                {person.blocked ? "Снять блок" : "Блок"}
              </button>
              <button
                type="button"
                disabled={busy}
                className="press h-9 rounded-lg border border-line px-2 text-xs"
                onClick={() =>
                  void run(async () => {
                    await revokeVpnKeys({ data: { email } });
                    setPerson(await findVpnUser({ data: { email } }));
                    return getVpnDesk();
                  }, "Ключи отозваны")
                }
              >
                Отозвать ключи
              </button>
              <button
                type="button"
                disabled={busy}
                className="press h-9 rounded-lg border border-line px-2 text-xs"
                onClick={() =>
                  void run(async () => {
                    await resetVpnQuota({ data: { email } });
                    setPerson(await findVpnUser({ data: { email } }));
                    return getVpnDesk();
                  }, "Отчёты трафика сброшены")
                }
              >
                Сброс квоты
              </button>
            </div>
          </div>
        ) : null}
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

function VpnPlanEditor({
  desk,
  busy,
  save,
}: {
  desk: VpnDesk;
  busy: boolean;
  save: (task: () => Promise<VpnDesk>) => Promise<void>;
}) {
  const tx = useTx(),
    t = (ru: string, en: string, kk: string) => tx({ ru, en, kk });
  const [filter, setFilter] = useState("");
  return (
    <div className="mt-4 space-y-3">
      <p className="text-xs text-muted">
        {t(
          "Цена Базового тарифа берётся из общей настройки цены VPN. Его действующая квота сохраняется из прежней настройки трафика.",
          "The Base price comes from the global VPN price setting. Its active quota follows the legacy traffic setting.",
          "Негізгі тариф бағасы жалпы VPN баптауынан алынады. Квотасы бұрынғы трафик баптауына сәйкес.",
        )}
      </p>
      {desk.plans.map((plan) => (
        <form
          key={`${plan.id}-${plan.price}-${plan.days}-${plan.enabled}-${plan.trafficBytes}-${plan.deviceCap}`}
          className="rounded-2xl border border-line p-3"
          onSubmit={(e) => {
            e.preventDefault();
            const d = new FormData(e.currentTarget);
            void save(() =>
              saveVpnPlan({
                data: {
                  id: plan.id,
                  enabled: d.get("enabled") === "on",
                  price: Number(d.get("price")),
                  days: Number(d.get("days")),
                  deviceCap: Number(d.get("cap")),
                  trafficGb: Number(d.get("gb")),
                },
              }),
            );
          }}
        >
          <h4 className="font-medium">{plan.title}</h4>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["price", t("Цена, вуб", "Price, vub", "Бағасы, вуб"), plan.price, 0, 100000],
              ["days", t("Дни", "Days", "Күндер"), plan.days, 1, 365],
              [
                "gb",
                t("Трафик, ГБ", "Traffic, GB", "Трафик, ГБ"),
                plan.trafficBytes / 1024 ** 3,
                1,
                10000,
              ],
              ["cap", t("Устройства", "Devices", "Құрылғылар"), plan.deviceCap, 1, 20],
            ].map(([name, label, value, min, max]) => (
              <label key={String(name)} className="text-xs text-muted">
                {label}
                <input
                  name={String(name)}
                  type="number"
                  inputMode="numeric"
                  min={Number(min)}
                  max={Number(max)}
                  required
                  defaultValue={Number(value)}
                  readOnly={name === "price" && plan.id === "base"}
                  className="field mt-1 w-full min-w-0"
                />
              </label>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input name="enabled" type="checkbox" defaultChecked={plan.enabled} />
              {t("Доступен", "Enabled", "Қолжетімді")}
            </label>
            <button disabled={busy} className="min-h-11 rounded-xl border border-line px-3 text-sm">
              {t("Сохранить", "Save", "Сақтау")}
            </button>
          </div>
        </form>
      ))}
      <form
        className="flex flex-wrap items-end gap-2 rounded-2xl border border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          void save(() => saveVpnThreshold({ data: Number(d.get("threshold")) }));
        }}
      >
        <label className="min-w-0 flex-1 text-sm">
          {t(
            "Порог необычного расхода, ГБ/день",
            "Unusual usage threshold, GB/day",
            "Ерекше шығын шегі, ГБ/күн",
          )}
          <input
            className="field mt-2"
            name="threshold"
            type="number"
            min="1"
            max="10000"
            defaultValue={desk.suspiciousGb}
          />
        </label>
        <button disabled={busy} className="min-h-11 rounded-xl border border-line px-3">
          {t("Сохранить", "Save", "Сақтау")}
        </button>
      </form>
      <details className="rounded-2xl border border-line p-3">
        <summary className="min-h-11 cursor-pointer py-3">
          {t("Расход за 3 дня", "Usage over 3 days", "3 күндегі шығын")}
        </summary>
        <ul className="space-y-3">
          {desk.topUsage.map((u) => (
            <li key={u.email} className="break-all text-sm">
              <p>
                {u.email} · {(u.bytes / 1024 ** 3).toFixed(2)} GB · {u.devices}{" "}
                {t("устр.", "devices", "құрылғы")} · {u.pulls} {t("запросов", "fetches", "сұрау")}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  className="min-h-11 rounded-xl border border-line px-3"
                  onClick={() => {
                    if (
                      window.confirm(
                        t(
                          "Приостановить VPN для этого пользователя?",
                          "Pause this user's VPN?",
                          "Осы пайдаланушының VPN қызметін тоқтату керек пе?",
                        ),
                      )
                    )
                      void setVpnBlocked({ data: { email: u.email, blocked: true } })
                        .then(() =>
                          toast(
                            t("Доступ приостановлен", "Access paused", "Қолжетімділік тоқтатылды"),
                          ),
                        )
                        .catch(() => toast.error(t("Ошибка", "Error", "Қате")));
                  }}
                >
                  {t("Приостановить", "Pause", "Тоқтату")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="min-h-11 rounded-xl border border-line px-3"
                  onClick={() => {
                    if (
                      window.confirm(
                        t(
                          "Отозвать все ключи пользователя?",
                          "Revoke all user keys?",
                          "Пайдаланушының барлық кілттерін қайтару керек пе?",
                        ),
                      )
                    )
                      void revokeVpnKeys({ data: { email: u.email } })
                        .then(() =>
                          toast(t("Ключи отозваны", "Keys revoked", "Кілттер қайтарылды")),
                        )
                        .catch(() => toast.error(t("Ошибка", "Error", "Қате")));
                  }}
                >
                  {t("Отозвать ключи", "Revoke keys", "Кілттерді қайтару")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </details>
      <details className="rounded-2xl border border-line p-3">
        <summary className="min-h-11 cursor-pointer py-3">
          {t("Журнал VPN · последние 50", "VPN log · latest 50", "VPN журналы · соңғы 50")}
        </summary>
        <input
          className="field my-2"
          placeholder={t("Фильтр по почте", "Filter by email", "Пошта бойынша сүзгі")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <ul className="space-y-2 text-xs">
          {desk.audit
            .filter((a) => a.email.toLowerCase().includes(filter.toLowerCase()))
            .map((a, i) => (
              <li key={i} className="break-words">
                {a.at} · {a.email} · {a.kind} · {a.note}
              </li>
            ))}
        </ul>
      </details>
      <details className="rounded-2xl border border-line p-3">
        <summary className="min-h-11 cursor-pointer py-3">
          {t("События серверов", "Server events", "Сервер оқиғалары")}
        </summary>
        <ul className="space-y-2 text-xs">
          {desk.events.map((e, i) => (
            <li key={i}>
              {e.at} · {e.name} · {e.reach}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
