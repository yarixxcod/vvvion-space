import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronLeft, ChevronRight, Plus, Search, Settings, X } from "lucide-react";
import { appNotify } from "@/lib/app-bridge";
import { getBearerToken } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { COLOR_INK } from "@/lib/calendar/colors";
import type { Draft } from "@/lib/calendar/parse-nl";
import { shiftCivil, utcFromWall, wallOf } from "@/lib/calendar/time";
import { useSwipe } from "@/lib/gestures/use-swipe";
import { useLang, useTx } from "@/lib/lang";

type View = "month" | "week" | "day" | "agenda";
type Cal = { id: string; name: string; color: string; tz: string; is_default: boolean };
type Prefs = { tz: string; week_starts: number; default_reminder_min: number };
type Item = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  tz: string;
  allDay?: boolean;
  location?: string;
  notes?: string;
  rrule?: string | null;
  color?: string | null;
  calendarId?: string;
};
type Parsed = { draft: Draft; confidence: "high" | "medium" | "low"; warnings: string[] };
type Scope = "this" | "this_and_future" | "all";

const VIEW_KEY = "vvvion.calendar.view";
const WEEKDAYS: Record<string, string[]> = {
  ru: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"],
  en: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  kk: ["Дс", "Сс", "Ср", "Бс", "Жм", "Сн", "Жк"],
};

function weekdayLabels(monday: boolean, lang: string) {
  const row = WEEKDAYS[lang] ?? WEEKDAYS.ru!;
  return monday ? row : [row[6]!, ...row.slice(0, 6)];
}

function weekdayOf(day: Date, tz: string, labels: string[], monday: boolean) {
  const weekday = wallOf(day, tz).weekday;
  const index = monday ? (weekday + 6) % 7 : weekday;
  return labels[index] ?? "";
}

function monthTitle(date: Date, tz: string) {
  const month = new Intl.DateTimeFormat(undefined, { month: "long", timeZone: tz }).format(date).replace(/\.$/, "");
  const label = month.charAt(0).toLocaleUpperCase() + month.slice(1);
  return `${label} ${wallOf(date, tz).year}`;
}
const COLOR: Record<string, string> = COLOR_INK;
const HOURS = Array.from({ length: 18 }, (_, index) => index + 6);

async function api(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set("content-type", "application/json");
  const token = getBearerToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  const res = await fetch(path, { ...init, headers, credentials: "same-origin" });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof body.message === "string" ? body.message : "Ошибка");
  return body;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function dayStart(date: Date, tz: string) {
  const wall = wallOf(date, tz);
  return utcFromWall(wall.year, wall.month, wall.day, 0, 0, tz);
}

function addDaysTz(date: Date, days: number, tz: string) {
  const wall = wallOf(date, tz);
  const next = shiftCivil(wall.year, wall.month, wall.day, days);
  return utcFromWall(next.year, next.month, next.day, 0, 0, tz);
}

function startOfWeek(date: Date, monday: boolean, tz: string) {
  const wall = wallOf(date, tz);
  const shift = monday ? (wall.weekday + 6) % 7 : wall.weekday;
  return addDaysTz(dayStart(date, tz), -shift, tz);
}

function ymd(date: Date, tz: string) {
  const wall = wallOf(date, tz);
  return `${wall.year}-${pad(wall.month)}-${pad(wall.day)}`;
}

function wallInput(iso: string, tz: string) {
  const wall = wallOf(new Date(iso), tz);
  return `${wall.year}-${pad(wall.month)}-${pad(wall.day)}T${pad(wall.hour)}:${pad(wall.minute)}`;
}

function fromWallInput(value: string, tz: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return new Date(value).toISOString();
  return utcFromWall(Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4]), Number(match[5]), tz).toISOString();
}

function asItem(row: Record<string, unknown>): Item | null {
  if (typeof row.id !== "string" || typeof row.startsAt !== "string") return null;
  return {
    id: row.id,
    title: typeof row.title === "string" ? row.title : "Событие",
    startsAt: row.startsAt,
    endsAt: typeof row.endsAt === "string" ? row.endsAt : row.startsAt,
    tz: typeof row.tz === "string" ? row.tz : "Asia/Almaty",
    allDay: row.allDay === true,
    location: typeof row.location === "string" ? row.location : "",
    notes: typeof row.notes === "string" ? row.notes : "",
    rrule: typeof row.rrule === "string" ? row.rrule : null,
    color: typeof row.color === "string" ? row.color : null,
    calendarId: typeof row.calendarId === "string" ? row.calendarId : undefined,
  };
}

