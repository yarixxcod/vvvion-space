import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  appAskNotifications,
  appNotificationsEnabled,
  appOpenNotificationSettings,
  isApp,
  rememberPreview,
} from "@/lib/app-bridge";
import { getBearerToken } from "@/lib/auth/client";
import { haptic } from "@/lib/haptic";
import { useTx } from "@/lib/lang";

type PushSettings = {
  messages: boolean;
  ai: boolean;
  subs: boolean;
  money: boolean;
  security: boolean;
  system: boolean;
  preview: boolean;
  quietFrom: number;
  quietTo: number;
};

const DEFAULTS: PushSettings = {
  messages: true,
  ai: true,
  subs: true,
  money: true,
  security: true,
  system: false,
  preview: false,
  quietFrom: 23,
  quietTo: 8,
};
const DENIALS = "vvvion.notify.denials";

function hour(value: unknown, fallback: number) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : fallback;
}

function readSettings(data: Partial<PushSettings>): PushSettings {
  return {
    messages: data.messages !== false,
    ai: data.ai !== false,
    subs: data.subs !== false,
    money: data.money !== false,
    security: true,
    system: data.system === true,
    preview: data.preview === true,
    quietFrom: hour(data.quietFrom, 23),
    quietTo: hour(data.quietTo, 8),
  };
}

function lowEndOn() {
  try {
    const stored = Number(localStorage.getItem("vv.lowend") || "0");
    return stored > 0 && Date.now() - stored < 7 * 86_400_000;
  } catch {
    return false;
  }
}

function applyLowEnd(on: boolean) {
  try {
    if (on) localStorage.setItem("vv.lowend", String(Date.now()));
    else localStorage.removeItem("vv.lowend");
  } catch {
    /* private mode */
  }
  document.documentElement.classList.toggle("vv-lowend", on);
  try {
    window.VvvionApp?.setLowEnd?.(on);
  } catch {
    /* the shell has gone */
  }
}

function headers() {
  const next = new Headers({ "content-type": "application/json" });
  const token = getBearerToken();
  if (token) next.set("Authorization", `Bearer ${token}`);
  return next;
}

