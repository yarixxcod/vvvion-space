import { MemoryPanel } from "@/components/yaronetic/memory-panel";
import { ServiceStatus } from "@/components/yaronetic/service-status";
import { diskAccessEnabled, setDiskAccess } from "@/lib/ai/disk-access";
import { readAgentPrefs, writeAgentPrefs, type AgentPrefs } from "@/lib/ai/agent-prefs";
import { useEffect, useState, type ReactNode } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { toast } from "sonner";
import { BackButton } from "@/components/yaronetic/back-button";
import { pushBackLayer } from "@/lib/app-back";
import { appCheckUpdates, appHas, appOpenSettings, appCopy, isApp, isDesktop } from "@/lib/app-bridge";
import { FACE_VARIANTS, ModelFace, type FaceVariant, type FaceMood } from "@/components/yaronetic/model-face";
import { PAPERS, type PaperId } from "@/lib/ai/paper";
import { SEARCH_ENGINES, type SearchEngine } from "@/lib/ai/search-engine";
import { Wordmark } from "@/components/yaronetic/wordmark";
import { ui } from "@/lib/i18n";
import { LangSwitch, useLang, useTx } from "@/lib/lang";
import { playSound, setSoundPack, setSoundsEnabled, soundPack, soundsEnabled, type SoundPack } from "@/lib/sounds";
import { cn } from "@/lib/utils";

