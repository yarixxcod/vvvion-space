import { useEffect, useRef, useState } from "react";
import { ChevronLeft, Copy, ShieldCheck, RefreshCw, Smartphone } from "lucide-react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { encode } from "uqr";
import { toast } from "sonner";
import { PurchaseSheet } from "./purchase-sheet";
import { TopupSheet } from "./topup-sheet";
import { VerifyMailButton } from "./verify-mail";
import {
  addVpnDevice,
  buyVpn,
  claimVpnTrial,
  getVpnShowcase,
  reissueVpnDevice,
  revokeVpnDevice,
  rotateVpnToken,
  setVpnAutoRenew,
  type VpnShowcase,
} from "@/lib/social/vpn";
import {
  countryFlag,
  vpnApps,
  vpnDeepLink,
  vpnPlatform,
  vpnRelative,
  vpnServiceStatus,
  type VpnPlatform,
} from "@/lib/social/vpn-ui";
import { useLang, useTx } from "@/lib/lang";

function Qr({ value, label }: { value: string; label: string }) {
  const qr = encode(value);
  return (
    <svg
      viewBox={`-2 -2 ${qr.size + 4} ${qr.size + 4}`}
      className="size-44 rounded-2xl bg-white p-2"
      role="img"
      aria-label={label}
    >
      <rect x="-2" y="-2" width={qr.size + 4} height={qr.size + 4} fill="white" />
      {qr.data.flatMap((row, y) =>
        Array.from(row).flatMap((cell, x) =>
          cell ? <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="black" /> : [],
        ),
      )}
    </svg>
  );
}
const button =
  "press inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-line px-3 text-sm disabled:opacity-40";
