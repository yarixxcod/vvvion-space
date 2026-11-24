import { useEffect, useState } from "react";
import { Monitor, Share2, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { isApp, isDesktop } from "@/lib/app-bridge";
import { ui } from "@/lib/i18n";
import { useLang, useTx } from "@/lib/lang";
import { absoluteUrl } from "@/lib/places";

type WindowsRelease = { version: string; notes: string; href: string };
type AndroidRelease = { versionName: string; apkUrl: string; changelog: string };

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function AppsDesk() {
  const lang = useLang();
  const tx = useTx();
  const [windows, setWindows] = useState<WindowsRelease | null>(null);
  const [android, setAndroid] = useState<AndroidRelease | null>(null);
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const here = isDesktop();
  const pageUrl = absoluteUrl("/?place=apps");

  async function sharePage() {
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: ui(lang, "apps"), text: ui(lang, "subApps"), url: pageUrl });
        return;
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
    }
    try {
      await navigator.clipboard.writeText(pageUrl);
      toast(ui(lang, "copied"));
    } catch {
      toast(pageUrl);
    }
  }

  useEffect(() => {
    const nav = navigator as Navigator & { standalone?: boolean };
    setStandalone(window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true || isApp());
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  useEffect(() => {
    let dead = false;
    if (!here) {
      void fetch("/api/app/desktop/update/windows/x86_64/0.0.0")
        .then(async (res) => {
          if (dead || res.status !== 200) return;
          const body = (await res.json()) as { version?: string; notes?: string; url?: string };
          const href = typeof body.url === "string" ? safeDesktop(body.url) : null;
          if (body.version) setWindows({ version: body.version, notes: typeof body.notes === "string" ? body.notes : "", href: href || "/app/desktop/latest" });
        })
        .catch(() => undefined);
    }
    void fetch("/app/version.json")
      .then(async (res) => {
        if (dead || !res.ok) return;
        const body = (await res.json()) as { versionName?: string; apkUrl?: string; changelog?: string };
        if (body.versionName && body.apkUrl && safeApk(body.apkUrl)) {
          setAndroid({ versionName: body.versionName, apkUrl: safeApk(body.apkUrl) || "", changelog: body.changelog || "" });
        }
      })
      .catch(() => undefined);
    return () => {
      dead = true;
    };
  }, [here]);

  return (
    <div className="h-full overflow-y-auto px-3 py-4 lg:px-6 lg:py-6">
      <div className="mx-auto w-full max-w-5xl">
        <p className="text-xs tracking-[0.18em] text-faint uppercase">{ui(lang, "apps")}</p>
        <h2 className="mt-1 font-serif text-3xl tracking-tight lg:text-4xl">
          {tx({ ru: "Свежие приложения", en: "Latest apps", kk: "Жаңа қолданбалар" })}
        </h2>
        <p className="mt-2 max-w-xl text-sm text-muted">{ui(lang, "subApps")}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className="press inline-flex h-10 items-center gap-2 rounded-xl border border-line px-3 text-sm" onClick={() => void sharePage()}>
            <Share2 className="size-4" />
            {ui(lang, "share")}
          </button>
          <p className="min-w-0 truncate font-mono text-xs text-faint">{pageUrl}</p>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <article className="flex min-h-72 flex-col rounded-[1.6rem] border border-line bg-elev p-4">
            <Device art="windows" />
            <p className="mt-4 text-xs tracking-[0.16em] text-faint uppercase">Windows</p>
            <h3 className="mt-1 font-serif text-2xl tracking-tight">
              {tx({ ru: "Для компьютера", en: "For the computer", kk: "Компьютерге" })}
            </h3>
            <p className="mt-2 flex-1 text-sm text-muted">
              {here
                ? tx({
                    ru: `Вы уже в программе для Windows${window.VvvionDesktop?.version ? `, версия ${window.VvvionDesktop.version}` : ""}. Обновление приходит само.`,
                    en: `You are already in the Windows app${window.VvvionDesktop?.version ? `, version ${window.VvvionDesktop.version}` : ""}. It updates itself.`,
                    kk: `Сіз Windows қолданбасындасыз${window.VvvionDesktop?.version ? `, нұсқа ${window.VvvionDesktop.version}` : ""}. Жаңарту өзі келеді.`,
                  })
                : windows
                  ? tx({
                      ru: `Версия ${windows.version}. Установщик для Windows, 64-бит.`,
                      en: `Version ${windows.version}. A 64-bit Windows installer.`,
                      kk: `Нұсқа ${windows.version}. Windows 64-бит орнатқышы.`,
                    })
                  : tx({
                      ru: "Сборка для Windows ещё не выложена. Когда она появится, кнопка скачает последний установщик.",
                      en: "The Windows build is not published yet. When it is, the button downloads the latest installer.",
                      kk: "Windows жинағы әлі шықпады. Шыққанда түйме соңғы орнатқышты жүктейді.",
                    })}
            </p>
            {windows && !here ? (
              <a className="press mt-4 inline-flex h-11 items-center justify-center rounded-2xl bg-accent px-4 text-sm font-medium text-accent-fg" href={windows.href} download>
                {ui(lang, "windowsDownload")}
              </a>
            ) : (
              <p className="mt-4 text-xs text-faint">{here ? tx({ ru: "Отдельная загрузка не нужна", en: "No separate download", kk: "Бөлек жүктеу керек емес" }) : tx({ ru: "Скоро", en: "Soon", kk: "Жақында" })}</p>
            )}
          </article>

          <article className="flex min-h-72 flex-col rounded-[1.6rem] border border-line bg-elev p-4">
            <Device art="android" />
            <p className="mt-4 text-xs tracking-[0.16em] text-faint uppercase">Android</p>
            <h3 className="mt-1 font-serif text-2xl tracking-tight">
              {tx({ ru: "Для телефона", en: "For the phone", kk: "Телефонға" })}
            </h3>
            <p className="mt-2 flex-1 text-sm text-muted">
              {android
                ? tx({
                    ru: `Версия ${android.versionName}. Файл ставится как обычное приложение.`,
                    en: `Version ${android.versionName}. The file installs like any other app.`,
                    kk: `Нұсқа ${android.versionName}. Файл кәдімгі қолданба болып орнатылады.`,
                  })
                : tx({
                    ru: "Сборка для Android ещё не выложена.",
                    en: "The Android build is not published yet.",
                    kk: "Android жинағы әлі шықпады.",
                  })}
            </p>
            {android ? (
              <a className="press mt-4 inline-flex h-11 items-center justify-center rounded-2xl bg-accent px-4 text-sm font-medium text-accent-fg" href={android.apkUrl} download>
                {tx({ ru: "Скачать для Android", en: "Download for Android", kk: "Android үшін жүктеу" })}
              </a>
            ) : (
              <p className="mt-4 text-xs text-faint">{tx({ ru: "Скоро", en: "Soon", kk: "Жақында" })}</p>
            )}
          </article>

          <article className="flex min-h-72 flex-col rounded-[1.6rem] border border-line bg-elev p-4 md:col-span-2 xl:col-span-1">
            <Device art="web" />
            <p className="mt-4 text-xs tracking-[0.16em] text-faint uppercase">{tx({ ru: "Браузер", en: "Browser", kk: "Браузер" })}</p>
            <h3 className="mt-1 font-serif text-2xl tracking-tight">
              {tx({ ru: "На этом экране", en: "On this screen", kk: "Осы экранда" })}
            </h3>
            <p className="mt-2 flex-1 text-sm text-muted">
              {standalone
                ? tx({ ru: "Уже открыто как приложение: без полоски браузера.", en: "Already open as an app, without the browser bar.", kk: "Қолданба болып ашық: браузер жолағынсыз." })
                : ios
                  ? ui(lang, "installIos")
                  : tx({ ru: "Тот же круг можно поставить на экран отдельным окном.", en: "The same circle can sit on the screen as its own window.", kk: "Сол шеңберді экранға бөлек терезе етіп қоюға болады." })}
            </p>
            {prompt && !standalone ? (
              <button
                type="button"
                className="press mt-4 inline-flex h-11 items-center justify-center rounded-2xl border border-line px-4 text-sm font-medium"
                onClick={() => {
                  void prompt.prompt();
                  void prompt.userChoice.finally(() => setPrompt(null));
                }}
              >
                {ui(lang, "installButton")}
              </button>
            ) : (
              <p className="mt-4 text-xs text-faint">{standalone ? tx({ ru: "Уже на экране", en: "Already on the screen", kk: "Экранда" }) : tx({ ru: "Меню браузера → установить", en: "Browser menu → install", kk: "Браузер мәзірі → орнату" })}</p>
            )}
          </article>
        </div>
      </div>
    </div>
  );
}

function safeDesktop(url: string): string | null {
  try {
    const parsed = new URL(url, "https://vvvion.space");
    if (parsed.protocol !== "https:") return null;
    if (parsed.hostname !== "vvvion.space" && parsed.hostname !== "www.vvvion.space") return null;
    if (!/^\/app\/desktop\/[\w.-]+\.exe$/i.test(parsed.pathname)) return null;
    return parsed.pathname;
  } catch {
    return null;
  }
}

function safeApk(url: string): string | null {
  if (url.startsWith("/app/") && !url.includes("..") && !url.includes("\\")) return url;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    if (parsed.hostname !== "vvvion.space" && parsed.hostname !== "www.vvvion.space") return null;
    if (!parsed.pathname.startsWith("/app/") || parsed.pathname.includes("..")) return null;
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

function Device({ art }: { art: "windows" | "android" | "web" }) {
  if (art === "android") {
    return (
      <div className="grid h-28 place-items-center rounded-2xl bg-bg">
        <span className="relative grid h-20 w-11 place-items-center rounded-[0.9rem] border border-line bg-elev">
          <Smartphone className="size-5 text-accent" />
          <span className="absolute bottom-1.5 h-1 w-4 rounded-full bg-line" />
        </span>
      </div>
    );
  }
  if (art === "web") {
    return (
      <div className="grid h-28 place-items-center rounded-2xl bg-bg">
        <span className="w-28 overflow-hidden rounded-xl border border-line bg-elev">
          <span className="flex h-4 items-center gap-1 border-b border-line px-1.5">
            <i className="size-1.5 rounded-full bg-line" />
            <i className="size-1.5 rounded-full bg-line" />
            <i className="h-1.5 flex-1 rounded-full bg-subtle" />
          </span>
          <span className="grid h-12 place-items-center text-[10px] tracking-[0.2em] text-faint">VVVION</span>
        </span>
      </div>
    );
  }
  return (
    <div className="grid h-28 place-items-center rounded-2xl bg-bg">
      <span className="flex flex-col items-center">
        <span className="grid h-14 w-24 place-items-center rounded-lg border border-line bg-elev">
          <Monitor className="size-5 text-accent" />
        </span>
        <span className="h-2 w-8 rounded-b bg-line" />
        <span className="h-1 w-12 rounded-full bg-line" />
      </span>
    </div>
  );
}
