import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Check, ChevronDown } from "lucide-react";
import { LANGS, explicitLangFromSearch, ui, type Lang } from "@/lib/i18n";

const STORAGE_KEY = "vvvion.lang";

let clientLang: Lang = "ru";

export function readUiLang(): Lang {
  return clientLang;
}

function readStored(): Lang | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? explicitLangFromSearch(`lang=${raw}`) : undefined;
  } catch {
    return undefined;
  }
}

function writeStored(lang: Lang) {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* storage can be blocked in a private preview */
  }
  document.cookie = `vvvion_lang=${lang}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

const Ctx = createContext<{ lang: Lang; setLang: (lang: Lang) => void }>({
  lang: "ru",
  setLang: () => {},
});

export function LangProvider({ children }: { children: ReactNode }) {
  const searchStr = useRouterState({ select: (state) => state.location.searchStr });
  const urlLang = explicitLangFromSearch(searchStr);
  const [pick, setPick] = useState<Lang | null>(null);
  const lang = pick ?? urlLang ?? "ru";
  const navigate = useNavigate();

  if (typeof window !== "undefined") clientLang = lang;

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  useEffect(() => {
    if (urlLang) {
      writeStored(urlLang);
      setPick(null);
      return;
    }
    const stored = readStored();
    if (stored && stored !== "ru") setPick(stored);
  }, [urlLang]);

  const setLang = useCallback(
    (next: Lang) => {
      writeStored(next);
      setPick(next);
      document.documentElement.lang = next;
      const url = new URL(window.location.href);
      if (next === "ru") url.searchParams.delete("lang");
      else url.searchParams.set("lang", next);
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
      void navigate({
        to: ".",
        search: (prev) => {
          const copy: Record<string, unknown> = { ...((prev as Record<string, unknown> | undefined) ?? {}) };
          if (next === "ru") delete copy.lang;
          else copy.lang = next;
          return copy;
        },
        replace: true,
        resetScroll: false,
      });
    },
    [navigate],
  );

  return <Ctx.Provider value={{ lang, setLang }}>{children}</Ctx.Provider>;
}

export function useLang(): Lang {
  return useContext(Ctx).lang;
}

export function useSetLang(): (lang: Lang) => void {
  return useContext(Ctx).setLang;
}

export function useTx() {
  const lang = useLang();
  return useCallback((copy: Record<Lang, string>) => copy[lang] ?? copy.ru, [lang]);
}

export function txNow(copy: Record<Lang, string>): string {
  return copy[readUiLang()] ?? copy.ru;
}

const NAMES: Record<Lang, string> = { ru: "Русский", en: "English", kk: "Қазақша" };
const FLAGS: Record<Lang, string> = { ru: "🇷🇺", en: "🇬🇧", kk: "🇰🇿" };
const SHORT: Record<Lang, string> = { ru: "РУ", en: "EN", kk: "ҚАЗ" };

export function LangSwitch({ compact = false }: { compact?: boolean }) {
  const lang = useLang();
  const setLang = useSetLang();
  const label = ui(lang, "language");
  if (compact) return <LangCompact label={label} />;
  return (
    <div className="px-1 py-1" role="group" aria-label={label}>
      <p className="px-2 pb-1 text-xs text-faint">{label}</p>
      <div className="grid grid-cols-3 gap-1">
        {LANGS.map((code) => (
          <button
            key={code}
            type="button"
            role="menuitemradio"
            aria-checked={lang === code}
            className={`press h-10 rounded-xl text-xs ${lang === code ? "bg-accent font-medium text-accent-fg" : "text-muted"}`}
            onClick={() => setLang(code)}
          >
            {FLAGS[code]} {NAMES[code]}
          </button>
        ))}
      </div>
    </div>
  );
}

function LangCompact({ label }: { label: string }) {
  const lang = useLang();
  const setLang = useSetLang();
  const [open, setOpen] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [node, setNode] = useState<HTMLElement | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => setNode(document.body), []);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const apply = () => setNarrow(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  useEffect(() => {
    if (!open || narrow) return;
    const onDoc = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDoc);
    return () => document.removeEventListener("pointerdown", onDoc);
  }, [open, narrow]);

  function choose(code: Lang) {
    setLang(code);
    setOpen(false);
  }

  const list = (
    <div role="listbox" aria-label={label}>
      {LANGS.map((code) => {
        const on = code === lang;
        return (
          <button
            key={code}
            type="button"
            role="option"
            aria-selected={on}
            className={`press flex min-h-14 w-full items-center gap-3 rounded-2xl px-3 text-left ${on ? "border border-accent bg-subtle text-fg" : "border border-transparent text-muted"}`}
            onClick={() => choose(code)}
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl border border-line bg-bg text-lg" aria-hidden="true">
              {FLAGS[code]}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm">{NAMES[code]}</span>
              <span className="block text-xs text-faint">{SHORT[code]}</span>
            </span>
            {on ? <Check className="size-4 shrink-0" /> : null}
          </button>
        );
      })}
    </div>
  );

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        className="press inline-flex h-11 items-center gap-1.5 rounded-2xl border border-line bg-elev px-2.5 text-sm text-fg"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">{FLAGS[lang]}</span>
        <span>{SHORT[lang]}</span>
        <ChevronDown className={`size-3.5 text-muted transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && !narrow ? (
        <div className="absolute top-full right-0 z-40 mt-1 w-60 rounded-2xl border border-line bg-elev p-1 shadow-[var(--shadow)]">
          {list}
        </div>
      ) : null}
      {open && narrow && node
        ? createPortal(
            <div className="fixed inset-0 z-[80] flex items-end bg-black/50" onClick={() => setOpen(false)}>
              <div
                role="dialog"
                aria-modal="true"
                aria-label={label}
                className="w-full rounded-t-3xl border border-line bg-elev px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[var(--shadow)]"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-line" />
                <p className="px-3 pb-1 text-xs font-medium tracking-wide text-faint uppercase">{label}</p>
                {list}
              </div>
            </div>,
            node,
          )
        : null}
    </div>
  );
}