export function VpnService({ onBack }: { onBack: () => void }) {
  const tx = useTx(),
    lang = useLang();
  const t = (ru: string, en: string, kk: string) => tx({ ru, en, kk });
  const [row, setRow] = useState<VpnShowcase | null>(null),
    [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false);
  const [origin, setOrigin] = useState(""),
    [platform, setPlatform] = useState<VpnPlatform>("desktop"),
    [deviceName, setDeviceName] = useState("");
  const [intent, setIntent] = useState<VpnShowcase["plans"][number] | null>(null),
    [topup, setTopup] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<{
    title: string;
    body: string;
    task: () => Promise<VpnShowcase>;
  } | null>(null);
  const keys = useRef(new Map<string, string>());
  const amount = (n: number) => `${n.toLocaleString(lang)} ${t("вуб", "vub", "вуб")}`;
  const gb = (n: number | null) =>
    n === null
      ? "—"
      : `${(n / 1024 ** 3).toLocaleString(lang, { maximumFractionDigits: 2 })} ${t("ГБ", "GB", "ГБ")}`;
  const date = (value: string | null) =>
    value
      ? new Intl.DateTimeFormat(lang, { day: "numeric", month: "long", year: "numeric" }).format(
          new Date(value),
        )
      : "—";
  const error = (err: unknown) => {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("3 дня"))
      return t(
        "Сменить тариф можно в последние 3 дня подписки или после её окончания",
        "Change plans in the last 3 days or after expiry",
        "Тарифті соңғы 3 күнде немесе мерзімі аяқталған соң ауыстыруға болады",
      );
    if (msg.startsWith("Нужно "))
      return t(
        "Недостаточно вублей. Пополните баланс",
        "Not enough vub. Top up your balance",
        "Вуб жеткіліксіз. Балансты толтырыңыз",
      );
    if (msg.includes("почт"))
      return t(
        "Сначала подтвердите почту в профиле",
        "Verify your email in your profile first",
        "Алдымен профильде поштаңызды растаңыз",
      );
    return t(
      "Не удалось выполнить действие. Обновите страницу VPN и повторите",
      "Could not complete the action. Refresh VPN and try again",
      "Әрекет орындалмады. VPN бетін жаңартып, қайталаңыз",
    );
  };
  function load() {
    setFailed(false);
    void getVpnShowcase()
      .then(setRow)
      .catch(() => setFailed(true));
  }
  useEffect(() => {
    setOrigin(window.location.origin);
    setPlatform(vpnPlatform(navigator.userAgent));
    load();
  }, []);
  async function run(task: () => Promise<VpnShowcase>) {
    if (busy) return;
    setBusy(true);
    try {
      setRow(await task());
      window.dispatchEvent(new Event("vv-wallet-refresh"));
      return true;
    } catch (e) {
      toast.error(error(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast(t("Ссылка скопирована", "Link copied", "Сілтеме көшірілді"));
    } catch {
      toast.error(
        t(
          "Не удалось скопировать. Выделите ссылку вручную",
          "Could not copy. Select the link manually",
          "Көшірілмеді. Сілтемені қолмен таңдаңыз",
        ),
      );
    }
  }
  const url = row?.token && origin ? `${origin}/api/vpn/${row.token}` : "";
  const activeDevices = row?.devices.filter((d) => !d.revoked) || [];
  const status = vpnServiceStatus(row?.places || []);
  const statusLabel = {
    empty: t("Нет серверов", "No servers", "Сервер жоқ"),
    ok: t("Работает", "Available", "Жұмыс істейді"),
    partial: t(
      "Часть серверов недоступна",
      "Some servers are unavailable",
      "Кейбір серверлер қолжетімсіз",
    ),
    maintenance: t("Серверы на обслуживании", "Servers are being checked", "Серверлер тексерілуде"),
  }[status];
  return (
    <div className="h-full overflow-x-hidden overflow-y-auto px-4 py-4">
      <div className="mx-auto max-w-5xl pb-6">
        <button
          type="button"
          className={`${button} border-transparent px-0 text-muted`}
          onClick={onBack}
        >
          <ChevronLeft className="size-4" />
          {t("Сервисы", "Services", "Сервистер")}
        </button>
        <header className="mt-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs tracking-widest text-muted">VVVION SPACE</p>
            <h2 className="font-serif text-4xl">VPN</h2>
            <p className="mt-1 text-sm text-muted">
              {t(
                "Ваше подключение, устройства и тариф",
                "Your connection, devices and plan",
                "Байланысыңыз, құрылғылар мен тариф",
              )}
            </p>
          </div>
          <ShieldCheck className="size-12 text-accent" />
        </header>
        {!row && !failed ? (
          <div
            aria-label={t("Загрузка VPN", "Loading VPN", "VPN жүктелуде")}
            className="mt-5 grid animate-pulse gap-3 sm:grid-cols-2"
          >
            <div className="h-52 rounded-3xl bg-subtle" />
            <div className="h-52 rounded-3xl bg-subtle" />
          </div>
        ) : null}
        {failed ? (
          <div role="alert" className="mt-4 rounded-2xl border border-line p-4">
            <p>
              {t(
                "VPN временно недоступен",
                "VPN is temporarily unavailable",
                "VPN уақытша қолжетімсіз",
              )}
            </p>
            <button className={`${button} mt-3`} onClick={load}>
              <RefreshCw className="size-4" />
              {t("Повторить", "Retry", "Қайталау")}
            </button>
          </div>
        ) : null}
        {row ? (
          <>
            <section className="mt-5 rounded-3xl border border-line bg-elev p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 text-sm">
                  <ShieldCheck
                    className={`size-4 ${status === "ok" ? "text-accent" : "text-muted"}`}
                  />
                  {statusLabel}
                </span>
                <span className="text-sm text-muted">{amount(row.balance)}</span>
              </div>
              <div className="mt-5 flex items-end justify-between gap-3">
                <div>
                  <p className="text-sm text-muted">
                    {row.active
                      ? t("Подписка активна", "Subscription active", "Жазылым белсенді")
                      : row.blocked
                        ? t("Доступ приостановлен", "Access paused", "Қолжетімділік тоқтатылды")
                        : t("Выберите тариф", "Choose a plan", "Тариф таңдаңыз")}
                  </p>
                  <p className="mt-1 font-serif text-4xl tabular-nums">
                    {row.active ? `${row.daysLeft} ${t("дн.", "days", "күн")}` : "VVVION VPN"}
                  </p>
                </div>
                {row.active ? (
                  <p className="text-right text-sm text-muted">{date(row.until)}</p>
                ) : null}
              </div>
              <div className="mt-5 flex justify-between gap-3 text-sm">
                <span>{t("Трафик", "Traffic", "Трафик")}</span>
                <span>
                  {row.usedBytes === null
                    ? t("Нет данных", "No data yet", "Дерек жоқ")
                    : `${gb(row.usedBytes)} / ${gb(row.trafficBytes)}`}
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-subtle">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{
                    width: `${row.usedBytes === null ? 0 : Math.min(100, (100 * row.usedBytes) / row.trafficBytes)}%`,
                  }}
                />
              </div>
              <p className="mt-2 text-xs text-muted">
                {row.usedBytes === null
                  ? t(
                      "Счётчик появится после первой проверки сервером",
                      "Traffic appears after the first server report",
                      "Трафик сервердің алғашқы есебінен кейін көрсетіледі",
                    )
                  : t("Отсчёт с", "Counting from", "Есептеу басталған уақыт") +
                    " " +
                    date(row.quotaReset)}
              </p>
              <details className="mt-4 text-sm text-muted">
                <summary className="min-h-11 cursor-pointer py-3">
                  {t("Подробности", "Details", "Толығырақ")}
                </summary>
                <p>
                  {t(
                    "Личное подключение настраивается автоматически. До завершения настройки прежний общий ключ может ещё действовать. Получение подписки приложением не подтверждает установку VPN-соединения.",
                    "Your personal connection is set up automatically. The previous shared key may remain active during setup. Fetching a subscription does not confirm a VPN connection.",
                    "Жеке байланыс автоматты түрде бапталады. Баптау кезінде бұрынғы ортақ кілт жұмыс істеуі мүмкін. Жазылымды жүктеу VPN қосылғанын растамайды.",
                  )}
                </p>
              </details>
            </section>
            {url ? (
              <section className="mt-4 rounded-3xl border border-line bg-elev p-4 sm:p-5">
                <h3 className="flex items-center gap-2 text-lg font-medium">
                  <Smartphone className="size-5" />
                  {t("Подключить", "Connect", "Қосылу")}
                </h3>
                <p className="mt-2 text-sm text-muted">
                  {row.lastPull
                    ? t(
                        "Подписку получило приложение ",
                        "Subscription fetched ",
                        "Жазылым жүктелді ",
                      ) + vpnRelative(row.lastPull, lang)
                    : t(
                        "Приложение ещё не получало подписку: откройте ссылку в приложении",
                        "No app has fetched your subscription yet: open it in an app",
                        "Қолданба жазылымды әлі жүктемеді: сілтемені қолданбада ашыңыз",
                      )}
                </p>
                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                  {vpnApps(platform).map((app) => (
                    <article key={app.id} className="rounded-2xl border border-line bg-bg p-3">
                      <h4 className="font-medium">{app.name}</h4>
                      <div className="mt-3 flex flex-col gap-2">
                        {vpnDeepLink(app.id, url) ? (
                          <a
                            href={vpnDeepLink(app.id, url)!}
                            className={`${button} bg-accent text-accent-fg`}
                          >
                            {t("Открыть в", "Open in", "Ашу")} {app.name}
                          </a>
                        ) : null}
                        <a
                          href={app.install}
                          rel="noopener noreferrer"
                          target="_blank"
                          className={button}
                        >
                          {t("Установить", "Install", "Орнату")}
                        </a>
                        <button className={button} onClick={() => void copy(url)}>
                          <Copy className="size-4" />
                          {t("Скопировать ссылку", "Copy link", "Сілтемені көшіру")}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
                <p className="mt-3 text-xs text-muted">
                  {t(
                    "Если используете Incy, скопируйте ссылку и добавьте её вручную в приложении.",
                    "For Incy, copy the subscription link and use the app's manual import.",
                    "Incy үшін сілтемені көшіріп, қолданбада қолмен импорттаңыз.",
                  )}
                </p>
                <details className="mt-4">
                  <summary className="min-h-11 cursor-pointer py-3 text-sm">
                    {t(
                      "Показать QR для другого устройства",
                      "Show QR for another device",
                      "Басқа құрылғы үшін QR көрсету",
                    )}
                  </summary>
                  <div className="flex justify-center py-3">
                    <Qr value={url} label={t("QR подписки", "Subscription QR", "Жазылым QR")} />
                  </div>
                </details>
                <details>
                  <summary className="min-h-11 cursor-pointer py-3 text-sm">
                    {t("Ссылка и безопасность", "Link and security", "Сілтеме және қауіпсіздік")}
                  </summary>
                  <p className="break-all rounded-xl bg-subtle p-3 font-mono text-xs">{url}</p>
                  <button
                    className={`${button} mt-3`}
                    disabled={busy}
                    onClick={() =>
                      setConfirm({
                        title: t("Новая ссылка", "New link", "Жаңа сілтеме"),
                        body: t(
                          "Прежняя ссылка перестанет обновляться. Добавьте новую ссылку во все приложения.",
                          "The old link will stop updating. Add the new link to all your apps.",
                          "Ескі сілтеме жаңартылмайды. Жаңа сілтемені барлық қолданбаға қосыңыз.",
                        ),
                        task: () => rotateVpnToken(),
                      })
                    }
                  >
                    {t("Новая ссылка", "New link", "Жаңа сілтеме")}
                  </button>
                </details>
                {row.plan !== "trial" ? (
                  <label className="mt-3 flex min-h-11 items-center justify-between gap-3 text-sm">
                    {t(
                      "Автопродление текущего тарифа",
                      "Renew current plan automatically",
                      "Ағымдағы тарифті автоматты ұзарту",
                    )}
                    <input
                      type="checkbox"
                      className="size-5 accent-[var(--accent)]"
                      disabled={busy}
                      checked={row.autoRenew}
                      onChange={() =>
                        void run(() => setVpnAutoRenew({ data: { on: !row.autoRenew } }))
                      }
                    />
                  </label>
                ) : null}
              </section>
            ) : null}
            {!row.verified ? (
              <div className="mt-4">
                <VerifyMailButton onVerified={load} />
              </div>
            ) : null}
            {row.trialAvailable ? (
              <section className="mt-4 rounded-3xl border border-accent/40 bg-accent/10 p-4">
                <h3 className="text-lg font-medium">
                  {t("Попробовать бесплатно", "Try for free", "Тегін сынау")}
                </h3>
                <p className="mt-2 text-sm text-muted">
                  {row.trialDays} {t("дней", "days", "күн")} · {gb(row.trialTraffic)}
                </p>
                <button
                  disabled={busy}
                  className={`${button} mt-3 bg-accent text-accent-fg`}
                  onClick={() => void run(() => claimVpnTrial())}
                >
                  {busy
                    ? t("Подключаем…", "Activating…", "Қосылуда…")
                    : t("Включить пробный период", "Start trial", "Сынақ мерзімін бастау")}
                </button>
              </section>
            ) : null}
            {row.highUsage ? (
              <p className="mt-4 rounded-2xl border border-line p-4 text-sm">
                {t(
                  "Необычно большой расход трафика? Проверьте устройства и создайте новую ссылку в разделе безопасности.",
                  "Unusually high traffic? Review your devices and create a new link in security settings.",
                  "Трафик әдеттегіден көп пе? Құрылғыларды тексеріп, қауіпсіздік бөлімінде жаңа сілтеме жасаңыз.",
                )}
              </p>
            ) : null}
            <section className="mt-5">
              <h3 className="text-xl font-medium">{t("Тарифы", "Plans", "Тарифтер")}</h3>
              <p className="mt-1 text-sm text-muted">
                {t(
                  "Продлевайте свой тариф в любое время. Смена доступна в последние 3 дня срока.",
                  "Renew your plan at any time. Switching is available in the last 3 days.",
                  "Өз тарифіңізді кез келген уақытта ұзартыңыз. Ауыстыру соңғы 3 күнде қолжетімді.",
                )}
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {row.plans
                  .filter((p) => p.id !== "trial")
                  .map((plan) => (
                    <article
                      key={plan.id}
                      className={`flex flex-col rounded-3xl border bg-elev p-4 ${plan.current ? "border-accent" : "border-line"}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <h4 className="text-lg font-medium">
                          {plan.id === "base"
                            ? t("Базовый", "Base", "Негізгі")
                            : plan.id === "plus"
                              ? t("Расширенный", "Plus", "Кеңейтілген")
                              : plan.id === "family"
                                ? t("Семейный", "Family", "Отбасылық")
                                : plan.title}
                        </h4>
                        {plan.current ? (
                          <span className="rounded-full bg-accent/15 px-2 py-1 text-xs text-fg">
                            {t("Ваш тариф", "Your plan", "Сіздің тарифіңіз")}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-4 font-serif text-3xl">{amount(plan.price)}</p>
                      <p className="mt-2 text-sm text-muted">
                        {plan.days} {t("дней", "days", "күн")} · {gb(plan.trafficBytes)} ·{" "}
                        {plan.deviceCap} {t("устр.", "devices", "құрылғы")}
                      </p>
                      <button
                        disabled={busy || !row.verified || !plan.canSwitch}
                        className={`${button} mt-4 w-full bg-accent text-accent-fg`}
                        onClick={() => setIntent(plan)}
                      >
                        {plan.current
                          ? t("Продлить", "Renew", "Ұзарту")
                          : t("Выбрать", "Select", "Таңдау")}
                      </button>
                      {!plan.canSwitch ? (
                        <p className="mt-2 text-xs text-muted">
                          {plan.reason === "disabled"
                            ? t("Тариф отключён", "Plan disabled", "Тариф өшірілген")
                            : t(
                                "Смена доступна в последние 3 дня подписки или после её окончания",
                                "Switch in the last 3 days or after expiry",
                                "Соңғы 3 күнде немесе мерзімі аяқталған соң ауыстырыңыз",
                              )}
                        </p>
                      ) : null}
                    </article>
                  ))}
              </div>
            </section>
            {row.outages.length ? (
              <details className="mt-4 rounded-2xl border border-line p-4 text-sm">
                <summary className="min-h-11 cursor-pointer py-3">
                  {t("Перерывы за 7 дней", "Interruptions over 7 days", "7 күндегі үзілістер")}
                </summary>
                <ul className="space-y-2">
                  {row.outages.map((e, i) => (
                    <li key={i}>
                      {e.name} · {date(e.at)} · {e.minutes} {t("мин.", "min", "мин.")}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {row.active ? (
              <section className="mt-5 rounded-3xl border border-line p-4">
                <h3 className="text-lg font-medium">
                  {t("Устройства", "Devices", "Құрылғылар")} · {activeDevices.length}/
                  {row.deviceCap}
                </h3>
                <p className="mt-2 text-xs text-muted">
                  {t(
                    "Каждому устройству — отдельная ссылка. Если лимит нового тарифа меньше, отзовите лишние ссылки перед добавлением новых.",
                    "Give each device its own link. If your new plan has a lower limit, revoke extra links before adding another.",
                    "Әр құрылғыға жеке сілтеме. Жаңа тариф лимиті аз болса, жаңасын қоспас бұрын артық сілтемелерді қайтарыңыз.",
                  )}
                </p>
                <ul className="mt-3 space-y-2">
                  {activeDevices.map((d) => (
                    <li className="rounded-2xl bg-subtle p-3" key={d.id}>
                      <p className="break-words font-medium">{d.name}</p>
                      <p className="mt-1 text-xs text-muted">{vpnRelative(d.lastPull, lang)}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          className={button}
                          disabled={!d.token}
                          onClick={() => void copy(`${origin}/api/vpn/${d.token}`)}
                        >
                          {t("Скопировать", "Copy", "Көшіру")}
                        </button>
                        <button
                          className={button}
                          disabled={busy}
                          onClick={() =>
                            setConfirm({
                              title: t("Новый ключ", "New key", "Жаңа кілт"),
                              body: t(
                                "Старую ссылку устройства потребуется заменить в приложении.",
                                "Replace the old device link in its app.",
                                "Қолданбадағы ескі құрылғы сілтемесін ауыстырыңыз.",
                              ),
                              task: () => reissueVpnDevice({ data: d.id }),
                            })
                          }
                        >
                          {t("Новый ключ", "New key", "Жаңа кілт")}
                        </button>
                        <button
                          className={`${button} text-danger`}
                          disabled={busy}
                          onClick={() =>
                            setConfirm({
                              title: t("Отозвать устройство", "Revoke device", "Құрылғыны қайтару"),
                              body: t(
                                "Эта ссылка перестанет работать. Для подключения понадобится новая.",
                                "This link will stop working. A new one will be needed to connect.",
                                "Бұл сілтеме жұмыс істемейді. Қосылуға жаңасы қажет.",
                              ),
                              task: () => revokeVpnDevice({ data: d.id }),
                            })
                          }
                        >
                          {t("Отозвать", "Revoke", "Қайтару")}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
                <form
                  className="mt-3 flex flex-wrap gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(() => addVpnDevice({ data: { name: deviceName } })).then((ok) => {
                      if (ok) setDeviceName("");
                    });
                  }}
                >
                  <input
                    aria-label={t("Название устройства", "Device name", "Құрылғы атауы")}
                    placeholder={t("Мой телефон", "My phone", "Менің телефоным")}
                    className="field min-w-0 flex-1"
                    value={deviceName}
                    maxLength={32}
                    onChange={(e) => setDeviceName(e.target.value)}
                  />
                  <button
                    disabled={busy || !deviceName.trim() || activeDevices.length >= row.deviceCap}
                    className={button}
                  >
                    {t("Добавить", "Add", "Қосу")}
                  </button>
                </form>
              </section>
            ) : null}
            <section className="mt-5">
              <h3 className="text-lg font-medium">
                {t("Статус серверов", "Server status", "Серверлер күйі")}
              </h3>
              {!row.places.length ? (
                <p className="mt-3 rounded-2xl border border-line p-4 text-sm text-muted">
                  {t(
                    "Серверов пока нет. Попробуйте позже.",
                    "No servers yet. Please try later.",
                    "Сервер әлі жоқ. Кейінірек қайталаңыз.",
                  )}
                </p>
              ) : (
                <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                  {row.places.map((p, i) => (
                    <li key={i} className="rounded-2xl border border-line p-3">
                      <div className="flex justify-between gap-2">
                        <div className="min-w-0">
                          <p className="break-words text-sm font-medium">
                            {countryFlag(p.country)} {p.name}
                          </p>
                          <p className="mt-1 text-xs text-muted">
                            {[p.city, p.country].filter(Boolean).join(", ")}
                          </p>
                        </div>
                        <span className="shrink-0 text-xs">
                          {p.pingMs === null ? "—" : `${p.pingMs} ms`}
                        </span>
                      </div>
                      <p className="mt-3 text-sm">
                        {p.maintenance
                          ? t(
                              "Обслуживание · подождите",
                              "Maintenance · please wait",
                              "Қызмет көрсету · күтіңіз",
                            )
                          : p.reach === "up"
                            ? t("На связи", "Online", "Байланыста")
                            : p.reach === "down"
                              ? t(
                                  "Недоступен · выберите другой",
                                  "Unavailable · choose another",
                                  "Қолжетімсіз · басқасын таңдаңыз",
                                )
                              : t(
                                  "Проверяем · подождите",
                                  "Checking · please wait",
                                  "Тексерілуде · күтіңіз",
                                )}
                      </p>
                      <p
                        className={`mt-1 text-xs ${p.lastCheck && Date.now() - Date.parse(p.lastCheck) < 900000 ? "text-muted" : "text-faint"}`}
                      >
                        {t("Проверено ", "Checked ", "Тексерілді ")}
                        {vpnRelative(p.lastCheck, lang)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {row.history.length ? (
              <details className="mt-5 rounded-2xl border border-line p-4">
                <summary className="min-h-11 cursor-pointer py-3 text-sm">
                  {t("История покупок", "Purchase history", "Сатып алу тарихы")}
                </summary>
                <ul>
                  {row.history.map((h) => (
                    <li key={h.id} className="flex justify-between gap-3 py-2 text-sm">
                      <span>{date(h.at)}</span>
                      <span>{amount(h.amount)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            <PurchaseSheet
              formatAmount={amount}
              open={!!intent}
              title={`VPN · ${intent?.title || ""}`}
              price={intent?.price || 0}
              balance={row.balance}
              detail={
                intent
                  ? `${intent.days} ${t("дней", "days", "күн")} · ${gb(intent.trafficBytes)}. ${t("Останется на балансе:", "Balance after purchase:", "Сатып алғаннан кейінгі баланс:")} ${amount(Math.max(0, row.balance - intent.price))}`
                  : ""
              }
              busy={busy}
              onClose={() => {
                if (!busy) setIntent(null);
              }}
              onConfirm={() => {
                if (!intent) return;
                let key = keys.current.get(intent.id);
                if (!key) {
                  key = crypto.randomUUID();
                  keys.current.set(intent.id, key);
                }
                void run(() => buyVpn({ data: { planId: intent.id, idem: key } })).then((ok) => {
                  if (ok) {
                    keys.current.delete(intent.id);
                    setIntent(null);
                  }
                });
              }}
              onTopup={(need) => {
                setIntent(null);
                setTopup(need);
              }}
            />
            <TopupSheet
              open={topup !== null}
              needVub={topup || undefined}
              returnTo="shop"
              onClose={() => setTopup(null)}
              onPaid={() => {
                setTopup(null);
                load();
              }}
            />
          </>
        ) : null}
        <AlertDialog.Root
          open={!!confirm}
          onOpenChange={(open) => {
            if (!open && !busy) setConfirm(null);
          }}
        >
          <AlertDialog.Portal>
            <AlertDialog.Overlay className="fixed inset-0 z-[80] bg-black/50" />
            <AlertDialog.Content className="fixed inset-x-0 bottom-0 z-[81] rounded-t-3xl border border-line bg-elev p-5 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:w-[min(420px,90vw)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl">
              <AlertDialog.Title className="text-xl font-medium">
                {confirm?.title}
              </AlertDialog.Title>
              <AlertDialog.Description className="mt-2 text-sm text-muted">
                {confirm?.body}
              </AlertDialog.Description>
              <div className="mt-4 flex gap-2">
                <AlertDialog.Cancel disabled={busy} className={`${button} flex-1`}>
                  {t("Отмена", "Cancel", "Бас тарту")}
                </AlertDialog.Cancel>
                <button
                  disabled={busy}
                  className={`${button} flex-1 bg-accent text-accent-fg`}
                  onClick={() => {
                    if (confirm)
                      void run(confirm.task).then((ok) => {
                        if (ok) setConfirm(null);
                      });
                  }}
                >
                  {busy
                    ? t("Подождите…", "Please wait…", "Күтіңіз…")
                    : t("Подтвердить", "Confirm", "Растау")}
                </button>
              </div>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      </div>
    </div>
  );
}