export function SettingsDialog({
  open,
  chatId,
  onOpenChange,
  displayName,
  onDisplayName,
  theme,
  onTheme,
  paper,
  onPaper,
  face,
  onFace,
  searchEngine,
  onSearchEngine,
  onOpenMcp,
  prompt,
  onPrompt,
  promptLocked = false,
  promptNote,
  interestsLabel,
  onEditInterests,
  personas,
  activePersona,
  onPersona,
  onClear,
}: {
  open: boolean;
  chatId?: string | null;
  onOpenChange: (open: boolean) => void;
  displayName: string;
  onDisplayName: (value: string) => void;
  theme: "dark" | "light";
  onTheme: (theme: "dark" | "light") => void;
  paper: PaperId;
  onPaper: (paper: PaperId) => void;
  face: FaceVariant;
  onFace: (face: FaceVariant) => void;
  searchEngine: SearchEngine;
  onSearchEngine: (engine: SearchEngine) => void;
  onOpenMcp: () => void;
  prompt: string;
  onPrompt: (value: string) => void;
  promptLocked?: boolean;
  promptNote?: string;
  interestsLabel?: string;
  onEditInterests?: () => void;
  personas?: { id: string; name: string; role: string; prompt: string | null; face?: string }[];
  activePersona?: string | null;
  onPersona?: (id: string | null) => void;
  onClear: () => Promise<void> | void;
}) {
  const [draft, setDraft] = useState(prompt);
  const lang = useLang();
  const tx = useTx();
  useEffect(() => {
    if (open) setDraft(prompt);
  }, [open, prompt]);
  useEffect(() => {
    if (!open) return;
    return pushBackLayer(() => onOpenChange(false));
  }, [open, onOpenChange]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/55" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-[90] flex h-[100dvh] max-h-[100dvh] flex-col overflow-hidden rounded-t-3xl border border-line bg-elev shadow-[var(--shadow)] sm:inset-auto sm:top-1/2 sm:left-1/2 sm:h-auto sm:max-h-[min(720px,calc(100dvh-3rem))] sm:w-[min(32rem,calc(100vw-3rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl">
          <header className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3 sm:px-5">
            <div className="flex min-w-0 items-start gap-1">
              <BackButton onClick={() => onOpenChange(false)} label={ui(lang, "close")} />
              <div>
                <Wordmark />
                <Dialog.Title className="mt-1 text-base font-medium">{ui(lang, "settings")}</Dialog.Title>
                <Dialog.Description className="text-sm text-muted">{tx({ ru: "Тема, фон, поиск и MCP", en: "Theme, background, search and MCP", kk: "Тақырып, фон, іздеу және MCP" })}</Dialog.Description>
              </div>
            </div>
            <Dialog.Close
              className="press hidden size-11 items-center justify-center rounded-2xl border border-line text-muted md:inline-flex"
              aria-label={ui(lang, "close")}
            >
              <X className="size-4" />
            </Dialog.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
            <Field label={tx({ ru: "Название", en: "Name", kk: "Атауы" })}>
              <input value={displayName} onChange={(event) => onDisplayName(event.target.value)} className="field" maxLength={32} />
            </Field>
            <div className="mt-4 flex rounded-2xl border border-line p-1">
              {(["dark", "light"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={cn("press h-10 flex-1 rounded-xl text-sm", theme === mode ? "bg-subtle text-fg" : "text-muted")}
                  onClick={() => onTheme(mode)}
                >
                  {mode === "dark" ? tx({ ru: "Тёмная", en: "Dark", kk: "Қараңғы" }) : tx({ ru: "Светлая", en: "Light", kk: "Жарық" })}
                </button>
              ))}
            </div>
            <div className="mt-4">
              <LangSwitch />
            </div>
            <div className="mt-4">
              <p className="px-1 text-xs font-medium tracking-wide text-faint uppercase">{tx({ ru: "Фон чата", en: "Chat background", kk: "Чат фоны" })}</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {PAPERS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={paper === item.id}
                    className={cn(
                      "press overflow-hidden rounded-2xl border text-left",
                      paper === item.id ? "border-accent bg-subtle" : "border-line",
                    )}
                    onClick={() => onPaper(item.id)}
                  >
                    <span className="paper-swatch" data-paper={item.id === "plain" ? undefined : item.id} />
                    <span className="flex items-baseline justify-between gap-2 px-2.5 py-2">
                      <span className="text-sm">{item.label}</span>
                      <span className="text-[13px] text-muted">{item.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
              <p className="mt-1.5 px-1 text-[13px] text-muted">{tx({ ru: "Рисунок виден в чате с ИИ и в переписке круга. Светлая и тёмная тема его не ломают.", en: "The pattern shows in the AI chat and in circle messages. Light and dark themes leave it alone.", kk: "Сурет ЖИ чатында және шеңбер хатында көрінеді. Жарық пен қараңғы тақырып оны бұзбайды." })}</p>
            </div>
            <div className="mt-4">
              <p className="px-1 text-xs font-medium tracking-wide text-faint uppercase">{tx({ ru: "Лицо", en: "Face", kk: "Бет" })}</p>
              <div className="mt-2 grid grid-cols-3 gap-1.5">
                {FACE_VARIANTS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={face === item.id}
                    aria-label={tx({ ru: `Лицо «${item.label}»`, en: `Face “${item.label}”`, kk: `«${item.label}» беті` })}
                    className={cn(
                      "press flex flex-col items-center gap-1 rounded-2xl border px-1 py-2",
                      face === item.id ? "border-accent bg-subtle text-fg" : "border-line text-muted",
                    )}
                    onClick={() => onFace(item.id)}
                  >
                    <ModelFace name={item.label} variant={item.id} mood="idle" size={36} />
                    <span className="text-xs">{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <FaceEmotionPreview variant={face} />
            <div className="mt-4">
              <p className="px-1 text-xs font-medium tracking-wide text-faint uppercase">{tx({ ru: "Поиск", en: "Search", kk: "Іздеу" })}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {SEARCH_ENGINES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={searchEngine === item.id}
                    className={cn(
                      "press h-10 min-w-[7.5rem] flex-1 rounded-xl border px-2 text-sm",
                      searchEngine === item.id ? "border-accent bg-subtle text-fg" : "border-line text-muted",
                    )}
                    onClick={() => onSearchEngine(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 px-1 text-[13px] text-muted">{tx({ ru: "Глобус в поле сообщения ищет выбранным движком.", en: "The globe in the message field searches with the engine you pick.", kk: "Хабарлама жолындағы глобус таңдалған іздеуішпен іздейді." })}</p>
            </div>
            <div className="mt-4">
              <p className="px-1 text-xs font-medium tracking-wide text-faint uppercase">MCP</p>
              <button type="button" className="press mt-2 flex h-11 w-full items-center justify-between rounded-2xl border border-line px-3 text-sm" onClick={onOpenMcp}>
                <span>{tx({ ru: "Подключения по ссылке", en: "Connections by link", kk: "Сілтеме арқылы қосу" })}</span>
                <span className="text-muted">{tx({ ru: "Настроить", en: "Set up", kk: "Баптау" })}</span>
              </button>
              <p className="mt-1.5 px-1 text-[13px] text-muted">{tx({ ru: "Инструменты сервера попадут в следующий ответ чата.", en: "The server’s tools go into the next chat reply.", kk: "Сервер құралдары келесі чат жауабына кіреді." })}</p>
            </div>
            <MemoryPanel chatId={chatId} />
            <DiskAiAccess />
            <AgentAccess />
            <ServiceStatus />
            <AppTools />
            <SoundChoices />
            {onEditInterests ? (
              <div className="mt-4 rounded-2xl border border-line px-3 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm">{tx({ ru: "Вопросы на главной", en: "Questions on the home screen", kk: "Басты беттегі сұрақтар" })}</p>
                    <p className="mt-1 text-xs text-faint">{interestsLabel || ui(lang, "interestsGeneral")}</p>
                  </div>
                  <button type="button" className="press h-10 shrink-0 rounded-xl border border-line px-3 text-sm" onClick={onEditInterests}>
                    {tx({ ru: "Изменить", en: "Change", kk: "Өзгерту" })}
                  </button>
                </div>
              </div>
            ) : null}
            <p className="mt-4 rounded-xl border border-line px-3 py-2 text-sm text-muted">Роли и персонажи теперь выбираются в меню «+» рядом с моделью в чате.</p>
            <label className="mt-5 block">
              <span className="mb-1.5 block text-sm text-muted">
                {activePersona
                  ? tx({ ru: "Текст персонажа", en: "Character text", kk: "Кейіпкер мәтіні" })
                  : promptLocked
                    ? tx({ ru: "Общий текст ИИ", en: "Shared AI text", kk: "ЖИ-дің ортақ мәтіні" })
                    : tx({ ru: "Свой промпт", en: "Your prompt", kk: "Өз промптың" })}
              </span>
              <textarea
                className="field min-h-32 resize-y py-2 read-only:opacity-80"
                value={activePersona ? personas?.find((item) => item.id === activePersona)?.prompt || draft : draft}
                maxLength={8000}
                readOnly={promptLocked || Boolean(activePersona)}
                onChange={(event) => {
                  if (promptLocked || activePersona) return;
                  const next = event.target.value.slice(0, 8000);
                  setDraft(next);
                  onPrompt(next);
                }}
              />
              <p className="mt-1.5 text-[13px] text-muted">
                {activePersona
                  ? tx({ ru: "Это текст купленного персонажа. Чтобы вернуть свой, выберите «Без персонажа».", en: "This is the bought character’s text. Choose “No character” to use yours again.", kk: "Бұл сатып алынған кейіпкердің мәтіні. Өзіңіздікін қайтару үшін «Кейіпкерсіз» таңдаңыз." })
                  : promptNote || tx({ ru: "Его видит встроенный чат, если для ИИ не задан общий текст. Адреса и ключи здесь не меняются.", en: "The built-in chat sees this unless a shared text is set for the AI. Addresses and keys are not changed here.", kk: "ЖИ-ге ортақ мәтін берілмесе, ішкі чат осыны көреді. Мекенжай мен кілт мұнда өзгермейді." })}
              </p>
            </label>
            <AppAbout />
            <ClearLocal onClear={onClear} />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function AppAbout() {
  const tx = useTx();
  const [info, setInfo] = useState<{ version?: string; versionCode?: number; webView?: string; webViewMajor?: number } | null>(null);
  useEffect(() => {
    if (!isApp()) return;
    try {
      const next = window.VvvionApp?.info?.();
      if (next && typeof next === "object") setInfo(next);
    } catch {
      /* the shell has gone */
    }
  }, []);
  if (isDesktop()) {
    const version = window.VvvionDesktop?.version || "—";
    return (
      <div className="mt-8 border-t border-line pt-4">
        <p className="text-sm">{tx({ ru: "О приложении", en: "About the app", kk: "Қолданба туралы" })}</p>
        <p className="mt-1 text-sm text-muted">{version}</p>
        <p className="mt-0.5 text-[13px] text-faint">Windows</p>
      </div>
    );
  }
  if (!isApp()) return null;
  const version = info?.version || "—";
  const code = info?.versionCode ? ` · ${info.versionCode}` : "";
  const web = info?.webView ? `WebView ${info.webView}${info.webViewMajor ? ` (${info.webViewMajor})` : ""}` : "";
  return (
    <div className="mt-8 border-t border-line pt-4">
      <p className="text-sm">{tx({ ru: "О приложении", en: "About the app", kk: "Қолданба туралы" })}</p>
      <p className="mt-1 text-sm text-muted">
        {version}
        {code}
      </p>
      {web ? <p className="mt-0.5 text-[13px] text-faint">{web}</p> : null}
      <button
        type="button"
        className="press mt-3 h-11 rounded-2xl border border-line px-3 text-sm"
        onClick={() => {
          let payload: unknown = info;
          try {
            payload = window.VvvionApp?.debugLog?.() ?? info;
          } catch {
            payload = info;
          }
          const text = JSON.stringify(payload ?? {}, null, 2);
          void appCopy(text).then((ok) => {
            if (ok) toast(tx({ ru: "Лог скопирован", en: "Log copied", kk: "Журнал көшірілді" }));
          });
        }}
      >
        {tx({ ru: "Скопировать лог", en: "Copy log", kk: "Журналды көшіру" })}
      </button>
    </div>
  );
}

function AppTools() {
  const tx = useTx();
  const [settings, setSettings] = useState(false);
  const [updates, setUpdates] = useState(false);
  useEffect(() => {
    if (!isApp()) return;
    setSettings(appHas("appSettings"));
    setUpdates(appHas("checkUpdates"));
  }, []);
  if (!settings && !updates) return null;
  return (
    <div className="mt-4 rounded-2xl border border-line px-3 py-3">
      <p className="text-sm">{tx({ ru: "Приложение", en: "App", kk: "Қолданба" })}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {settings ? (
          <button type="button" className="press min-h-10 rounded-xl border border-line px-3 text-sm" onClick={() => appOpenSettings()}>
            {tx({ ru: "Настройки приложения", en: "App settings", kk: "Қолданба баптауы" })}
          </button>
        ) : null}
        {updates ? (
          <button type="button" className="press min-h-10 rounded-xl border border-line px-3 text-sm" onClick={() => appCheckUpdates()}>
            {tx({ ru: "Проверить обновления", en: "Check for updates", kk: "Жаңартуды тексеру" })}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function SoundChoices() {
  const tx = useTx();
  const [on, setOn] = useState(true);
  const [pack, setPack] = useState<SoundPack>("soft");
  useEffect(() => {
    const pull = () => {
      setOn(soundsEnabled());
      setPack(soundPack());
    };
    pull();
    window.addEventListener("vvvion-sounds", pull);
    return () => window.removeEventListener("vvvion-sounds", pull);
  }, []);
  const choices: { id: SoundPack; label: string }[] = [
    { id: "soft", label: tx({ ru: "Мягкий", en: "Soft", kk: "Жұмсақ" }) },
    { id: "glass", label: tx({ ru: "Стекло", en: "Glass", kk: "Шыны" }) },
    { id: "wood", label: tx({ ru: "Дерево", en: "Wood", kk: "Ағаш" }) },
    { id: "pulse", label: tx({ ru: "Пульс", en: "Pulse", kk: "Пульс" }) },
    { id: "drop", label: tx({ ru: "Капля", en: "Drop", kk: "Тамшы" }) },
  ];
  return (
    <div className="mt-4 rounded-2xl border border-line px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm">{tx({ ru: "Звук уведомлений", en: "Notification sound", kk: "Хабарлама дыбысы" })}</p>
          <p className="mt-1 text-[13px] text-muted">
            {tx({
              ru: "Пять тембров. Нажатие проигрывает выбранный.",
              en: "Five tones. A tap plays the one you pick.",
              kk: "Бес тембр. Басқанда таңдалғаны ойналады.",
            })}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={tx({ ru: "Звук уведомлений", en: "Notification sound", kk: "Хабарлама дыбысы" })}
          className={on ? "relative h-8 w-14 shrink-0 rounded-full bg-accent" : "relative h-8 w-14 shrink-0 rounded-full border border-line-strong bg-transparent"}
          onClick={() => setSoundsEnabled(!on)}
        >
          <span className={on ? "absolute top-1 left-7 size-6 rounded-full bg-accent-fg" : "absolute top-1 left-1 size-6 rounded-full bg-faint"} />
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5" role="radiogroup" aria-label={tx({ ru: "Тембр", en: "Tone", kk: "Тембр" })}>
        {choices.map((item) => (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={pack === item.id}
            className={pack === item.id ? "press h-9 rounded-xl bg-accent px-3 text-sm font-medium text-accent-fg" : "press h-9 rounded-xl border border-line px-3 text-sm"}
            onClick={() => {
              setSoundsEnabled(true);
              setSoundPack(item.id);
              setPack(item.id);
              setOn(true);
              playSound("notice", true);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ClearLocal({ onClear }: { onClear: () => Promise<void> | void }) {
  const tx = useTx();
  const lang = useLang();
  return (
    <div className="mt-8 border-t border-line pt-4">
      <AlertDialog.Root>
        <AlertDialog.Trigger className="press h-11 rounded-2xl border border-line px-3 text-sm text-danger">
          {tx({ ru: "Очистить локальные данные", en: "Clear local data", kk: "Жергілікті деректі тазалау" })}
        </AlertDialog.Trigger>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-[60] bg-black/50" />
          <AlertDialog.Content className="fixed top-1/2 left-1/2 z-[60] w-[min(100%-2rem,24rem)] -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-line bg-elev p-5">
            <AlertDialog.Title className="text-lg font-medium">{tx({ ru: "Стереть всё?", en: "Erase everything?", kk: "Бәрін өшіру керек пе?" })}</AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-sm text-muted">
              {tx({ ru: "Диалоги и настройки исчезнут из этого браузера. Общая полка и история аккаунта останутся.", en: "Chats and settings will leave this browser. The shared shelf and the account history stay.", kk: "Диалог пен баптау осы браузерден кетеді. Ортақ сөре мен аккаунт тарихы қалады." })}
            </AlertDialog.Description>
            <div className="mt-5 flex justify-end gap-2">
              <AlertDialog.Cancel className="press h-11 rounded-2xl border border-line px-4 text-sm">{ui(lang, "cancel")}</AlertDialog.Cancel>
              <AlertDialog.Action className="press h-11 rounded-2xl bg-danger px-4 text-sm font-medium text-bg" onClick={() => void onClear()}>
                {tx({ ru: "Очистить", en: "Clear", kk: "Тазалау" })}
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm text-muted">{label}</span>
      {children}
    </label>
  );
}

function DiskAiAccess() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const sync = () => setEnabled(diskAccessEnabled());
    sync();
    window.addEventListener("vv-agent", sync);
    return () => window.removeEventListener("vv-agent", sync);
  }, []);
  return <section className="mt-4 rounded-2xl border border-line p-3">
    <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm font-medium">
      Мой диск в ИИ-чате
      <input type="checkbox" checked={enabled} onChange={event => { setEnabled(event.target.checked); setDiskAccess(event.target.checked); const next = readAgentPrefs(); writeAgentPrefs({ ...next, files: event.target.checked }); window.dispatchEvent(new Event("vv-agent")); }} className="size-5 accent-[var(--accent)]" />
    </label>
    <p className="mt-1 text-xs text-muted">Разрешить выбранной ИИ-модели по вашему запросу искать личные файлы и музыку, читать тексты и изображения, создавать папки и текстовые файлы на Диске и Мегадиске, сохранять правки новыми версиями. Содержимое передаётся активному провайдеру выбранной модели, а при его ошибке — резервному из её настроек. Существующие файлы не удаляются и не перезаписываются.</p>
  </section>;
}

function AgentAccess() {
  const tx = useTx();
  const [prefs, setPrefs] = useState<AgentPrefs | null>(null);
  useEffect(() => {
    const sync = () => setPrefs(readAgentPrefs());
    sync();
    window.addEventListener("vv-agent", sync);
    return () => window.removeEventListener("vv-agent", sync);
  }, []);
  if (!prefs) return null;
  const save = (next: AgentPrefs) => {
    setPrefs(next);
    writeAgentPrefs(next);
    if (next.files !== diskAccessEnabled()) setDiskAccess(next.files);
    window.dispatchEvent(new Event("vv-agent"));
  };
  const row = (label: string, hint: string, checked: boolean, onChange: (value: boolean) => void) => (
    <label className="mt-3 flex min-h-11 cursor-pointer items-start justify-between gap-3 text-sm">
      <span><span className="font-medium">{label}</span><span className="mt-0.5 block text-xs text-muted">{hint}</span></span>
      <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} className="mt-0.5 size-5 accent-[var(--accent)]" />
    </label>
  );
  return <section className="mt-4 rounded-2xl border border-line p-3">
    <p className="text-sm font-medium">{tx({ ru: "ИИ-агент", en: "AI agent", kk: "ЖИ агент" })}</p>
    <p className="mt-1 text-xs text-muted">{tx({ ru: "Модель сама ищет, рисует и, если включён диск, сохраняет проект. Ничего не удаляет.", en: "The model can search, draw, and save a project when Disk is on. It never deletes.", kk: "Модель өзі іздейді, салады және диск қосулы болса жобаны сақтайды. Ештеңені өшірмейді." })}</p>
    <label className="mt-3 flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm font-medium">
      {tx({ ru: "Делать самой", en: "Act on its own", kk: "Өзі істесін" })}
      <input type="checkbox" checked={prefs.autonomy === "auto"} onChange={event => save({ ...prefs, autonomy: event.target.checked ? "auto" : "ask" })} className="size-5 accent-[var(--accent)]" />
    </label>
    {row(tx({ ru: "Поиск в интернете", en: "Web search", kk: "Интернеттен іздеу" }), tx({ ru: "Модель сама решает, когда искать и открывать страницы.", en: "The model decides when to search and open pages.", kk: "Модель қашан іздеп, бет ашатынын өзі шешеді." }), prefs.web, value => save({ ...prefs, web: value }))}
    {row(tx({ ru: "Рисовать картинки", en: "Draw images", kk: "Сурет салу" }), tx({ ru: "До двух картинок за ответ, только в вашем аккаунте.", en: "Up to two pictures per reply, only in your account.", kk: "Бір жауапта екі суретке дейін, тек аккаунтыңызда." }), prefs.image, value => save({ ...prefs, image: value }))}
    {row(tx({ ru: "Сохранять на диск", en: "Save to Disk", kk: "Дискке сақтау" }), tx({ ru: "То же согласие, что «Мой диск в ИИ-чате».", en: "Same consent as “My Disk in AI chat”.", kk: "«ЖИ чаттағы менің дискім» деген келісім." }), prefs.files, value => save({ ...prefs, files: value }))}
  </section>;
}

function FaceEmotionPreview({ variant }: { variant: FaceVariant }) {
  const [mood, setMood] = useState<FaceMood>("idle");
  const moods: [FaceMood, string][] = [["idle", "Спокойствие"], ["think", "Размышление"], ["talk", "Речь"], ["happy", "Радость"], ["oops", "Ошибка"], ["look", "Интерес"], ["wonder", "Удивление"], ["draw", "Рисование"], ["seek", "Поиск"]];
  return <section className="mt-3 rounded-2xl border border-line bg-bg p-3" aria-label="Эмоции лица ИИ">
    <div className="flex items-center gap-4"><ModelFace name="VVVion" variant={variant} mood={mood} size={80} /><div><p className="text-sm font-medium">{moods.find(item => item[0] === mood)?.[1]}</p><p className="mt-1 text-xs leading-relaxed text-muted">Во время общения выражение меняется по состоянию ответа. Здесь можно примерить эмоции.</p></div></div>
    <div className="mt-3 flex gap-2 overflow-x-auto pb-1">{moods.map(([id, label]) => <button type="button" key={id} aria-pressed={mood === id} className={`press min-h-10 shrink-0 rounded-full border px-3 text-xs ${mood === id ? "border-accent bg-subtle" : "border-line text-muted"}`} onClick={() => setMood(id)}>{label}</button>)}</div>
  </section>;
}
