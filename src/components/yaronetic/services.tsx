import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ChevronLeft, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { useCircleNest } from "@/lib/circle-history";
import { forgetCity, loadWeather, watchCity } from "@/lib/weather/service";
import { weatherKind, type WeatherCard, type WeatherKind } from "@/lib/weather/parse";
import { StoryPlate } from "@/components/yaronetic/story-plate";
import { PageLoader } from "@/components/yaronetic/page-loader";
import { loadNews } from "@/lib/news/service";
import { NEWS_COUNTRIES, type NewsCode, type NewsItem } from "@/lib/news/parse";
import { loadRates } from "@/lib/fx/service";
import { FX_CODES, type FxBoard, type FxCode } from "@/lib/fx/parse";
import { VpnService } from "@/components/yaronetic/vpn";
import { Grabber } from "@/components/yaronetic/grabber";
import { useTx } from "@/lib/lang";
import { loadError } from "@/lib/load-error";

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

export function Services() {
  const tx = useTx();
  const [view, setView] = useState<"weather" | "news" | "fx" | "vpn" | "grab" | null>(null);
  useCircleNest(view !== null, () => setView(null));
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("vv-circle-nested", { detail: view !== null }));
    return () => {
      window.dispatchEvent(new CustomEvent("vv-circle-nested", { detail: false }));
    };
  }, [view]);
  if (view === "weather") return <Weather onBack={() => setView(null)} />;
  if (view === "news") return <News onBack={() => setView(null)} />;
  if (view === "fx") return <Rates onBack={() => setView(null)} />;
  if (view === "vpn") return <VpnService onBack={() => setView(null)} />;
  if (view === "grab") return <Grabber onBack={() => setView(null)} />;
  return (
    <div className="h-full overflow-y-auto px-4 py-4">
      <h3 className="font-serif text-2xl tracking-tight">{tx({ ru: "Сервисы", en: "Services", kk: "Сервистер" })}</h3>
      <p className="mt-1 max-w-md text-sm text-muted">
        {tx({
          ru: "Погода, выпуск, курсы, VPN и загрузчик. Города погоды остаются в аккаунте.",
          en: "Weather, the bulletin, rates, VPN and a downloader. Weather cities stay on the account.",
          kk: "Ауа райы, шығарылым, бағам, VPN және жүктеуіш. Қалалар аккаунтта қалады.",
        })}
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          className="press group relative w-full overflow-hidden rounded-[1.6rem] border border-line bg-elev p-4 text-left"
          onClick={() => setView("weather")}
        >
          <SkyArt />
          <p className="relative mt-3 font-serif text-3xl tracking-tight">{tx({ ru: "Погода", en: "Weather", kk: "Ауа райы" })}</p>
          <p className="relative mt-1 max-w-xs text-sm text-muted">{tx({ ru: "Добавьте город. Покажем небо и совет, что лучше надеть.", en: "Add a city. We show the sky and what to wear.", kk: "Қала қосыңыз. Аспан мен киім кеңесін көрсетеміз." })}</p>
        </button>
        <button
          type="button"
          className="press group relative w-full overflow-hidden rounded-[1.6rem] border border-line bg-elev p-4 text-left"
          onClick={() => setView("news")}
        >
          <NewsArt />
          <p className="relative mt-3 font-serif text-3xl tracking-tight">{tx({ ru: "Новости", en: "News", kk: "Жаңалықтар" })}</p>
          <p className="relative mt-1 max-w-xs text-sm text-muted">{tx({ ru: "Сегодня по странам. Нажмите заголовок — откроется источник.", en: "Today by country. Tap a headline to open the source.", kk: "Бүгін елдер бойынша. Тақырыпты бассаңыз, дереккөз ашылады." })}</p>
        </button>
        <button
          type="button"
          className="press group relative w-full overflow-hidden rounded-[1.6rem] border border-line bg-elev p-4 text-left"
          onClick={() => setView("fx")}
        >
          <FxArt />
          <p className="relative mt-3 font-serif text-3xl tracking-tight">{tx({ ru: "Курсы", en: "Rates", kk: "Бағам" })}</p>
          <p className="relative mt-1 max-w-xs text-sm text-muted">{tx({ ru: "Доллар, евро и деньги соседних стран. Нажмите строку — сменится основа.", en: "Dollar, euro and neighbouring money. Tap a row to change the base.", kk: "Доллар, еуро және көрші ақша. Жолды бассаңыз, негіз ауысады." })}</p>
        </button>
        <button
          type="button"
          className="press group relative w-full overflow-hidden rounded-[1.6rem] border border-line bg-elev p-4 text-left"
          onClick={() => setView("vpn")}
        >
          <VpnTile />
          <p className="relative mt-3 font-serif text-3xl tracking-tight">VPN</p>
          <p className="relative mt-1 max-w-xs text-sm text-muted">{tx({ ru: "Ссылка для Happ, Incy и Karing. Локации, срок и трафик.", en: "A link for Happ, Incy and Karing. Locations, term and traffic.", kk: "Happ, Incy және Karing сілтемесі. Локация, мерзім және трафик." })}</p>
        </button>
        <button
          type="button"
          className="press group relative w-full overflow-hidden rounded-[1.6rem] border border-line bg-elev p-4 text-left sm:col-span-2"
          onClick={() => setView("grab")}
        >
          <GrabTile />
          <p className="relative mt-3 font-serif text-3xl tracking-tight">{tx({ ru: "Загрузчик", en: "Downloader", kk: "Жүктеуіш" })}</p>
          <p className="relative mt-1 max-w-md text-sm text-muted">
            {tx({
              ru: "Ролик по ссылке из Instagram, YouTube, TikTok, Pinterest или VK. На мегадиске он живёт пять минут.",
              en: "A clip from Instagram, YouTube, TikTok, Pinterest or VK. It lives on the megadisk for five minutes.",
              kk: "Instagram, YouTube, TikTok, Pinterest немесе VK сілтемесінен ролик. Мегадискте бес минут тұрады.",
            })}
          </p>
        </button>
      </div>
    </div>
  );
}

