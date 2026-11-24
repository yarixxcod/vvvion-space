import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { LANGS, explicitLangFromSearch, ui, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

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

function Flag({ code }: { code: Lang }) {
  if (code === "ru") {
    return (
      <svg viewBox="0 0 24 16" className="h-3.5 w-5 overflow-hidden rounded-[3px] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.18)]" aria-hidden="true">
        <rect width="24" height="16" fill="#fff" />
        <rect y="5.34" width="24" height="5.33" fill="#0039a6" />
        <rect y="10.67" width="24" height="5.33" fill="#d52b1e" />
      </svg>
    );
  }
  if (code === "en") {
    return (
      <svg viewBox="0 0 60 30" className="h-3.5 w-5 overflow-hidden rounded-[3px] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.18)]" aria-hidden="true">
        <rect width="60" height="30" fill="#012169" />
        <path d="M0 0 L60 30 M60 0 L0 30" stroke="#fff" strokeWidth="8" />
        <path d="M0 0 L60 30 M60 0 L0 30" stroke="#C8102E" strokeWidth="4" />
        <path d="M30 0 V30 M0 15 H60" stroke="#fff" strokeWidth="12" />
        <path d="M30 0 V30 M0 15 H60" stroke="#C8102E" strokeWidth="6" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 16" className="h-3.5 w-5 overflow-hidden rounded-[3px] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.18)]" aria-hidden="true">
      <rect width="24" height="16" fill="#00afca" />
      <circle cx="12" cy="8" r="3.1" fill="#fec50c" />
      <circle cx="12" cy="8" r="1.35" fill="#00afca" />
      <path d="M12 3.2 l.45 1.15 h1.2 l-.95.75.35 1.2 L12 5.6 l-1.05.7.35-1.2-.95-.75 h1.2 z" fill="#fec50c" />
    </svg>
  );
}

export function LangSwitch({ compact = false }: { compact?: boolean }) {
  const lang = useLang();
  const setLang = useSetLang();
  const label = ui(lang, "language");
  return (
    <div className={cn(compact ? "inline-flex" : "block w-full px-1 py-1")} role="group" aria-label={label}>
      {compact ? null : <p className="px-1 pb-1 text-xs text-faint">{label}</p>}
      <div className={cn("grid grid-cols-3 gap-1", compact ? "" : "w-full")}>
        {LANGS.map((code) => {
          const on = lang === code;
          return (
            <button
              key={code}
              type="button"
              aria-pressed={on}
              aria-label={NAMES[code]}
              title={NAMES[code]}
              className={cn(
                "press inline-flex items-center justify-center gap-1.5 border text-xs",
                compact ? "h-10 rounded-xl px-1.5" : "h-11 rounded-xl px-2",
                on ? "border-accent bg-accent font-medium text-accent-fg" : "border-line bg-elev text-muted",
              )}
              onClick={() => setLang(code)}
            >
              <Flag code={code} />
              {compact ? null : <span className="truncate">{NAMES[code]}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