export function CalendarDesk({ eventId }: { eventId?: string }) {
  const tx = useTx();
  const { user, isPending } = useCurrentUserState();
  const [view, setView] = useState<View>("week");
  const [cursor, setCursor] = useState(() => new Date());
  const [prefs, setPrefs] = useState<Prefs>({ tz: "Asia/Almaty", week_starts: 1, default_reminder_min: 15 });
  const [cals, setCals] = useState<Cal[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [phrase, setPhrase] = useState("");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [open, setOpen] = useState<Item | null>(null);
  const [form, setForm] = useState(false);
  const [seed, setSeed] = useState<Draft | null>(null);
  const [query, setQuery] = useState("");
  const [settings, setSettings] = useState(false);
  const [undo, setUndo] = useState<{ item: Item; scope: Scope } | null>(null);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState(0);
  const lang = useLang();
  const tz = prefs.tz || "Asia/Almaty";
  const weekLabels = weekdayLabels(prefs.week_starts === 1, lang);
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    const stored = localStorage.getItem(VIEW_KEY);
    if (stored === "month" || stored === "week" || stored === "day" || stored === "agenda") setView(stored);
    else if (window.matchMedia("(min-width: 800px)").matches) setView("week");
    else setView("month");
  }, []);
  useEffect(() => localStorage.setItem(VIEW_KEY, view), [view]);

  const range = useMemo(() => {
    if (view === "month") {
      const wall = wallOf(cursor, tz);
      const start = startOfWeek(utcFromWall(wall.year, wall.month, 1, 12, 0, tz), prefs.week_starts === 1, tz);
      return { from: start, to: addDaysTz(start, 42, tz) };
    }
    if (view === "week") {
      const start = startOfWeek(cursor, prefs.week_starts === 1, tz);
      return { from: start, to: addDaysTz(start, 7, tz) };
    }
    if (view === "day") {
      const start = dayStart(cursor, tz);
      return { from: start, to: addDaysTz(start, 1, tz) };
    }
    const start = dayStart(new Date(), tz);
    return { from: start, to: addDaysTz(start, 21, tz) };
  }, [cursor, prefs.week_starts, tz, view]);

  const load = useCallback(async () => {
    const desk = await api("/api/calendar");
    const nextPrefs = desk.prefs as Prefs;
    setPrefs(nextPrefs);
    setCals((desk.calendars as Cal[]) || []);
    const events = await api(`/api/calendar/events?from=${encodeURIComponent(range.from.toISOString())}&to=${encodeURIComponent(range.to.toISOString())}`);
    setItems((events.events as Item[]) || []);
  }, [range.from, range.to]);

  useEffect(() => {
    if (!user) return;
    void load().catch((err: Error) => setError(err.message));
  }, [user, load]);

  useEffect(() => {
    if (!eventId || !user) return;
    const found = items.find((item) => item.id === eventId);
    if (found) {
      setOpen(found);
      setCursor(new Date(found.startsAt));
      return;
    }
    void api(`/api/calendar/events/${eventId}`).then((body) => {
      const item = asItem(body);
      if (!item) return;
      setOpen(item);
      setCursor(new Date(item.startsAt));
    }).catch(() => undefined);
  }, [eventId, items, user]);

  useEffect(() => {
    if (!user) return;
    const pull = () => {
      void api("/api/calendar/due", { method: "POST", body: "{}" }).then((body) => {
        const rows = (body.reminders as { id: string; title: string; body: string; url: string }[]) || [];
        for (const row of rows) {
          appNotify({ id: row.id, channel: "calendar", title: row.title, body: row.body, url: row.url, onlyWhenBackground: true, kind: "info", ts: Date.now() });
          if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
            new Notification(row.title, { body: row.body });
          }
        }
      }).catch(() => undefined);
    };
    pull();
    const timer = window.setInterval(pull, 60_000);
    document.addEventListener("visibilitychange", pull);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", pull);
    };
  }, [user]);

  useEffect(() => {
    const phraseText = phrase.trim();
    if (phraseText.length < 3) {
      setParsed(null);
      return;
    }
    const timer = window.setTimeout(() => {
      void api("/api/calendar/parse", { method: "POST", body: JSON.stringify({ phrase: phraseText }) })
        .then((body) => {
          const draft = (body as { draft?: Draft }).draft;
          const confidence = (body as { confidence?: Parsed["confidence"] }).confidence;
          if (!draft || (confidence !== "high" && confidence !== "medium" && confidence !== "low")) {
            setParsed(null);
            return;
          }
          setParsed({ draft, confidence, warnings: Array.isArray((body as { warnings?: unknown }).warnings) ? (body as { warnings: string[] }).warnings : [] });
        })
        .catch(() => setParsed(null));
    }, 280);
    return () => window.clearTimeout(timer);
  }, [phrase]);

  function shift(dir: number) {
    setCursor((current) => {
      if (view === "month") {
        const wall = wallOf(current, tz);
        const month = wall.month + dir;
        const year = wall.year + Math.floor((month - 1) / 12);
        const nextMonth = ((month - 1) % 12 + 12) % 12 + 1;
        return utcFromWall(year, nextMonth, 1, 12, 0, tz);
      }
      if (view === "week") return addDaysTz(current, dir * 7, tz);
      return addDaysTz(current, dir, tz);
    });
  }

  const swipe = useSwipe({
    enabled: true,
    onCommit: (dir) => shift(dir === 1 ? -1 : 1),
  });

  async function createDraft(draft: Draft) {
    await api("/api/calendar/events", {
      method: "POST",
      body: JSON.stringify({
        title: draft.title,
        starts_at: draft.startsAt,
        ends_at: draft.endsAt,
        all_day: draft.allDay,
        tz: draft.tz,
        rrule: draft.rrule,
      }),
    });
    setPhrase("");
    setParsed(null);
    setSeed(null);
    await load();
  }

  async function savePhrase() {
    if (!parsed) return;
    if (parsed.confidence !== "high") {
      setSeed(parsed.draft);
      setForm(true);
      return;
    }
    await createDraft(parsed.draft);
  }

  async function remove(item: Item, scope: Scope) {
    await api(`/api/calendar/events/${item.id}?scope=${scope}&occurrence=${encodeURIComponent(item.startsAt)}`, { method: "DELETE" });
    setOpen(null);
    setUndo({ item, scope });
    window.setTimeout(() => setUndo((current) => (current?.item.id === item.id ? null : current)), 8000);
    await load();
  }

  async function restore(entry: { item: Item; scope: Scope }) {
    const item = entry.item;
    await api("/api/calendar/events", {
      method: "POST",
      body: JSON.stringify({
        title: item.title,
        starts_at: item.startsAt,
        ends_at: item.endsAt,
        all_day: item.allDay,
        tz: item.tz,
        location: item.location,
        notes: item.notes,
        rrule: entry.scope === "all" ? item.rrule : null,
        calendar_id: item.calendarId,
      }),
    });
    setUndo(null);
    await load();
  }

  async function move(item: Item, startsAt: string, endsAt: string) {
    await api(`/api/calendar/events/${item.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        scope: item.rrule ? "this" : "all",
        occurrence_at: item.startsAt,
        starts_at: startsAt,
        ends_at: endsAt,
      }),
    });
    await load();
  }

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = needle
      ? items.filter((item) => `${item.title} ${item.notes || ""} ${item.location || ""}`.toLowerCase().includes(needle))
      : items;
    return [...rows].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }, [items, query]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (event.target as HTMLElement | null)?.isContentEditable) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "t") setCursor(new Date());
      if (event.key === "n") {
        setSeed(null);
        setForm(true);
      }
      if (event.key === "ArrowLeft") shift(-1);
      if (event.key === "ArrowRight") shift(1);
      if (event.key === "1" || event.key === "m") setView("month");
      if (event.key === "2" || event.key === "w") setView("week");
      if (event.key === "3" || event.key === "d") setView("day");
      if (event.key === "4" || event.key === "a") setView("agenda");
      if (event.key === "/") {
        event.preventDefault();
        document.getElementById("cal-search")?.focus();
      }
      if (event.key === "j" || event.key === "k") {
        event.preventDefault();
        setPicked((current) => {
          const next = event.key === "j" ? current + 1 : current - 1;
          return Math.max(0, Math.min(shown.length - 1, next));
        });
      }
      if (event.key === "Enter" && shown[picked]) setOpen(shown[picked]);
      if (event.key === "Escape") {
        setOpen(null);
        setForm(false);
        setSettings(false);
      }
      if ((event.key === "Delete" || event.key === "Backspace") && openRef.current) {
        event.preventDefault();
        document.getElementById("cal-delete")?.click();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picked, shown, tz, view]);

  if (isPending) return <p className="p-6 text-sm text-muted">{tx({ ru: "Открываю календарь", en: "Opening the calendar", kk: "Күнтізбені ашамын" })}</p>;
  if (!user) {
    return (
      <div className="mx-auto max-w-md px-5 py-16 text-center">
        <h2 className="font-serif text-3xl">{tx({ ru: "Календарь", en: "Calendar", kk: "Күнтізбе" })}</h2>
        <p className="mt-3 text-sm text-muted">{tx({ ru: "Войдите, чтобы встречи были только ваши.", en: "Sign in so the events stay yours.", kk: "Кездесулер тек сіздікі болуы үшін кіріңіз." })}</p>
      </div>
    );
  }

  const days = Array.from({ length: view === "month" ? 42 : view === "week" ? 7 : 1 }, (_, index) => addDaysTz(range.from, index, tz));
  const title = monthTitle(cursor, tz);
  const todayKey = ymd(new Date(), tz);
  const preview = parsed?.draft ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col outline-none" {...swipe}>
      <div className="px-3 pt-2">
        <h2 className="truncate font-serif text-[1.65rem] leading-none tracking-tight sm:text-3xl">{title}</h2>
        <div className="mt-2 flex items-center gap-1.5">
          <button type="button" className="press h-11 min-w-0 flex-1 rounded-2xl border border-line px-3 text-sm" onClick={() => setCursor(new Date())}>{tx({ ru: "Сегодня", en: "Today", kk: "Бүгін" })}</button>
          <button type="button" className="press grid size-11 shrink-0 place-items-center rounded-2xl border border-line" aria-label={tx({ ru: "Назад", en: "Back", kk: "Артқа" })} onClick={() => shift(-1)}><ChevronLeft className="size-5" /></button>
          <button type="button" className="press grid size-11 shrink-0 place-items-center rounded-2xl border border-line" aria-label={tx({ ru: "Дальше", en: "Forward", kk: "Алға" })} onClick={() => shift(1)}><ChevronRight className="size-5" /></button>
          <button type="button" className="press grid size-11 shrink-0 place-items-center rounded-2xl border border-line" aria-label={tx({ ru: "Настройки", en: "Settings", kk: "Баптау" })} onClick={() => setSettings(true)}><Settings className="size-5" /></button>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1.5 px-3">
        {(["month", "week", "day", "agenda"] as View[]).map((id) => (
          <button key={id} type="button" className={`press h-11 rounded-full px-1 text-sm ${view === id ? "bg-fg text-bg" : "border border-line"}`} onClick={() => setView(id)}>
            {tx(id === "month" ? { ru: "Месяц", en: "Month", kk: "Ай" } : id === "week" ? { ru: "Неделя", en: "Week", kk: "Апта" } : id === "day" ? { ru: "День", en: "Day", kk: "Күн" } : { ru: "Список", en: "List", kk: "Тізім" })}
          </button>
        ))}
      </div>
      <label className="relative mx-3 mt-2 block">
        <Search className="pointer-events-none absolute top-3 left-3 size-4 text-faint" />
        <input id="cal-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tx({ ru: "Поиск", en: "Search", kk: "Іздеу" })} className="h-11 w-full rounded-2xl border border-line bg-bg pr-3 pl-9 text-sm outline-none" data-no-swipe />
      </label>
      <div className={view === "month" ? "min-h-0 flex-1 overflow-hidden px-2 py-2" : "min-h-0 flex-1 overflow-y-auto px-3 py-3"}>
        {error ? <p className="mb-3 text-sm text-danger">{error}</p> : null}
        {view === "agenda" ? (
          <Agenda items={shown} tz={tz} picked={picked} onOpen={setOpen} empty={tx({ ru: "Пока пусто. Напишите ниже: «завтра в 15:00 встреча».", en: "Nothing yet. Try “tomorrow at 3pm coffee”.", kk: "Әзірге бос. Төменге жазыңыз: «ертең сағат 15:00 кездесу»." })} />
        ) : view === "month" ? (
          <Month days={days} items={shown} tz={tz} cursor={cursor} todayKey={todayKey} labels={weekLabels} onOpen={setOpen} onDay={(day) => { setCursor(day); setView("day"); }} onMove={(item, startsAt, endsAt) => void move(item, startsAt, endsAt).catch((err: Error) => setError(err.message))} />
        ) : (
          <Hours days={days} items={shown} tz={tz} labels={weekLabels} monday={prefs.week_starts === 1} todayKey={todayKey} onOpen={setOpen} onMove={(item, startsAt, endsAt) => void move(item, startsAt, endsAt).catch((err: Error) => setError(err.message))} />
        )}
      </div>
      <form className="border-t border-line px-3 py-3" data-no-swipe onSubmit={(event) => { event.preventDefault(); void savePhrase().catch((err: Error) => setError(err.message)); }}>
        <div className="flex gap-2">
          <input value={phrase} onChange={(event) => setPhrase(event.target.value)} placeholder={tx({ ru: "Завтра в 15:00 встреча с Иваном", en: "Tomorrow at 3pm with Ivan", kk: "Ертең сағат 15:00 Иванмен кездесу" })} className="h-12 min-w-0 flex-1 rounded-2xl border border-line bg-bg px-3 text-sm outline-none" />
          <button type="submit" className="press grid size-12 place-items-center rounded-2xl bg-accent text-accent-fg" aria-label={tx({ ru: "Добавить", en: "Add", kk: "Қосу" })}><Plus className="size-5" /></button>
        </div>
        {preview ? (
          <p className="mt-2 text-xs text-muted">
            {preview.title} · {new Intl.DateTimeFormat(undefined, { timeZone: preview.tz, day: "numeric", month: "short", hour: preview.allDay ? undefined : "2-digit", minute: preview.allDay ? undefined : "2-digit" }).format(new Date(preview.startsAt))}
            {preview.rrule ? ` · ${preview.rrule}` : ""}
            {parsed && parsed.confidence !== "high" ? ` · ${tx({ ru: "уточните в форме", en: "check the form", kk: "нысанда нақтылаңыз" })}` : ""}
          </p>
        ) : null}
      </form>
      {open ? <Card item={open} tz={tz} onClose={() => setOpen(null)} onDelete={(scope) => void remove(open, scope).catch((err: Error) => setError(err.message))} onEdit={() => { setSeed(null); setForm(true); }} /> : null}
      {form ? (
        <Editor
          tz={tz}
          calendars={cals}
          initial={seed ? null : open}
          seed={seed}
          reminder={prefs.default_reminder_min}
          onClose={() => { setForm(false); setSeed(null); }}
          onSaved={() => { setForm(false); setSeed(null); setPhrase(""); setParsed(null); void load(); }}
        />
      ) : null}
      {settings ? <PrefsForm prefs={prefs} onClose={() => setSettings(false)} onSaved={(next) => { setPrefs(next); setSettings(false); }} /> : null}
      {undo ? <button type="button" className="press fixed bottom-24 left-1/2 z-20 min-h-11 -translate-x-1/2 rounded-full bg-fg px-4 text-sm text-bg" onClick={() => void restore(undo).catch((err: Error) => setError(err.message))}>{tx({ ru: "Вернуть событие", en: "Undo delete", kk: "Оқиғаны қайтару" })}</button> : null}
    </div>
  );
}

function Agenda({ items, tz, picked, onOpen, empty }: { items: Item[]; tz: string; picked: number; onOpen: (item: Item) => void; empty: string }) {
  if (!items.length) return <p className="px-2 py-10 text-center text-sm text-muted">{empty}</p>;
  return (
    <ul className="space-y-2">
      {items.map((item, index) => (
        <li key={`${item.id}-${item.startsAt}`}>
          <button type="button" className={`press flex min-h-11 w-full items-center gap-3 rounded-[1.2rem] border px-3 py-2 text-left ${index === picked ? "border-accent bg-elev" : "border-line bg-elev"}`} onClick={() => onOpen(item)}>
            <span className="h-8 w-1.5 rounded-full" style={{ background: COLOR[item.color || "lilac"] || COLOR.lilac }} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{item.title}</span>
              <span className="text-xs text-muted">{new Intl.DateTimeFormat(undefined, { timeZone: tz, day: "numeric", month: "short", hour: item.allDay ? undefined : "2-digit", minute: item.allDay ? undefined : "2-digit" }).format(new Date(item.startsAt))}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function chip(item: Item, onOpen: (item: Item) => void, compact = false) {
  return (
    <button key={`${item.id}-${item.startsAt}`} type="button" draggable className={compact ? "block w-full truncate rounded px-0.5 text-left text-[10px] leading-4" : "mt-1 block min-h-8 w-full truncate rounded-lg px-1.5 py-1 text-left text-xs"} style={{ background: `${COLOR[item.color || "lilac"] || COLOR.lilac}33` }} onDragStart={(event) => event.dataTransfer.setData("text/plain", `${item.id}|${item.startsAt}`)} onClick={(event) => { event.stopPropagation(); onOpen(item); }}>
      {item.title}
    </button>
  );
}

function Month({ days, items, tz, cursor, todayKey, labels, onOpen, onDay, onMove }: { days: Date[]; items: Item[]; tz: string; cursor: Date; todayKey: string; labels: string[]; onOpen: (item: Item) => void; onDay: (day: Date) => void; onMove: (item: Item, startsAt: string, endsAt: string) => void }) {
  const month = wallOf(cursor, tz).month;
  const weeks = Math.max(1, days.length / 7);
  return (
    <div className="grid h-full min-h-0 grid-cols-7 gap-1" style={{ gridTemplateRows: `auto repeat(${weeks}, minmax(0, 1fr))` }}>
      {labels.map((label) => (
        <p key={label} className="truncate text-center text-[11px] font-medium leading-4 text-faint">{label}</p>
      ))}
      {days.map((day) => {
        const key = ymd(day, tz);
        const wall = wallOf(day, tz);
        const dayItems = items.filter((item) => ymd(new Date(item.startsAt), tz) === key);
        const today = key === todayKey;
        return (
          <div
            key={key}
            className={`flex min-h-0 flex-col overflow-hidden rounded-xl border p-0.5 ${wall.month === month ? "bg-elev" : "opacity-40"} ${today ? "border-accent" : "border-line"}`}
            onClick={() => onDay(day)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => dropOn(event, items, day, tz, null, onMove)}
          >
            <button type="button" className={`press mx-auto grid size-6 shrink-0 place-items-center rounded-full text-sm leading-none ${today ? "bg-accent text-accent-fg" : ""}`} onClick={() => onDay(day)}>{wall.day}</button>
            <div className="min-h-0 flex-1 overflow-hidden">
              {dayItems.slice(0, 2).map((item) => chip(item, onOpen, true))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Hours({ days, items, tz, labels, monday, todayKey, onOpen, onMove }: { days: Date[]; items: Item[]; tz: string; labels: string[]; monday: boolean; todayKey: string; onOpen: (item: Item) => void; onMove: (item: Item, startsAt: string, endsAt: string) => void }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 grid gap-1" style={{ gridTemplateColumns: `2.25rem repeat(${days.length}, minmax(0, 1fr))` }}>
        <span />
        {days.map((day) => {
          const wall = wallOf(day, tz);
          const key = ymd(day, tz);
          return (
            <p key={key} className="truncate text-center leading-tight">
              <span className="block text-[10px] text-faint">{weekdayOf(day, tz, labels, monday)}</span>
              <span className={`mx-auto grid size-7 place-items-center rounded-full font-serif text-base ${key === todayKey ? "bg-accent text-accent-fg" : ""}`}>{wall.day}</span>
            </p>
          );
        })}
      </div>
      {HOURS.map((hour) => (
        <div key={hour} className="grid gap-1 border-t border-line" style={{ gridTemplateColumns: `2.25rem repeat(${days.length}, minmax(0, 1fr))` }}>
          <p className="py-1 text-[11px] text-faint">{pad(hour)}</p>
          {days.map((day) => {
            const key = ymd(day, tz);
            const dayItems = items.filter((item) => {
              if (item.allDay) return false;
              const wall = wallOf(new Date(item.startsAt), tz);
              return ymd(new Date(item.startsAt), tz) === key && wall.hour === hour;
            });
            return (
              <div key={`${key}-${hour}`} className="min-h-11 rounded-lg" onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropOn(event, items, day, tz, hour, onMove)}>
                {dayItems.map((item) => (
                  <div key={`${item.id}-${item.startsAt}`} className="group relative">
                    {chip(item, onOpen)}
                    <button
                      type="button"
                      aria-label="Resize"
                      className="absolute right-1 bottom-0 left-1 h-2 cursor-ns-resize"
                      onPointerDown={(event) => startResize(event, item, onMove)}
                    />
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function dropOn(event: DragEvent, items: Item[], day: Date, tz: string, hour: number | null, onMove: (item: Item, startsAt: string, endsAt: string) => void) {
  const raw = event.dataTransfer.getData("text/plain");
  const item = items.find((row) => `${row.id}|${row.startsAt}` === raw);
  if (!item) return;
  const from = wallOf(new Date(item.startsAt), tz);
  const dest = wallOf(day, tz);
  const length = new Date(item.endsAt).getTime() - new Date(item.startsAt).getTime();
  const startsAt = utcFromWall(dest.year, dest.month, dest.day, hour ?? from.hour, from.minute, tz).toISOString();
  onMove(item, startsAt, new Date(new Date(startsAt).getTime() + Math.max(length, 15 * 60_000)).toISOString());
}

function startResize(event: ReactPointerEvent, item: Item, onMove: (item: Item, startsAt: string, endsAt: string) => void) {
  event.preventDefault();
  event.stopPropagation();
  const origin = event.clientY;
  const length = new Date(item.endsAt).getTime() - new Date(item.startsAt).getTime();
  let next = length;
  const move = (pointer: PointerEvent) => {
    const steps = Math.round((pointer.clientY - origin) / 16);
    next = Math.max(15 * 60_000, length + steps * 15 * 60_000);
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("keydown", cancel);
    if (next !== length) onMove(item, item.startsAt, new Date(new Date(item.startsAt).getTime() + next).toISOString());
  };
  const cancel = (key: KeyboardEvent) => {
    if (key.key !== "Escape") return;
    next = length;
    up();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("keydown", cancel);
}

function Card({ item, tz, onClose, onDelete, onEdit }: { item: Item; tz: string; onClose: () => void; onDelete: (scope: Scope) => void; onEdit: () => void }) {
  const tx = useTx();
  const [scope, setScope] = useState<Scope>(item.rrule ? "this" : "all");
  const [sure, setSure] = useState(false);
  const when = new Intl.DateTimeFormat(undefined, { timeZone: tz, weekday: "short", day: "numeric", month: "long", hour: item.allDay ? undefined : "2-digit", minute: item.allDay ? undefined : "2-digit" }).format(new Date(item.startsAt));
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/50 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-[1.6rem] border border-line bg-elev p-4 sm:rounded-[1.6rem]" onClick={(event) => event.stopPropagation()} role="dialog">
        <div className="flex items-start gap-3">
          <h3 className="min-w-0 flex-1 font-serif text-2xl">{item.title}</h3>
          <button type="button" className="press grid size-11 place-items-center" onClick={onClose} aria-label="Close"><X className="size-5" /></button>
        </div>
        <p className="mt-2 text-sm text-muted">{when}</p>
        {item.location ? <p className="mt-1 text-sm">{item.location}</p> : null}
        {item.notes ? <p className="mt-2 text-sm text-muted">{item.notes}</p> : null}
        {item.rrule ? (
          <label className="mt-3 block text-sm">
            {tx({ ru: "Что менять", en: "What to change", kk: "Нені өзгерту" })}
            <select className="mt-1 h-11 w-full rounded-xl border border-line bg-bg px-2" value={scope} onChange={(event) => setScope(event.target.value as Scope)}>
              <option value="this">{tx({ ru: "Только это", en: "Only this", kk: "Тек осы" })}</option>
              <option value="this_and_future">{tx({ ru: "Это и далее", en: "This and future", kk: "Осы және келесі" })}</option>
              <option value="all">{tx({ ru: "Все", en: "All", kk: "Барлығы" })}</option>
            </select>
          </label>
        ) : null}
        <div className="mt-4 flex gap-2">
          <button type="button" className="press min-h-11 flex-1 rounded-2xl border border-line" onClick={onEdit}>{tx({ ru: "Изменить", en: "Edit", kk: "Өзгерту" })}</button>
          <button id="cal-delete" type="button" className="press min-h-11 flex-1 rounded-2xl bg-danger/15 text-danger" onClick={() => setSure(true)}>{tx({ ru: "Удалить", en: "Delete", kk: "Жою" })}</button>
        </div>
        {sure ? (
          <div className="mt-3 rounded-2xl border border-line p-3">
            <p className="text-sm">{tx({ ru: "Удалить это событие?", en: "Delete this event?", kk: "Осы оқиғаны жою керек пе?" })}</p>
            <div className="mt-2 flex gap-2">
              <button type="button" className="press min-h-11 flex-1 rounded-2xl border border-line" onClick={() => setSure(false)}>{tx({ ru: "Нет", en: "No", kk: "Жоқ" })}</button>
              <button type="button" className="press min-h-11 flex-1 rounded-2xl bg-danger/15 text-danger" onClick={() => onDelete(scope)}>{tx({ ru: "Да, удалить", en: "Yes, delete", kk: "Иә, жою" })}</button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Editor({ tz, calendars, initial, seed, reminder, onClose, onSaved }: { tz: string; calendars: Cal[]; initial: Item | null; seed: Draft | null; reminder: number; onClose: () => void; onSaved: () => void }) {
  const tx = useTx();
  const source = seed ?? initial;
  const [title, setTitle] = useState(source?.title || "");
  const [start, setStart] = useState(wallInput(source?.startsAt || new Date().toISOString(), tz));
  const [end, setEnd] = useState(wallInput(source?.endsAt || new Date(Date.now() + 3600000).toISOString(), tz));
  const [allDay, setAllDay] = useState(Boolean(source && "allDay" in source ? source.allDay : false));
  const [repeat, setRepeat] = useState(source?.rrule || "");
  const [location, setLocation] = useState(initial?.location || "");
  const [notes, setNotes] = useState(initial?.notes || "");
  const [calendarId, setCalendarId] = useState(initial?.calendarId || calendars.find((cal) => cal.is_default)?.id || calendars[0]?.id || "");
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 sm:items-center" onClick={onClose}>
      <form className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-[1.6rem] border border-line bg-elev p-4 sm:rounded-[1.6rem]" data-no-swipe onClick={(event) => event.stopPropagation()} onSubmit={(event) => {
        event.preventDefault();
        const body = {
          title,
          starts_at: fromWallInput(start, tz),
          ends_at: fromWallInput(end, tz),
          all_day: allDay,
          tz,
          rrule: repeat || null,
          location,
          notes,
          calendar_id: calendarId,
          reminders: [reminder],
          scope: initial?.rrule ? "this" : "all",
          occurrence_at: initial?.startsAt,
        };
        const path = initial ? `/api/calendar/events/${initial.id}` : "/api/calendar/events";
        void api(path, { method: initial ? "PATCH" : "POST", body: JSON.stringify(body) }).then(onSaved).catch(() => undefined);
      }}>
        <h3 className="font-serif text-2xl">{tx({ ru: "Событие", en: "Event", kk: "Оқиға" })}</h3>
        <input required value={title} onChange={(event) => setTitle(event.target.value)} placeholder={tx({ ru: "Название", en: "Title", kk: "Атауы" })} className="mt-3 h-12 w-full rounded-2xl border border-line bg-bg px-3" />
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <input type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} className="h-12 rounded-2xl border border-line bg-bg px-3" />
          <input type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} className="h-12 rounded-2xl border border-line bg-bg px-3" />
        </div>
        <label className="mt-2 flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={allDay} onChange={(event) => setAllDay(event.target.checked)} />{tx({ ru: "Весь день", en: "All day", kk: "Күні бойы" })}</label>
        <select value={repeat} onChange={(event) => setRepeat(event.target.value)} className="mt-2 h-12 w-full rounded-2xl border border-line bg-bg px-3">
          <option value="">{tx({ ru: "Не повторять", en: "Does not repeat", kk: "Қайталанбайды" })}</option>
          <option value="FREQ=DAILY">{tx({ ru: "Каждый день", en: "Every day", kk: "Күн сайын" })}</option>
          <option value="FREQ=WEEKLY">{tx({ ru: "Каждую неделю", en: "Every week", kk: "Апта сайын" })}</option>
          <option value="FREQ=MONTHLY">{tx({ ru: "Каждый месяц", en: "Every month", kk: "Ай сайын" })}</option>
        </select>
        {calendars.length ? (
          <select value={calendarId} onChange={(event) => setCalendarId(event.target.value)} className="mt-2 h-12 w-full rounded-2xl border border-line bg-bg px-3">
            {calendars.map((cal) => <option key={cal.id} value={cal.id}>{cal.name}</option>)}
          </select>
        ) : null}
        <input value={location} onChange={(event) => setLocation(event.target.value)} placeholder={tx({ ru: "Место", en: "Place", kk: "Орын" })} className="mt-2 h-12 w-full rounded-2xl border border-line bg-bg px-3" />
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={tx({ ru: "Заметка", en: "Note", kk: "Жазба" })} className="mt-2 min-h-24 w-full rounded-2xl border border-line bg-bg px-3 py-2" />
        <div className="mt-3 flex gap-2">
          <button type="button" className="press min-h-11 flex-1 rounded-2xl border border-line" onClick={onClose}>{tx({ ru: "Отмена", en: "Cancel", kk: "Болдырмау" })}</button>
          <button type="submit" className="press min-h-11 flex-1 rounded-2xl bg-accent text-accent-fg">{tx({ ru: "Сохранить", en: "Save", kk: "Сақтау" })}</button>
        </div>
      </form>
    </div>
  );
}

function PrefsForm({ prefs, onClose, onSaved }: { prefs: Prefs; onClose: () => void; onSaved: (prefs: Prefs) => void }) {
  const tx = useTx();
  const [tz, setTz] = useState(prefs.tz);
  const [week, setWeek] = useState(prefs.week_starts);
  const [reminder, setReminder] = useState(prefs.default_reminder_min);
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 sm:items-center" onClick={onClose}>
      <form className="w-full max-w-md rounded-t-[1.6rem] border border-line bg-elev p-4 sm:rounded-[1.6rem]" data-no-swipe onClick={(event) => event.stopPropagation()} onSubmit={(event) => {
        event.preventDefault();
        void api("/api/calendar/prefs", { method: "PUT", body: JSON.stringify({ tz, week_starts: week, default_reminder_min: reminder }) }).then((body) => onSaved((body as { prefs: Prefs }).prefs));
      }}>
        <h3 className="font-serif text-2xl">{tx({ ru: "Календарь", en: "Calendar", kk: "Күнтізбе" })}</h3>
        <label className="mt-3 block text-sm">{tx({ ru: "Часовой пояс", en: "Time zone", kk: "Уақыт белдеуі" })}
          <input value={tz} onChange={(event) => setTz(event.target.value)} className="mt-1 h-12 w-full rounded-2xl border border-line bg-bg px-3" />
        </label>
        <label className="mt-2 block text-sm">{tx({ ru: "Неделя с", en: "Week starts", kk: "Апта басы" })}
          <select value={week} onChange={(event) => setWeek(Number(event.target.value))} className="mt-1 h-12 w-full rounded-2xl border border-line bg-bg px-3">
            <option value={1}>{tx({ ru: "Понедельника", en: "Monday", kk: "Дүйсенбі" })}</option>
            <option value={0}>{tx({ ru: "Воскресенья", en: "Sunday", kk: "Жексенбі" })}</option>
          </select>
        </label>
        <label className="mt-2 block text-sm">{tx({ ru: "Напоминание, минут", en: "Reminder, minutes", kk: "Еске салу, минут" })}
          <select value={reminder} onChange={(event) => setReminder(Number(event.target.value))} className="mt-1 h-12 w-full rounded-2xl border border-line bg-bg px-3">
            {[0, 5, 10, 15, 30, 60, 120, 1440].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <button type="button" className="press mt-3 min-h-11 w-full rounded-2xl border border-line text-sm" onClick={() => { if (typeof Notification !== "undefined") void Notification.requestPermission(); }}>{tx({ ru: "Уведомления браузера", en: "Browser notifications", kk: "Браузер хабарламасы" })}</button>
        <button type="submit" className="press mt-2 min-h-11 w-full rounded-2xl bg-accent text-accent-fg">{tx({ ru: "Сохранить", en: "Save", kk: "Сақтау" })}</button>
      </form>
    </div>
  );
}
