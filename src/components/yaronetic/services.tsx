import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowUpRight, ChevronLeft, ExternalLink, Plus, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { forgetCity, loadWeather, watchCity } from "@/lib/weather/service";
import { setWidgetCity } from "@/lib/app-bridge";
import { weatherKind, type WeatherCard, type WeatherKind } from "@/lib/weather/parse";
import { PageLoader } from "@/components/yaronetic/page-loader";
import { loadNews } from "@/lib/news/service";
import { NEWS_COUNTRIES, type NewsCode, type NewsItem } from "@/lib/news/parse";
import { loadRates } from "@/lib/fx/service";
import { FX_CODES, type FxBoard, type FxCode } from "@/lib/fx/parse";
import { VpnService } from "@/components/yaronetic/vpn";
import { ApiService } from "@/components/yaronetic/api-service";
import { getApiEntry } from "@/lib/api/desk";
import { SpeedTest } from "@/components/yaronetic/speed-test";
import { Grabber } from "@/components/yaronetic/grabber";
import { CalendarDesk } from "@/components/yaronetic/calendar";
import { useTx } from "@/lib/lang";
import { loadError } from "@/lib/load-error";
import { type ServiceView } from "@/lib/service-view";

const COUNTRY_NAME: Record<NewsCode, string> = {
  KZ: "Казахстан",
  RU: "Россия",
  UZ: "Узбекистан",
  KG: "Кыргызстан",
  BY: "Беларусь",
};

const NEWS_KEY = "vvvion.newsCountries";
const FX_KEY = "vvvion.fxBase";

const FX_NAME: Record<FxCode, string> = {
  USD: "Доллар",
  EUR: "Евро",
  RUB: "Рубль",
  KZT: "Тенге",
  UZS: "Сум",
  KGS: "Сом",
  BYN: "Бел. рубль",
};

const FX_SIGN: Record<FxCode, string> = {
  USD: "$",
  EUR: "€",
  RUB: "₽",
  KZT: "₸",
  UZS: "сум",
  KGS: "сом",
  BYN: "Br",
};

const FX_COIN: Record<FxCode, { paper: string; ink: string }> = {
  USD: { paper: "#1c1b19", ink: "#f3efe6" },
  EUR: { paper: "#c4b5e8", ink: "#1b1526" },
  RUB: { paper: "#e8c98a", ink: "#1c1b19" },
  KZT: { paper: "#f3efe6", ink: "#1c1b19" },
  UZS: { paper: "#e5eee4", ink: "#1c1b19" },
  KGS: { paper: "#f6e6d8", ink: "#1c1b19" },
  BYN: { paper: "#f3e4e1", ink: "#1c1b19" },
};