function GrabTile() {
  return (
    <div className="relative h-28 overflow-hidden rounded-2xl bg-[color-mix(in_oklab,var(--accent)_18%,var(--bg))]" aria-hidden="true">
      <svg viewBox="0 0 320 120" className="absolute inset-0 h-full w-full">
        <rect x="36" y="28" width="118" height="68" rx="14" fill="#f7f3ec" stroke="#1c1b19" strokeOpacity="0.2" />
        <path d="M36 46h118" stroke="#1c1b19" strokeOpacity="0.15" />
        <circle cx="52" cy="37" r="3" fill="#e7a19c" />
        <circle cx="64" cy="37" r="3" fill="#e8c98a" />
        <circle cx="76" cy="37" r="3" fill="#9dccb6" />
        <path d="M78 62h34M78 74h22" stroke="#1c1b19" strokeOpacity="0.35" strokeWidth="3" strokeLinecap="round" />
        <circle cx="230" cy="58" r="28" fill="#c4b5e8" />
        <path d="M230 44v22M221 58h18" stroke="#1b1526" strokeWidth="3" strokeLinecap="round" />
        <path d="M214 78c8 10 24 10 32 0" fill="none" stroke="#1b1526" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </div>
  );
}

function VpnTile() {
  return (
    <div className="relative h-28 overflow-hidden rounded-2xl bg-[color-mix(in_oklab,var(--accent)_18%,var(--bg))]" aria-hidden="true">
      <svg viewBox="0 0 320 120" className="absolute inset-0 h-full w-full">
        <circle cx="214" cy="60" r="34" fill="none" stroke="#c4b5e8" strokeWidth="2" />
        <ellipse cx="214" cy="60" rx="14" ry="34" fill="none" stroke="#c4b5e8" strokeWidth="1.5" />
        <path d="M180 60h68M214 26v68" stroke="#c4b5e8" strokeWidth="1.2" opacity="0.7" />
        <circle cx="232" cy="46" r="4" fill="#e8c98a" />
        <path d="M70 86h48v6a24 24 0 0 1-48 0z" fill="#c4b5e8" />
        <path d="M84 86v-12a10 10 0 0 1 20 0v12" fill="none" stroke="#1b1526" strokeWidth="3" />
        <path d="M86 62c10-16 28-16 38 0" fill="none" stroke="#1c1b19" strokeOpacity="0.35" strokeWidth="2" />
      </svg>
    </div>
  );
}