export function PushSettingsCard() {
  const tx = useTx();
  const [settings, setSettings] = useState<PushSettings>(DEFAULTS);
  const [ready, setReady] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [denials, setDenials] = useState(0);
  const [economy, setEconomy] = useState(false);
  const asked = useRef(false);
  const inApp = isApp();

  useEffect(() => {
    let dead = false;
    void fetch("/api/push/settings", { credentials: "same-origin", headers: headers() })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as Partial<PushSettings>;
        if (dead) return;
        const next = readSettings(data);
        setSettings(next);
        rememberPreview(next.preview);
        setReady(true);
      })
      .catch(() => undefined);
    return () => {
      dead = true;
    };
  }, []);

  useEffect(() => {
    setEconomy(lowEndOn());
  }, []);

  useEffect(() => {
    if (!inApp) return;
    setEnabled(appNotificationsEnabled());
    try {
      setDenials(Number(localStorage.getItem(DENIALS) || "0") || 0);
    } catch {
      /* private mode */
    }
    const onChange = (event: Event) => {
      const on = Boolean((event as CustomEvent<{ enabled?: boolean }>).detail?.enabled);
      setEnabled(on);
      if (on) {
        asked.current = false;
        try {
          localStorage.setItem(DENIALS, "0");
        } catch {
          /* ignore */
        }
        setDenials(0);
        return;
      }
      if (!asked.current) return;
      asked.current = false;
      setDenials((current) => {
        const next = current + 1;
        try {
          localStorage.setItem(DENIALS, String(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    };
    window.addEventListener("vvvion-app-notifications", onChange);
    return () => window.removeEventListener("vvvion-app-notifications", onChange);
  }, [inApp]);

  async function save(next: PushSettings) {
    const prev = settings;
    setSettings(next);
    rememberPreview(next.preview);
    try {
      const res = await fetch("/api/push/settings", {
        method: "PUT",
        credentials: "same-origin",
        headers: headers(),
        body: JSON.stringify(next),
      });
      if (!res.ok) throw new Error("Не сохранилось");
      const saved = readSettings((await res.json()) as PushSettings);
      setSettings(saved);
      rememberPreview(saved.preview);
    } catch {
      setSettings(prev);
      rememberPreview(prev.preview);
      toast.error(tx({ ru: "Не удалось сохранить уведомления", en: "Couldn’t save notifications", kk: "Хабарламалар сақталмады" }));
    }
  }

  function ask() {
    asked.current = true;
    appAskNotifications();
  }

  const rows: { key: "messages" | "ai" | "subs" | "money" | "system" | "preview"; label: string; hint: string }[] = [
    {
      key: "messages",
      label: tx({ ru: "Сообщения", en: "Messages", kk: "Хабарламалар" }),
      hint: tx({ ru: "Личные и групповые", en: "Direct and groups", kk: "Жеке және топтық" }),
    },
    {
      key: "ai",
      label: tx({ ru: "Ответы ИИ", en: "AI replies", kk: "ЖИ жауаптары" }),
      hint: tx({ ru: "Когда ответ дописан", en: "When a reply is ready", kk: "Жауап дайын болғанда" }),
    },
    {
      key: "subs",
      label: tx({ ru: "Подписки", en: "Subscriptions", kk: "Жазылымдар" }),
      hint: tx({ ru: "MegaDisk, Премиум и VPN", en: "MegaDisk, Premium and VPN", kk: "MegaDisk, Премиум және VPN" }),
    },
    {
      key: "money",
      label: tx({ ru: "Вубли и платежи", en: "Vubles and payments", kk: "Вубли және төлемдер" }),
      hint: tx({ ru: "Переводы и покупки", en: "Transfers and purchases", kk: "Аударымдар мен сатып алулар" }),
    },
    {
      key: "system",
      label: tx({ ru: "Новости проекта", en: "Project news", kk: "Жоба жаңалықтары" }),
      hint: tx({ ru: "Выключено, пока вы сами не включите", en: "Off until you turn it on", kk: "Өзіңіз қосқанша өшік" }),
    },
    {
      key: "preview",
      label: tx({ ru: "Показывать текст сообщений", en: "Show message text", kk: "Хабарлама мәтінін көрсету" }),
      hint: tx({
        ru: "На заблокированном экране. Выключено — только «Новое сообщение»",
        en: "On the lock screen. Off means only “New message”",
        kk: "Құлыптаулы экранда. Өшірулі болса — тек «Жаңа хабарлама»",
      }),
    },
  ];

  return (
    <section className="mt-4 rounded-3xl border border-line bg-elev p-4">
      <p className="text-sm font-medium">{tx({ ru: "Уведомления в приложении", en: "App notifications", kk: "Қолданба хабарламалары" })}</p>
      <p className="mt-1 text-xs text-faint">
        {tx({
          ru: "Сообщения, ответы и сроки подписок. Текст переписки на заблокированном экране по умолчанию скрыт.",
          en: "Messages, replies and subscription dates. Message text stays off the lock screen unless you turn it on.",
          kk: "Хабарламалар, жауаптар және жазылым мерзімі. Хат мәтіні құлыптаулы экранда әдепкіде жасырын.",
        })}
      </p>
      {inApp ? (
        <div className="mt-3">
          {denials >= 2 && !enabled ? (
            <button type="button" className="press h-11 w-full rounded-2xl border border-line px-3 text-sm" onClick={() => appOpenNotificationSettings()}>
              {tx({ ru: "Открыть настройки", en: "Open settings", kk: "Баптауды ашу" })}
            </button>
          ) : (
            <button
              type="button"
              aria-pressed={enabled}
              className="press flex h-11 w-full items-center justify-between rounded-2xl border border-line px-3 text-sm"
              onClick={() => {
                if (!enabled) ask();
              }}
            >
              <span>{tx({ ru: "Уведомления в приложении", en: "Notifications in the app", kk: "Қолданбадағы хабарламалар" })}</span>
              <span className={enabled ? "text-fg" : "text-faint"}>{enabled ? tx({ ru: "Вкл", en: "On", kk: "Қос" }) : tx({ ru: "Выкл", en: "Off", kk: "Өшік" })}</span>
            </button>
          )}
        </div>
      ) : null}
      <div className="mt-2 space-y-1.5">
        {rows.map((row) => (
          <button
            key={row.key}
            type="button"
            disabled={!ready}
            aria-pressed={settings[row.key]}
            className="press flex w-full items-center justify-between gap-3 rounded-2xl border border-line px-3 py-2 text-left disabled:opacity-50"
            onClick={() => {
              haptic("light");
              void save({ ...settings, [row.key]: !settings[row.key] });
            }}
          >
            <span>
              <span className="block text-sm">{row.label}</span>
              <span className="block text-xs text-faint">{row.hint}</span>
            </span>
            <span className={settings[row.key] ? "text-sm text-fg" : "text-sm text-faint"}>
              {settings[row.key] ? tx({ ru: "Вкл", en: "On", kk: "Қос" }) : tx({ ru: "Выкл", en: "Off", kk: "Өшік" })}
            </span>
          </button>
        ))}
        <div className="flex w-full items-center justify-between gap-3 rounded-2xl border border-line px-3 py-2 text-left">
          <span>
            <span className="block text-sm">{tx({ ru: "Безопасность", en: "Security", kk: "Қауіпсіздік" })}</span>
            <span className="block text-xs text-faint">
              {tx({ ru: "Пароль и входы. Всегда включено", en: "Password and sign-ins. Always on", kk: "Құпиясөз және кіру. Әрқашан қосулы" })}
            </span>
          </span>
          <span className="text-sm text-fg">{tx({ ru: "Вкл", en: "On", kk: "Қос" })}</span>
        </div>
        <label className="block rounded-2xl border border-line px-3 py-2">
          <span className="block text-sm">{tx({ ru: "Тихие часы", en: "Quiet hours", kk: "Тыныш сағаттар" })}</span>
          <span className="block text-xs text-faint">
            {tx({
              ru: "По Москве. Одинаковые часы — без тишины. Безопасность не замолкает.",
              en: "Moscow time. Same hour means no quiet period. Security stays on.",
              kk: "Мәскеу уақыты. Бірдей сағат — тыныштық жоқ. Қауіпсіздік үнсіз қалмайды.",
            })}
          </span>
          <span className="mt-2 flex items-center gap-2">
            <select
              className="field h-10"
              aria-label={tx({ ru: "Тишина с", en: "Quiet from", kk: "Тыныштық басталуы" })}
              value={settings.quietFrom}
              disabled={!ready}
              onChange={(event) => {
                haptic("light");
                void save({ ...settings, quietFrom: hour(event.target.value, settings.quietFrom) });
              }}
            >
              {Array.from({ length: 24 }, (_, hourOfDay) => (
                <option key={hourOfDay} value={hourOfDay}>
                  {String(hourOfDay).padStart(2, "0")}:00
                </option>
              ))}
            </select>
            <span className="text-faint">—</span>
            <select
              className="field h-10"
              aria-label={tx({ ru: "Тишина до", en: "Quiet until", kk: "Тыныштық аяқталуы" })}
              value={settings.quietTo}
              disabled={!ready}
              onChange={(event) => {
                haptic("light");
                void save({ ...settings, quietTo: hour(event.target.value, settings.quietTo) });
              }}
            >
              {Array.from({ length: 24 }, (_, hourOfDay) => (
                <option key={hourOfDay} value={hourOfDay}>
                  {String(hourOfDay).padStart(2, "0")}:00
                </option>
              ))}
            </select>
          </span>
        </label>
      </div>
      <button
        type="button"
        aria-pressed={economy}
        className="press mt-2 flex w-full items-center justify-between gap-3 rounded-2xl border border-line px-3 py-2 text-left"
        onClick={() => {
          const next = !economy;
          setEconomy(next);
          applyLowEnd(next);
          haptic("light");
        }}
      >
        <span>
          <span className="block text-sm">{tx({ ru: "Режим экономии анимаций", en: "Lighter animations", kk: "Жеңіл анимация" })}</span>
          <span className="block text-xs text-faint">
            {tx({ ru: "Меньше движения на слабом телефоне. Запоминается на неделю.", en: "Less motion on a slow phone. Remembered for a week.", kk: "Баяу телефонда аз қозғалыс. Бір апта есте сақталады." })}
          </span>
        </span>
        <span className={economy ? "text-sm text-fg" : "text-sm text-faint"}>{economy ? tx({ ru: "Вкл", en: "On", kk: "Қос" }) : tx({ ru: "Выкл", en: "Off", kk: "Өшік" })}</span>
      </button>
    </section>
  );
}