export function Services({
  initial = null,
  eventId,
  onWide,
  onNested,
}: {
  initial?: ServiceView | null;
  eventId?: string;
  onWide?: (wide: boolean) => void;
  onNested?: (nested: boolean) => void;
}) {
  const tx = useTx();
  const navigate = useNavigate();
  const [view, setView] = useState<ServiceView | null>(initial);
  const [apiOn, setApiOn] = useState(false);
  const backRef = useRef<() => void>(() => undefined);
  function searchFor(next: ServiceView | null): { place: "services"; lang?: "en" | "kk"; svc?: ServiceView; event?: string } {
    const raw = new URL(window.location.href).searchParams.get("lang");
    const lang: "en" | "kk" | undefined = raw === "en" || raw === "kk" ? raw : undefined;
    const event = new URL(window.location.href).searchParams.get("event");
    return {
      place: "services",
      ...(lang ? { lang } : {}),
      ...(next ? { svc: next } : {}),
      ...(next === "calendar" && event && /^[A-Za-z0-9_-]{8,80}$/.test(event) ? { event } : {}),
    };
  }
  function open(id: ServiceView) {
    onNested?.(true);
    setView(id);
    void navigate({ to: "/", search: searchFor(id) });
  }
  function back() {
    onNested?.(false);
    setView(null);
    void navigate({ to: "/", search: searchFor(null), replace: true });
  }
  backRef.current = back;
  useEffect(() => {
    setView(initial ?? null);
  }, [initial]);
  useEffect(() => {
    onWide?.(view === "calendar");
    return () => onWide?.(false);
  }, [onWide, view]);
  useEffect(() => {
    void getApiEntry().then((row) => setApiOn(row.visible)).catch(() => setApiOn(false));
  }, []);
  useEffect(() => {
    const onBack = () => backRef.current();
    window.addEventListener("vv-service-back", onBack);
    return () => window.removeEventListener("vv-service-back", onBack);
  }, []);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("vv-circle-nested", { detail: view !== null }));
    return () => {
      window.dispatchEvent(new CustomEvent("vv-circle-nested", { detail: false }));
    };
  }, [view]);
  if (view === "weather") return <Weather onBack={back} />;
  if (view === "news") return <News onBack={back} />;
  if (view === "fx") return <Rates onBack={back} />;
  if (view === "vpn") return <VpnService onBack={back} />;
  if (view === "speed") return <SpeedTest onBack={back} />;
  if (view === "grab") return <Grabber onBack={back} />;
  if (view === "api") return <ApiService onBack={back} />;
  if (view === "calendar") return <CalendarDesk eventId={eventId} onBack={back} />;
  const tiles = [
    {
      id: "calendar",
      title: tx({ ru: "Календарь", en: "Calendar", kk: "Күнтізбе" }),
      desc: tx({ ru: "Встречи и напоминания", en: "Events and reminders", kk: "Кездесу мен еске салу" }),
    },
    {
      id: "weather",
      title: tx({ ru: "Погода", en: "Weather", kk: "Ауа райы" }),
      desc: tx({ ru: "Прогноз и советы", en: "Forecast & advice", kk: "Болжам мен кеңес" }),
    },
    {
      id: "news",
      title: tx({ ru: "Новости", en: "News", kk: "Жаңалықтар" }),
      desc: tx({ ru: "Главное по странам", en: "Headlines by country", kk: "Елдер жаңалықтары" }),
    },
    {
      id: "fx",
      title: tx({ ru: "Курсы валют", en: "Exchange rates", kk: "Валюта бағамы" }),
      desc: tx({ ru: "Курсы и конвертер", en: "Rates & converter", kk: "Бағам мен айырбастау" }),
    },
    {
      id: "vpn",
      title: "VPN",
      desc: tx({ ru: "Ваше подключение", en: "Your connection", kk: "Сіздің байланысыңыз" }),
    },
    {
      id: "grab",
      title: tx({ ru: "Загрузчик", en: "Downloader", kk: "Жүктеуіш" }),
      desc: "YouTube · Instagram · VK",
    },
    {
      id: "speed",
      title: tx({ ru: "Скорость", en: "Speed test", kk: "Жылдамдық" }),
      desc: tx({
        ru: "Интернет под контролем",
        en: "Check your internet",
        kk: "Интернетті тексеру",
      }),
    },
    ...(apiOn
      ? [{
          id: "api" as const,
          title: "API",
          desc: tx({
            ru: "Ключи и подключение к своим инструментам",
            en: "Keys for your own tools",
            kk: "Өз құралдарыңызға кілттер",
          }),
        }]
      : []),
  ] as const;
  return (
    <div className="h-full overflow-y-auto px-4 py-4" data-services-grid>
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h3 className="font-serif text-2xl tracking-tight">
            {tx({ ru: "На каждый день", en: "Everyday essentials", kk: "Күн сайын" })}
          </h3>
          <p className="mt-1 text-sm text-muted">
            {tx({
              ru: "Полезное — в одном месте",
              en: "Useful tools in one place",
              kk: "Пайдалы құралдар бір жерде",
            })}
          </p>
        </div>
        <span className="pb-1 text-xs tabular-nums text-faint">
          {tiles.length} {tx({ ru: "сервисов", en: "tools", kk: "сервис" })}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 min-[600px]:grid-cols-3">
        {tiles.map((tile) => (
          <button
            key={tile.id}
            type="button"
            onClick={() => open(tile.id)}
            className="service-tile press group relative flex aspect-square min-w-0 flex-col overflow-hidden rounded-[1.4rem] border border-line bg-elev text-left"
            aria-label={tile.title}
          >
            <img
              src={`/services/${tile.id}-${tile.id === "api" ? "v3" : "v2"}.webp`}
              alt=""
              width="512"
              height="512"
              className="service-tile-art absolute inset-0 h-full w-full object-cover"
              draggable={false}
            />
            <span className="service-tile-shade absolute inset-0" />
            {tile.id === "speed" || tile.id === "calendar" ? (
              <span className="absolute top-2.5 left-2.5 rounded-full bg-[#d6f4e9] px-2 py-0.5 text-[10px] font-semibold text-[#153b2e]">
                {tx({ ru: "НОВОЕ", en: "NEW", kk: "ЖАҢА" })}
              </span>
            ) : null}
            <ArrowUpRight
              className="absolute top-3 right-3 size-4 text-white/70"
              aria-hidden="true"
            />
            <span className="relative mt-auto block w-full px-3 pb-3 pt-12">
              <span className="block text-[16px] font-semibold leading-tight text-white sm:text-lg">
                {tile.title}
              </span>
              <span className="mt-1 block truncate text-[11px] text-white/75 sm:text-xs">
                {tile.desc}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ServiceBanner({ kind }: { kind: "weather" | "news" | "fx" }) {
  return (
    <div className="relative h-24 overflow-hidden rounded-2xl bg-[#21182d]" aria-hidden="true">
      <img
        src={`/services/${kind}-v2.webp`}
        alt=""
        className="h-full w-full object-cover object-[center_42%]"
      />
      <span className="absolute inset-0 bg-black/10" />
    </div>
  );
}
function SkyArt() {
  return <ServiceBanner kind="weather" />;
}
function FxArt({ compact }: { compact?: boolean }) {
  return <ServiceBanner kind="fx" />;
}

function Weather({ onBack }: { onBack: () => void }) {
  const tx = useTx();
  const [cards, setCards] = useState<WeatherCard[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [weatherError, setWeatherError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setWeatherError(false);
    setCards(null);
    void loadWeather()
      .then((rows) => {
        if (cancelled) return;
        setCards(rows);
        setWidgetCity(rows[0]?.city || "Алматы");
      })
      .catch(() => {
        if (!cancelled) {
          setCards([]);
          setWeatherError(true);
          toast.error(
            tx({
              ru: "Погода сейчас не открылась",
              en: "Weather did not open",
              kk: "Ауа райы ашылмады",
            }),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  async function add(event: FormEvent) {
    event.preventDefault();
    const city = draft.trim();
    if (!city || busy) return;
    setBusy(true);
    try {
      const card = await watchCity({ data: { city } });
      setCards((current) => {
        const rest = (current ?? []).filter(
          (item) => item.city.toLocaleLowerCase("ru") !== card.city.toLocaleLowerCase("ru"),
        );
        const next = [card, ...rest];
        setWidgetCity(next[0]?.city || "Алматы");
        return next;
      });
      setDraft("");
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : tx({ ru: "Город не нашёлся", en: "The city was not found", kk: "Қала табылмады" }),
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(city: string) {
    const previous = cards;
    const next = cards?.filter((item) => item.city !== city) ?? cards;
    setCards(next);
    setWidgetCity(next?.[0]?.city || "Алматы");
    try {
      await forgetCity({ data: { city } });
    } catch (err) {
      setCards(previous);
      setWidgetCity(previous?.[0]?.city || "Алматы");
      toast.error(
        err instanceof Error
          ? err.message
          : tx({ ru: "Не удалось убрать город", en: "The city stayed", kk: "Қала кетпеді" }),
      );
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-3 pt-3">
        <button
          type="button"
          className="press inline-flex h-10 items-center gap-1 rounded-xl px-2 text-sm text-muted"
          onClick={onBack}
        >
          <ChevronLeft className="size-4" />
          {tx({ ru: "Сервисы", en: "Services", kk: "Сервистер" })}
        </button>
        <h3 className="flex-1 font-serif text-xl tracking-tight">
          {tx({ ru: "Погода", en: "Weather", kk: "Ауа райы" })}
        </h3>
        <button
          type="button"
          className="press grid size-11 place-items-center rounded-xl text-muted"
          disabled={cards === null || busy}
          onClick={() => setRefresh((n) => n + 1)}
          aria-label={tx({ ru: "Обновить погоду", en: "Refresh weather", kk: "Ауа райын жаңарту" })}
        >
          <RefreshCw className={cards === null ? "size-4 animate-spin" : "size-4"} />
        </button>
      </div>
      <form className="flex gap-2 px-4 pt-3" onSubmit={(event) => void add(event)}>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={tx({
            ru: "Город, например Алматы",
            en: "A city, for example Almaty",
            kk: "Қала, мысалы Алматы",
          })}
          className="field"
          maxLength={60}
          aria-label={tx({ ru: "Город", en: "City", kk: "Қала" })}
        />
        <button
          type="submit"
          disabled={busy || cards === null || !draft.trim()}
          className="press inline-flex h-11 shrink-0 items-center gap-2 rounded-2xl bg-accent px-3 text-sm font-medium text-accent-fg disabled:opacity-40"
        >
          {busy ? <RefreshCw className="size-4 animate-spin" /> : <Plus className="size-4" />}
          {tx({ ru: "Следить", en: "Watch", kk: "Бақылау" })}
        </button>
      </form>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {cards === null ? (
          <PageLoader />
        ) : weatherError ? (
          <div className="rounded-2xl border border-line p-5">
            <p className="text-sm text-muted">
              {tx({
                ru: "Прогноз не загрузился. Сохранённые города остаются в аккаунте.",
                en: "Forecast did not load. Your cities are still saved.",
                kk: "Болжам жүктелмеді. Қалалар аккаунтта сақталған.",
              })}
            </p>
            <button
              className="press mt-3 min-h-11 rounded-xl bg-accent px-4 text-accent-fg"
              onClick={() => setRefresh((n) => n + 1)}
            >
              {tx({ ru: "Повторить", en: "Retry", kk: "Қайталау" })}
            </button>
          </div>
        ) : cards.length === 0 ? (
          <div className="mx-auto mt-6 max-w-sm rounded-3xl border border-dashed border-line px-5 py-10 text-center">
            <SkyArt />
            <p className="mt-4 font-serif text-xl">
              {tx({ ru: "Пока ни одного города", en: "No city yet", kk: "Әзірге қала жоқ" })}
            </p>
            <p className="mt-2 text-sm text-muted">
              {tx({
                ru: "Напишите город сверху. Он останется в аккаунте после перезапуска.",
                en: "Type a city above. It stays on the account after a restart.",
                kk: "Жоғарыға қала жазыңыз. Қайта іске қосқанда аккаунтта қалады.",
              })}
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {cards.map((card) => (
              <li key={card.city}>
                <CityCard card={card} onRemove={() => void remove(card.city)} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function CityCard({ card, onRemove }: { card: WeatherCard; onRemove: () => void }) {
  const tx = useTx();
  const failed = !card.advice && card.hours.length === 0;
  const kind = weatherKind(card.code);
  return (
    <article
      className="weather-card relative overflow-hidden rounded-[1.6rem] border border-line bg-elev p-4"
      data-weather-kind={kind}
    >
      <button
        type="button"
        className="press absolute top-3 right-3 inline-flex size-11 items-center justify-center rounded-2xl border border-line text-muted"
        aria-label={tx({
          ru: `Убрать ${card.city}`,
          en: `Remove ${card.city}`,
          kk: `${card.city} алу`,
        })}
        onClick={onRemove}
      >
        <X className="size-4" />
      </button>
      {failed ? (
        <div className="pr-12">
          <p className="font-serif text-2xl">{card.city}</p>
          <p className="mt-2 text-sm text-muted">{card.desc}</p>
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-3 pr-12">
            <div className="min-w-0">
              <p className="truncate text-xs tracking-wide text-muted uppercase">{card.city}</p>
              <p className="mt-1 font-serif text-7xl leading-none tracking-tight">{card.temp}°</p>
              <p className="mt-2 text-sm">{card.desc}</p>
              <p className="mt-1 text-xs text-faint">{card.place}</p>
            </div>
            <WeatherArt kind={kind} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Pill>
              {tx({
                ru: `ощущается ${card.feels}°`,
                en: `feels ${card.feels}°`,
                kk: `сезіледі ${card.feels}°`,
              })}
            </Pill>
            <Pill>
              {tx({
                ru: `ветер ${card.wind} км/ч`,
                en: `wind ${card.wind} km/h`,
                kk: `жел ${card.wind} км/сағ`,
              })}
            </Pill>
            <Pill>
              {tx({
                ru: `влажность ${card.humidity}%`,
                en: `humidity ${card.humidity}%`,
                kk: `ылғал ${card.humidity}%`,
              })}
            </Pill>
            {card.precip > 0 ? (
              <Pill>
                {tx({
                  ru: `осадки ${card.precip} мм`,
                  en: `rain ${card.precip} mm`,
                  kk: `жауын ${card.precip} мм`,
                })}
              </Pill>
            ) : null}
          </div>
          {card.hours.length > 0 ? (
            <div
              className="snap-row mt-4 flex gap-2 rounded-2xl border border-line bg-elev/60 p-2"
              aria-label={tx({
                ru: "Почасовой прогноз",
                en: "Hourly forecast",
                kk: "Сағаттық болжам",
              })}
            >
              {card.hours.map((hour) => (
                <div
                  key={hour.label}
                  className="w-14 shrink-0 snap-start rounded-2xl bg-subtle px-1 py-2 text-center"
                >
                  <p className="text-xs text-faint">{hour.label}</p>
                  <MiniArt kind={weatherKind(hour.code)} />
                  <p className="text-sm tabular-nums">{hour.temp}°</p>
                </div>
              ))}
            </div>
          ) : null}
          {card.days.length > 0 ? (
            <div className="mt-3 grid grid-cols-3 gap-2">
              {card.days.map((day) => (
                <div
                  key={day.label}
                  className="rounded-2xl border border-line px-2 py-2 text-center"
                >
                  <p className="text-xs text-faint">{day.label}</p>
                  <MiniArt kind={weatherKind(day.code)} />
                  <p className="text-xs tabular-nums text-muted">
                    {day.max}° / {day.min}°
                  </p>
                </div>
              ))}
            </div>
          ) : null}
          <div className="mt-3 rounded-2xl bg-subtle px-3 py-3">
            <p className="text-xs tracking-wide text-accent">
              {tx({ ru: "Что надеть", en: "What to wear", kk: "Не кию керек" })}
            </p>
            <p className="mt-1 text-sm text-pretty">{card.advice}</p>
          </div>
        </>
      )}
    </article>
  );
}

function Pill({ children }: { children: ReactNode }) {
  return <span className="rounded-full bg-subtle px-2.5 py-1 text-xs text-muted">{children}</span>;
}

function readCountries(): NewsCode[] {
  try {
    const raw = localStorage.getItem(NEWS_KEY);
    if (!raw) return [...NEWS_COUNTRIES];
    const picked = raw
      .split(",")
      .map((item) => item.trim().toUpperCase())
      .filter((item): item is NewsCode => (NEWS_COUNTRIES as readonly string[]).includes(item));
    return picked.length
      ? NEWS_COUNTRIES.filter((code) => picked.includes(code))
      : [...NEWS_COUNTRIES];
  } catch {
    return [...NEWS_COUNTRIES];
  }
}

function when(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function News({ onBack }: { onBack: () => void }) {
  const tx = useTx();
  const [countries, setCountries] = useState<NewsCode[]>(() => [...NEWS_COUNTRIES]);
  const [ready, setReady] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [items, setItems] = useState<NewsItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stored = readCountries();
    setCountries((current) => (stored.join(",") === current.join(",") ? current : stored));
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setItems(null);
    setError(null);
    void loadNews({ data: { countries } })
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch((err) => {
        if (!cancelled) {
          setItems([]);
          setError(
            loadError(
              err instanceof Error ? err.message : "",
              tx({
                ru: "Новости сейчас не открылись",
                en: "The bulletin did not open",
                kk: "Жаңалық ашылмады",
              }),
            ),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ready, countries, refresh]);

  function toggle(code: NewsCode) {
    setCountries((current) => {
      const has = current.includes(code);
      if (has && current.length === 1) {
        toast(
          tx({
            ru: "Нужна хотя бы одна страна",
            en: "Keep at least one country",
            kk: "Кемінде бір ел керек",
          }),
        );
        return current;
      }
      const next = NEWS_COUNTRIES.filter((item) => (item === code ? !has : current.includes(item)));
      try {
        localStorage.setItem(NEWS_KEY, next.join(","));
      } catch {
        /* private mode */
      }
      return next;
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-3 pt-3">
        <button
          type="button"
          className="press inline-flex h-10 items-center gap-1 rounded-xl px-2 text-sm text-muted"
          onClick={onBack}
        >
          <ChevronLeft className="size-4" />
          {tx({ ru: "Сервисы", en: "Services", kk: "Сервистер" })}
        </button>
        <h3 className="flex-1 font-serif text-xl tracking-tight">
          {tx({ ru: "Новости", en: "News", kk: "Жаңалық" })}
        </h3>
        <button
          type="button"
          aria-label={tx({
            ru: "Обновить новости",
            en: "Refresh news",
            kk: "Жаңалықтарды жаңарту",
          })}
          className="press grid size-11 place-items-center rounded-xl text-muted"
          disabled={items === null}
          onClick={() => setRefresh((n) => n + 1)}
        >
          <RefreshCw className={items === null ? "size-4 animate-spin" : "size-4"} />
        </button>
      </div>
      <div className="px-4 pt-3">
        <div className="flex items-center justify-between text-xs text-faint">
          <span>
            {tx({
              ru: "Лента по вашим странам",
              en: "News from your countries",
              kk: "Таңдалған елдер жаңалықтары",
            })}
          </span>
          <span>{tx({ ru: "Последние новости", en: "Latest", kk: "Соңғы жаңалықтар" })}</span>
        </div>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {NEWS_COUNTRIES.map((code) => {
            const on = countries.includes(code);
            return (
              <button
                key={code}
                type="button"
                aria-pressed={on}
                className={
                  on
                    ? "press h-10 shrink-0 rounded-full bg-accent px-3 text-sm font-medium text-accent-fg"
                    : "press h-10 shrink-0 rounded-full border border-line px-3 text-sm text-muted"
                }
                onClick={() => toggle(code)}
              >
                {tx({
                  ru: COUNTRY_NAME[code],
                  en: {
                    KZ: "Kazakhstan",
                    RU: "Russia",
                    UZ: "Uzbekistan",
                    KG: "Kyrgyzstan",
                    BY: "Belarus",
                  }[code],
                  kk: {
                    KZ: "Қазақстан",
                    RU: "Ресей",
                    UZ: "Өзбекстан",
                    KG: "Қырғызстан",
                    BY: "Беларусь",
                  }[code],
                })}
              </button>
            );
          })}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {items === null ? (
          <div
            className="space-y-3"
            role="status"
            aria-label={tx({
              ru: "Загружаем новости",
              en: "Loading news",
              kk: "Жаңалықтар жүктелуде",
            })}
          >
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="animate-pulse rounded-2xl border border-line p-4">
                <div className="h-3 w-24 rounded bg-subtle" />
                <div className="mt-3 h-5 w-full rounded bg-subtle" />
                <div className="mt-2 h-5 w-3/4 rounded bg-subtle" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div>
            <p className="text-sm text-danger">{error}</p>
            <button
              type="button"
              className="press mt-3 h-10 rounded-xl border border-line px-3 text-sm"
              onClick={() => setCountries((current) => [...current])}
            >
              {tx({ ru: "Повторить", en: "Try again", kk: "Қайталау" })}
            </button>
          </div>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">
            {tx({
              ru: "За сегодня по этим странам пока тихо.",
              en: "Quiet for these countries today.",
              kk: "Бүгін бұл елдер бойынша тыныш.",
            })}
          </p>
        ) : (
          <ul className="space-y-2">
            {items.map((item, index) => {
              const lead = index === 0;
              return (
                <li key={item.id}>
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={
                      lead
                        ? "press block overflow-hidden rounded-[1.6rem] border border-line bg-elev"
                        : "press flex min-h-[6rem] overflow-hidden rounded-[1.4rem] border border-line bg-elev"
                    }
                  >
                    <NewsImage item={item} lead={lead} />
                    <span className={lead ? "block p-3.5" : "min-w-0 flex-1 p-3"}>
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-faint">
                        <span className="inline-flex items-center gap-1 font-medium text-muted">
                          {item.source}
                          <ExternalLink className="size-3" aria-hidden="true" />
                        </span>
                        {item.country ? (
                          <span>
                            {tx({
                              ru: COUNTRY_NAME[item.country],
                              en: {
                                KZ: "Kazakhstan",
                                RU: "Russia",
                                UZ: "Uzbekistan",
                                KG: "Kyrgyzstan",
                                BY: "Belarus",
                              }[item.country],
                              kk: {
                                KZ: "Қазақстан",
                                RU: "Ресей",
                                UZ: "Өзбекстан",
                                KG: "Қырғызстан",
                                BY: "Беларусь",
                              }[item.country],
                            })}
                          </span>
                        ) : null}
                        {item.publishedAt ? (
                          <time className="tabular-nums">{when(item.publishedAt)}</time>
                        ) : null}
                      </span>
                      <span
                        className={
                          lead
                            ? "mt-1 block font-serif text-[1.65rem] leading-tight tracking-tight text-pretty"
                            : "mt-1 block font-serif text-lg leading-snug tracking-tight text-pretty"
                        }
                      >
                        {item.title}
                      </span>
                      {item.description ? (
                        <span className="mt-1 line-clamp-2 block text-sm text-muted">
                          {item.description}
                        </span>
                      ) : null}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function NewsImage({ item, lead }: { item: NewsItem; lead: boolean }) {
  const [failed, setFailed] = useState(false);
  if (!item.image || failed)
    return lead ? <div className="h-1 bg-accent/60" aria-hidden="true" /> : null;
  return (
    <img
      src={item.image}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={
        lead
          ? "aspect-[2/1] max-h-52 w-full object-cover"
          : "m-3 size-20 shrink-0 rounded-xl object-cover"
      }
    />
  );
}

function readFx(): FxCode {
  try {
    const stored = localStorage.getItem(FX_KEY);
    return FX_CODES.find((code) => code === stored) ?? "KZT";
  } catch {
    return "KZT";
  }
}

function formatRate(value: number) {
  const abs = Math.abs(value);
  const max = abs >= 100 ? 2 : abs >= 1 ? 2 : abs >= 0.1 ? 3 : 4;
  return value.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: max });
}

function formatQty(value: number) {
  return value.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

function fxDate(iso: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" });
}

function Rates({ onBack }: { onBack: () => void }) {
  const tx = useTx();
  const [base, setBase] = useState<FxCode>("KZT");
  const [ready, setReady] = useState(false);
  const [tick, setTick] = useState(0);
  const [board, setBoard] = useState<FxBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState("1");

  useEffect(() => {
    setBase(readFx());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setBoard(null);
    setError(null);
    void loadRates({ data: { base } })
      .then((next) => {
        if (!cancelled) setBoard(next);
      })
      .catch((err) => {
        if (!cancelled) {
          setBoard(null);
          setError(
            loadError(
              err instanceof Error ? err.message : "",
              tx({
                ru: "Курсы сейчас не открылись",
                en: "Rates did not open",
                kk: "Бағам ашылмады",
              }),
            ),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ready, base, tick]);

  function select(code: FxCode) {
    if (code === base) return;
    setBase(code);
    try {
      localStorage.setItem(FX_KEY, code);
    } catch {
      /* private mode */
    }
  }

  const raw = amount.trim().replace(",", ".");
  const qty = raw === "" ? 1 : Number(raw);
  const count = Number.isFinite(qty) && qty >= 0 && qty <= 1e9 ? qty : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-3 pt-3">
        <button
          type="button"
          className="press inline-flex h-10 items-center gap-1 rounded-xl px-2 text-sm text-muted"
          onClick={onBack}
        >
          <ChevronLeft className="size-4" />
          {tx({ ru: "Сервисы", en: "Services", kk: "Сервистер" })}
        </button>
        <h3 className="font-serif text-xl tracking-tight">
          {tx({ ru: "Курсы", en: "Rates", kk: "Бағам" })}
        </h3>
      </div>
      <div className="px-4 pt-3">
        <FxArt compact />
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {FX_CODES.map((code) => (
            <button
              key={code}
              type="button"
              aria-pressed={base === code}
              className={
                base === code
                  ? "press h-10 shrink-0 rounded-full bg-accent px-3 text-sm font-medium text-accent-fg"
                  : "press h-10 shrink-0 rounded-full border border-line px-3 text-sm text-muted"
              }
              onClick={() => select(code)}
            >
              {tx({
                ru: FX_NAME[code],
                en: {
                  USD: "Dollar",
                  EUR: "Euro",
                  RUB: "Ruble",
                  KZT: "Tenge",
                  UZS: "Som",
                  KGS: "Kyrgyz som",
                  BYN: "Belarusian ruble",
                }[code],
                kk: {
                  USD: "Доллар",
                  EUR: "Еуро",
                  RUB: "Рубль",
                  KZT: "Теңге",
                  UZS: "Сом",
                  KGS: "Сом",
                  BYN: "Бел. рубль",
                }[code],
              })}
            </button>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <label className="shrink-0 text-xs text-faint" htmlFor="fx-amount">
            {tx({ ru: "Считать за", en: "Count as", kk: "Есептеу" })}
          </label>
          <input
            id="fx-amount"
            className="field max-w-32"
            inputMode="decimal"
            value={amount}
            maxLength={12}
            aria-label={tx({ ru: "Сколько единиц", en: "How many units", kk: "Қанша бірлік" })}
            onChange={(event) => setAmount(event.target.value.replace(/[^\d.,]/g, "").slice(0, 12))}
          />
          <span className="truncate text-sm text-muted">
            {tx({ ru: "единиц валюты", en: "currency units", kk: "валюта бірлігі" })}
          </span>
        </div>
        {board?.date ? (
          <p className="mt-2 text-xs text-faint">
            {tx({
              ru: `Курс на ${fxDate(board.date)}`,
              en: `Rate on ${fxDate(board.date)}`,
              kk: `${fxDate(board.date)} бағамы`,
            })}
          </p>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {error ? (
          <div>
            <p className="text-sm text-danger">{error}</p>
            <button
              type="button"
              className="press mt-3 h-10 rounded-xl border border-line px-3 text-sm"
              onClick={() => setTick((value) => value + 1)}
            >
              {tx({ ru: "Повторить", en: "Try again", kk: "Қайталау" })}
            </button>
          </div>
        ) : board === null ? (
          <PageLoader />
        ) : (
          <ul className="space-y-2">
            {board.quotes.map((quote) => {
              const home = count === null || quote.perBase === 0 ? null : count / quote.perBase;
              return (
                <li key={quote.code}>
                  <button
                    type="button"
                    className="press flex w-full items-center gap-3 rounded-[1.4rem] border border-line bg-elev p-3 text-left"
                    onClick={() => select(quote.code)}
                  >
                    <Coin code={quote.code} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">
                        {tx({
                          ru: FX_NAME[quote.code],
                          en: {
                            USD: "Dollar",
                            EUR: "Euro",
                            RUB: "Ruble",
                            KZT: "Tenge",
                            UZS: "Som",
                            KGS: "Kyrgyz som",
                            BYN: "Belarusian ruble",
                          }[quote.code],
                          kk: {
                            USD: "Доллар",
                            EUR: "Еуро",
                            RUB: "Рубль",
                            KZT: "Теңге",
                            UZS: "Сом",
                            KGS: "Сом",
                            BYN: "Бел. рубль",
                          }[quote.code],
                        })}
                      </span>
                      <span className="text-xs text-faint">
                        {count === null || count === 1
                          ? quote.code
                          : `${formatQty(count)} ${quote.code}`}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className="block font-serif text-2xl leading-none tracking-tight tabular-nums">
                        {home === null ? "—" : formatRate(home)}
                      </span>
                      <span className="text-xs text-faint">{FX_SIGN[base]}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function Coin({ code }: { code: FxCode }) {
  const mark = FX_SIGN[code];
  const tone = FX_COIN[code];
  return (
    <span
      className="grid size-14 shrink-0 place-items-center rounded-full font-serif ring-1 ring-[#1c1b19]/15"
      style={{ background: tone.paper, color: tone.ink }}
      aria-hidden="true"
    >
      <span className={mark.length > 2 ? "text-xs tracking-tight" : "text-xl"}>{mark}</span>
    </span>
  );
}

function WeatherArt({ kind }: { kind: WeatherKind }) {
  return (
    <svg viewBox="0 0 120 120" className="size-24 shrink-0" aria-hidden="true">
      {kind === "sun" || kind === "partly" ? <Sun dim={kind === "partly"} /> : null}
      {kind !== "sun" ? <Cloud rainy={kind === "rain" || kind === "storm"} /> : null}
      {kind === "rain" ? <Rain /> : null}
      {kind === "snow" ? <Snow /> : null}
      {kind === "storm" ? <Bolt /> : null}
      {kind === "fog" ? <FogBars /> : null}
    </svg>
  );
}

function MiniArt({ kind }: { kind: WeatherKind }) {
  return (
    <svg viewBox="0 0 120 90" className="mx-auto h-8 w-8" aria-hidden="true">
      {kind === "sun" || kind === "partly" ? <Sun dim={kind === "partly"} /> : null}
      {kind !== "sun" ? <Cloud rainy={kind === "rain" || kind === "storm"} /> : null}
    </svg>
  );
}

function Sun({ dim }: { dim: boolean }) {
  return (
    <g opacity={dim ? 0.85 : 1} transform={dim ? "translate(-8 -6) scale(0.72)" : undefined}>
      <circle cx="60" cy="48" r="16" fill="#e8c98a" />
      <g stroke="#e8c98a" strokeWidth="3" strokeLinecap="round">
        <path d="M60 20v8M60 68v8M32 48h8M80 48h8M40 28l6 6M74 62l6 6M80 28l-6 6M46 62l-6 6" />
      </g>
    </g>
  );
}

function Cloud({ rainy }: { rainy: boolean }) {
  const y = rainy ? 8 : 18;
  return (
    <g
      transform={`translate(0 ${y})`}
      fill="#f7f3ec"
      stroke="color-mix(in oklab, var(--fg) 14%, transparent)"
      strokeWidth="2"
    >
      <ellipse cx="48" cy="58" rx="22" ry="14" />
      <ellipse cx="68" cy="54" rx="18" ry="14" />
      <ellipse cx="86" cy="60" rx="16" ry="11" />
      <rect x="40" y="56" width="52" height="16" rx="8" />
    </g>
  );
}

function Rain() {
  return (
    <g stroke="#9bb7d4" strokeWidth="3" strokeLinecap="round">
      <path d="M46 92l-4 10M64 94l-4 10M82 92l-4 10" />
    </g>
  );
}

function Snow() {
  return (
    <g fill="#c5d7ea">
      <circle cx="46" cy="96" r="3" />
      <circle cx="66" cy="102" r="3" />
      <circle cx="84" cy="94" r="3" />
    </g>
  );
}

function Bolt() {
  return <path d="M70 78l-10 16h10l-6 16 18-20h-10l8-12z" fill="#e7c89a" />;
}

function FogBars() {
  return (
    <g
      stroke="color-mix(in oklab, var(--fg) 35%, transparent)"
      strokeWidth="4"
      strokeLinecap="round"
    >
      <path d="M28 78h64M34 90h52M40 102h40" />
    </g>
  );
}