function Weather({ onBack }: { onBack: () => void }) {
  const tx = useTx();
  const [cards, setCards] = useState<WeatherCard[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadWeather()
      .then((rows) => {
        if (!cancelled) setCards(rows);
      })
      .catch(() => {
        if (!cancelled) {
          setCards([]);
          toast.error(tx({ ru: "Погода сейчас не открылась", en: "Weather did not open", kk: "Ауа райы ашылмады" }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function add(event: FormEvent) {
    event.preventDefault();
    const city = draft.trim();
    if (!city || busy) return;
    setBusy(true);
    try {
      const card = await watchCity({ data: { city } });
      setCards((current) => {
        const rest = (current ?? []).filter((item) => item.city.toLocaleLowerCase("ru") !== card.city.toLocaleLowerCase("ru"));
        return [card, ...rest];
      });
      setDraft("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tx({ ru: "Город не нашёлся", en: "The city was not found", kk: "Қала табылмады" }));
    } finally {
      setBusy(false);
    }
  }

  async function remove(city: string) {
    const previous = cards;
    setCards((current) => current?.filter((item) => item.city !== city) ?? current);
    try {
      await forgetCity({ data: { city } });
    } catch (err) {
      setCards(previous);
      toast.error(err instanceof Error ? err.message : tx({ ru: "Не удалось убрать город", en: "The city stayed", kk: "Қала кетпеді" }));
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-3 pt-3">
        <button type="button" className="press inline-flex h-10 items-center gap-1 rounded-xl px-2 text-sm text-muted" onClick={onBack}>
          <ChevronLeft className="size-4" />
          {tx({ ru: "Сервисы", en: "Services", kk: "Сервистер" })}
        </button>
        <h3 className="font-serif text-xl tracking-tight">{tx({ ru: "Погода", en: "Weather", kk: "Ауа райы" })}</h3>
      </div>
      <form className="flex gap-2 px-4 pt-3" onSubmit={(event) => void add(event)}>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={tx({ ru: "Город, например Алматы", en: "A city, for example Almaty", kk: "Қала, мысалы Алматы" })}
          className="field"
          maxLength={60}
          aria-label={tx({ ru: "Город", en: "City", kk: "Қала" })}
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          className="press inline-flex h-11 shrink-0 items-center gap-2 rounded-2xl bg-accent px-3 text-sm font-medium text-accent-fg disabled:opacity-40"
        >
          <Plus className="size-4" />
          {tx({ ru: "Следить", en: "Watch", kk: "Бақылау" })}
        </button>
      </form>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {cards === null ? (
          <PageLoader />
        ) : cards.length === 0 ? (
          <div className="mx-auto mt-6 max-w-sm rounded-3xl border border-dashed border-line px-5 py-10 text-center">
            <SkyArt />
            <p className="mt-4 font-serif text-xl">{tx({ ru: "Пока ни одного города", en: "No city yet", kk: "Әзірге қала жоқ" })}</p>
            <p className="mt-2 text-sm text-muted">{tx({ ru: "Напишите город сверху. Он останется в аккаунте после перезапуска.", en: "Type a city above. It stays on the account after a restart.", kk: "Жоғарыға қала жазыңыз. Қайта іске қосқанда аккаунтта қалады." })}</p>
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
    <article className="relative overflow-hidden rounded-[1.6rem] border border-line bg-elev p-4">
      <button
        type="button"
        className="press absolute top-3 right-3 inline-flex size-11 items-center justify-center rounded-2xl border border-line text-muted"
        aria-label={tx({ ru: `Убрать ${card.city}`, en: `Remove ${card.city}`, kk: `${card.city} алу` })}
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
              <p className="mt-1 font-serif text-6xl leading-none tracking-tight">{card.temp}°</p>
              <p className="mt-2 text-sm">{card.desc}</p>
            </div>
            <WeatherArt kind={kind} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Pill>{tx({ ru: `ощущается ${card.feels}°`, en: `feels ${card.feels}°`, kk: `сезіледі ${card.feels}°` })}</Pill>
            <Pill>{tx({ ru: `ветер ${card.wind} км/ч`, en: `wind ${card.wind} km/h`, kk: `жел ${card.wind} км/сағ` })}</Pill>
            <Pill>{tx({ ru: `влажность ${card.humidity}%`, en: `humidity ${card.humidity}%`, kk: `ылғал ${card.humidity}%` })}</Pill>
            {card.precip > 0 ? <Pill>{tx({ ru: `осадки ${card.precip} мм`, en: `rain ${card.precip} mm`, kk: `жауын ${card.precip} мм` })}</Pill> : null}
          </div>
          {card.hours.length > 0 ? (
            <div className="snap-row mt-3 flex gap-2 pb-1">
              {card.hours.map((hour) => (
                <div key={hour.label} className="w-14 shrink-0 snap-start rounded-2xl bg-subtle px-1 py-2 text-center">
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
                <div key={day.label} className="rounded-2xl border border-line px-2 py-2 text-center">
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
            <p className="text-xs tracking-wide text-accent">{tx({ ru: "Что надеть", en: "What to wear", kk: "Не кию керек" })}</p>
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
    return picked.length ? NEWS_COUNTRIES.filter((code) => picked.includes(code)) : [...NEWS_COUNTRIES];
  } catch {
    return [...NEWS_COUNTRIES];
  }
}

function when(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function News({ onBack }: { onBack: () => void }) {
  const tx = useTx();
  const [countries, setCountries] = useState<NewsCode[]>(() => [...NEWS_COUNTRIES]);
  const [ready, setReady] = useState(false);
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
          setError(loadError(err instanceof Error ? err.message : "", tx({ ru: "Новости сейчас не открылись", en: "The bulletin did not open", kk: "Жаңалық ашылмады" })));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ready, countries]);

  function toggle(code: NewsCode) {
    setCountries((current) => {
      const has = current.includes(code);
      if (has && current.length === 1) {
        toast(tx({ ru: "Нужна хотя бы одна страна", en: "Keep at least one country", kk: "Кемінде бір ел керек" }));
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
        <button type="button" className="press inline-flex h-10 items-center gap-1 rounded-xl px-2 text-sm text-muted" onClick={onBack}>
          <ChevronLeft className="size-4" />
          {tx({ ru: "Сервисы", en: "Services", kk: "Сервистер" })}
        </button>
        <h3 className="font-serif text-xl tracking-tight">{tx({ ru: "Новости", en: "News", kk: "Жаңалық" })}</h3>
      </div>
      <div className="px-4 pt-3">
        <NewsArt compact />
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
                {tx({ ru: COUNTRY_NAME[code], en: { KZ: "Kazakhstan", RU: "Russia", UZ: "Uzbekistan", KG: "Kyrgyzstan", BY: "Belarus" }[code], kk: { KZ: "Қазақстан", RU: "Ресей", UZ: "Өзбекстан", KG: "Қырғызстан", BY: "Беларусь" }[code] })}
              </button>
            );
          })}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {items === null ? (
          <PageLoader />
        ) : error ? (
          <div>
            <p className="text-sm text-danger">{error}</p>
            <button type="button" className="press mt-3 h-10 rounded-xl border border-line px-3 text-sm" onClick={() => setCountries((current) => [...current])}>
              {tx({ ru: "Повторить", en: "Try again", kk: "Қайталау" })}
            </button>
          </div>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">{tx({ ru: "За сегодня по этим странам пока тихо.", en: "Quiet for these countries today.", kk: "Бүгін бұл елдер бойынша тыныш." })}</p>
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
                        : "press flex min-h-[7.5rem] overflow-hidden rounded-[1.4rem] border border-line bg-elev"
                    }
                  >
                    <StoryPlate seed={item.url} index={index} wide={lead} />
                    <span className={lead ? "block p-3.5" : "min-w-0 flex-1 p-3"}>
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-faint">
                        <span className="truncate">{item.source}</span>
                        {item.country ? <span>{tx({ ru: COUNTRY_NAME[item.country], en: { KZ: "Kazakhstan", RU: "Russia", UZ: "Uzbekistan", KG: "Kyrgyzstan", BY: "Belarus" }[item.country], kk: { KZ: "Қазақстан", RU: "Ресей", UZ: "Өзбекстан", KG: "Қырғызстан", BY: "Беларусь" }[item.country] })}</span> : null}
                        {item.publishedAt ? <time className="tabular-nums">{when(item.publishedAt)}</time> : null}
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
                      {item.description ? <span className="mt-1 line-clamp-2 block text-sm text-muted">{item.description}</span> : null}
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

function NewsArt({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={compact ? "relative h-24 overflow-hidden rounded-2xl bg-[#f3efe6]" : "relative h-28 overflow-hidden rounded-2xl bg-[#f3efe6]"}
      aria-hidden="true"
    >
      <svg viewBox="0 0 320 120" className="absolute inset-0 h-full w-full">
        <rect x="0" y="0" width="320" height="120" fill="#f3efe6" />
        <path d="M18 28h150" stroke="#1c1b19" strokeWidth="3" />
        <path d="M18 34h110" stroke="#1c1b19" strokeWidth="1" />
        <text x="18" y="58" fill="#1c1b19" fontFamily="Georgia, serif" fontSize="22">
          Сегодня
        </text>
        <g fill="#1c1b19" opacity="0.72">
          <rect x="18" y="70" width="92" height="3" rx="1" />
          <rect x="18" y="78" width="78" height="3" rx="1" />
          <rect x="18" y="86" width="86" height="3" rx="1" />
          <rect x="116" y="70" width="70" height="3" rx="1" />
          <rect x="116" y="78" width="58" height="3" rx="1" />
          <rect x="116" y="86" width="64" height="3" rx="1" />
        </g>
        <circle cx="252" cy="58" r="28" fill="#c4b5e8" />
        <path d="M252 40v8M252 68v8M234 58h8M262 58h8" stroke="#1b1526" strokeWidth="2" strokeLinecap="round" />
        <circle cx="252" cy="58" r="8" fill="#1b1526" />
      </svg>
    </div>
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
          setError(loadError(err instanceof Error ? err.message : "", tx({ ru: "Курсы сейчас не открылись", en: "Rates did not open", kk: "Бағам ашылмады" })));
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
        <button type="button" className="press inline-flex h-10 items-center gap-1 rounded-xl px-2 text-sm text-muted" onClick={onBack}>
          <ChevronLeft className="size-4" />
          {tx({ ru: "Сервисы", en: "Services", kk: "Сервистер" })}
        </button>
        <h3 className="font-serif text-xl tracking-tight">{tx({ ru: "Курсы", en: "Rates", kk: "Бағам" })}</h3>
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
              {tx({ ru: FX_NAME[code], en: { USD: "Dollar", EUR: "Euro", RUB: "Ruble", KZT: "Tenge", UZS: "Som", KGS: "Kyrgyz som", BYN: "Belarusian ruble" }[code], kk: { USD: "Доллар", EUR: "Еуро", RUB: "Рубль", KZT: "Теңге", UZS: "Сом", KGS: "Сом", BYN: "Бел. рубль" }[code] })}
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
          <span className="truncate text-sm text-muted">{tx({ ru: "единиц валюты", en: "currency units", kk: "валюта бірлігі" })}</span>
        </div>
        {board?.date ? <p className="mt-2 text-xs text-faint">{tx({ ru: `Курс на ${fxDate(board.date)}`, en: `Rate on ${fxDate(board.date)}`, kk: `${fxDate(board.date)} бағамы` })}</p> : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {error ? (
          <div>
            <p className="text-sm text-danger">{error}</p>
            <button type="button" className="press mt-3 h-10 rounded-xl border border-line px-3 text-sm" onClick={() => setTick((value) => value + 1)}>
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
                      <span className="block font-medium">{tx({ ru: FX_NAME[quote.code], en: { USD: "Dollar", EUR: "Euro", RUB: "Ruble", KZT: "Tenge", UZS: "Som", KGS: "Kyrgyz som", BYN: "Belarusian ruble" }[quote.code], kk: { USD: "Доллар", EUR: "Еуро", RUB: "Рубль", KZT: "Теңге", UZS: "Сом", KGS: "Сом", BYN: "Бел. рубль" }[quote.code] })}</span>
                      <span className="text-xs text-faint">{count === null || count === 1 ? quote.code : `${formatQty(count)} ${quote.code}`}</span>
                    </span>
                    <span className="text-right">
                      <span className="block font-serif text-2xl leading-none tracking-tight tabular-nums">{home === null ? "—" : formatRate(home)}</span>
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

function FxArt({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "relative h-24 overflow-hidden rounded-2xl bg-[#f3efe6]" : "relative h-28 overflow-hidden rounded-2xl bg-[#f3efe6]"} aria-hidden="true">
      <svg viewBox="0 0 320 120" className="absolute inset-0 h-full w-full">
        <rect width="320" height="120" fill="#f3efe6" />
        <g stroke="#1c1b19" strokeWidth="1" opacity="0.28">
          <path d="M0 28h320M0 52h320M0 76h320M0 100h320" />
          <path d="M28 0v120M64 0v120" />
        </g>
        <text x="78" y="62" fill="#1c1b19" fontFamily="Georgia, serif" fontSize="28">
          Курс
        </text>
        <circle cx="248" cy="58" r="30" fill="#c4b5e8" />
        <text x="236" y="66" fill="#1b1526" fontFamily="Georgia, serif" fontSize="22">
          ₸
        </text>
        <circle cx="278" cy="36" r="16" fill="#1c1b19" />
        <text x="270" y="42" fill="#f3efe6" fontFamily="Georgia, serif" fontSize="14">
          $
        </text>
      </svg>
    </div>
  );
}

function SkyArt() {
  return (
    <div className="relative h-28 overflow-hidden rounded-2xl bg-[color-mix(in_oklab,var(--accent)_18%,var(--bg))]" aria-hidden="true">
      <svg viewBox="0 0 320 120" className="absolute inset-0 h-full w-full">
        <circle cx="250" cy="42" r="26" fill="#e8c98a" />
        <g stroke="#e8c98a" strokeWidth="3" strokeLinecap="round" opacity="0.85">
          <path d="M250 6v10M250 68v10M214 42h10M276 42h10M224 16l7 7M269 61l7 7M276 16l-7 7M231 61l-7 7" />
        </g>
        <g fill="#f7f3ec" stroke="color-mix(in oklab, var(--fg) 12%, transparent)" strokeWidth="2">
          <ellipse cx="92" cy="78" rx="46" ry="22" />
          <ellipse cx="128" cy="70" rx="34" ry="22" />
          <ellipse cx="62" cy="74" rx="28" ry="16" />
        </g>
      </svg>
    </div>
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
    <g transform={`translate(0 ${y})`} fill="#f7f3ec" stroke="color-mix(in oklab, var(--fg) 14%, transparent)" strokeWidth="2">
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
    <g stroke="color-mix(in oklab, var(--fg) 35%, transparent)" strokeWidth="4" strokeLinecap="round">
      <path d="M28 78h64M34 90h52M40 102h40" />
    </g>
  );
}
