import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "@tanstack/react-router";
import { Languages, Moon, MoreHorizontal, PanelLeft, Plus, Settings, Share2, Sun, X } from "lucide-react";
import { BackButton } from "@/components/yaronetic/back-button";
import { toast, Toaster } from "sonner";
import { AuthForm } from "@/components/yaronetic/auth-form";
import { Composer } from "@/components/yaronetic/composer";
import { InterestSurvey } from "@/components/yaronetic/interests";
import { Mark } from "@/components/yaronetic/mark";
import { SettingsDialog } from "@/components/yaronetic/settings";
import { McpDialog } from "@/components/yaronetic/mcp-dialog";
import { ModelMenu } from "@/components/yaronetic/model-menu";
import { MusicDock } from "@/components/yaronetic/music-dock";
import { Sidebar } from "@/components/yaronetic/sidebar";
import { copyText } from "@/components/yaronetic/markdown";
import { useStudio } from "@/components/yaronetic/use-studio";
import { Wordmark } from "@/components/yaronetic/wordmark";
import { useCircleUnread } from "@/components/yaronetic/messenger";
import { GUEST_QUESTION_LIMIT } from "@/lib/ai/guest-limit";
import { personalSuggestions, topicLabel } from "@/lib/ai/interest-topics";
import { suggestionsFor } from "@/lib/ai/defaults";
import { getInterests, type InterestProfile } from "@/lib/ai/interests";
import { publishChat } from "@/lib/ai/share";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { installClickFallback } from "@/lib/click-fallback";
import { SignalPing } from "@/components/yaronetic/signal";
import { playSound } from "@/lib/sounds";
import { fill, ui } from "@/lib/i18n";
import { LangSwitch, useLang } from "@/lib/lang";
import { previewPathPrefix } from "@/lib/preview-path-prefix";
import { type CircleTab } from "@/lib/places";
import { getAccess } from "@/lib/social/admin";
import { claimReferral } from "@/lib/social/bank";
import { getPersonaShop, setActivePersona, type PersonaShop } from "@/lib/social/personas";
import { writeLivePersona } from "@/lib/social/persona-live";
import { useReleaseFlag } from "@/lib/release";
import { gestureSurface, pushBackLayer } from "@/lib/app-back";
import { circleExitDelta } from "@/lib/circle-history";
import { shareOut } from "@/lib/app-bridge";
import { modLabel, useChatShortcuts } from "@/lib/chat-shortcuts";
import { haptic } from "@/lib/haptic";

const Transcript = lazy(() => import("@/components/yaronetic/transcript").then((mod) => ({ default: mod.Transcript })));
const Circle = lazy(() => import("@/components/yaronetic/circle").then((mod) => ({ default: mod.Circle })));

export function App({
  initialModels,
  place,
  openChat,
  openRoom,
  startNew,
}: {
  initialModels?: { name: string; displayName: string; icon?: string }[];
  place?: CircleTab;
  openChat?: string;
  openRoom?: string;
  startNew?: boolean;
}) {
  const navigate = useNavigate();
  const lang = useLang();
  const studio = useStudio(initialModels);
  const [sidebar, setSidebar] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [settings, setSettings] = useState(false);
  const [headerMenu, setHeaderMenu] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [signIn, setSignIn] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [banned, setBanned] = useState(false);
  const [interests, setInterests] = useState<InterestProfile | null>(null);
  const [askInterests, setAskInterests] = useState(false);
  const [personaShop, setPersonaShop] = useState<PersonaShop | null>(null);
  const { user, isPending } = useCurrentUserState();
  const unread = useCircleUnread(Boolean(user) && !isPending);
  const release = useReleaseFlag();
  const empty = studio.messages.length === 0;
  const builtinLocked = banned && studio.activeProvider.kind === "builtin";
  const activeChat = studio.chats.find((chat) => chat.id === studio.activeChatId);
  const streamingHere = studio.streaming && studio.streamingChatId === studio.activeChatId;
  const personal = Boolean(user && interests && interests.topics.length > 0);
  const suggestions = personal && interests ? personalSuggestions(interests.topics, interests.tone) : suggestionsFor(lang);
  const builtin = studio.providers.find((provider) => provider.kind === "builtin");
  const catalogPrompt = (builtin ? studio.modelPrompts[builtin.model] || "" : "").trim();
  const catalogName = builtin ? studio.modelLabels[builtin.model] || builtin.model : "";
  const circle = Boolean(place);
  const openedChat = useRef<string | null>(null);
  const startedNew = useRef(false);

  useEffect(() => {
    if (!startNew || !studio.ready || startedNew.current) return;
    startedNew.current = true;
    studio.newChat();
    void navigate({ to: "/", search: lang !== "ru" ? { lang } : {}, replace: true });
  }, [startNew, studio.ready, studio.newChat, navigate, lang]);

  useEffect(() => {
    if (!openChat || !studio.ready) return;
    if (!studio.chats.some((chat) => chat.id === openChat)) return;
    if (openedChat.current === openChat && studio.activeChatId === openChat) return;
    openedChat.current = openChat;
    studio.selectChat(openChat);
  }, [openChat, studio.ready, studio.chats, studio.activeChatId, studio.selectChat]);

  const circleBtn = useRef<HTMLButtonElement>(null);
  const chatShell = useRef<HTMLDivElement>(null);
  const circleViaUi = useRef(false);

  function openPlace(tab: CircleTab) {
    circleViaUi.current = true;
    void navigate({ to: "/", search: { place: tab, ...(lang !== "ru" ? { lang } : {}) }, replace: Boolean(place) });
  }

  function closeCircle() {
    const steps = circleExitDelta();
    if (steps > 0) window.history.go(-steps);
    else void navigate({ to: "/", search: lang !== "ru" ? { lang } : {}, replace: true });
    window.setTimeout(() => circleBtn.current?.focus(), 0);
  }

  useEffect(() => {
    document.documentElement.classList.toggle("circle-open", Boolean(circle));
    if (chatShell.current) chatShell.current.inert = Boolean(circle);
    if (!circle) return;
    const off = pushBackLayer(() => {
      if ((window.history.state as { vvCircle?: number } | null)?.vvCircle) window.history.back();
      else void navigate({ to: "/", search: lang !== "ru" ? { lang } : {}, replace: true });
    });
    if (!circleViaUi.current && !(window.history.state as { vvCircle?: number } | null)?.vvCircle) {
      const current = window.location.pathname + window.location.search;
      const url = new URL(window.location.href);
      url.searchParams.delete("place");
      url.searchParams.delete("room");
      const back = url.pathname + url.search;
      if (back !== current) {
        window.history.replaceState({ vvChat: 1 }, "", back);
        window.history.pushState({ vvCircle: 1 }, "", current);
      }
    } else {
      const prev = typeof window.history.state === "object" && window.history.state ? window.history.state : {};
      window.history.replaceState({ ...prev, vvCircle: 1 }, "");
    }
    circleViaUi.current = false;
    return () => {
      document.documentElement.classList.remove("circle-open");
      if (chatShell.current) chatShell.current.inert = false;
      off();
    };
  }, [circle, place, navigate, lang]);

  useEffect(() => {
    if (!user) {
      setPersonaShop(null);
      writeLivePersona(null);
      return;
    }
    let cancelled = false;
    void getPersonaShop()
      .then((shop) => {
        if (cancelled) return;
        setPersonaShop(shop);
        writeLivePersona(shop.activeId);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [user, settings]);

  useEffect(() => {
    if (!user) {
      setInterests(null);
      setAskInterests(false);
      return;
    }
    let cancelled = false;
    void getInterests()
      .then((profile) => {
        if (cancelled) return;
        setInterests(profile);
        if (!profile.known) setAskInterests(true);
      })
      .catch(() => {
        if (!cancelled) setInterests({ known: true, topics: [], tone: "clear", skipped: true });
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!user || isPending) return;
    let code = "";
    try {
      code = localStorage.getItem("vvvion.ref") || "";
    } catch {
      return;
    }
    if (!/^[a-z0-9]{8}$/.test(code)) return;
    let cancelled = false;
    void claimReferral({ data: code })
      .then((result) => {
        if (cancelled) return;
        if (result.status !== "empty") {
          try {
            localStorage.removeItem("vvvion.ref");
          } catch {
            /* private mode */
          }
        }
        if (result.status === "rewarded") toast("Приглашение принято: пригласившему начислено 1000 вублей");
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [user, isPending]);

  async function shareDialog() {
    if (sharing || streamingHere) return;
    if (!user) {
      toast("Поделиться можно после входа — ссылка хранится в аккаунте");
      return;
    }
    if (!studio.activeChatId || studio.messages.length === 0) {
      toast("В диалоге пока нечего отправлять");
      return;
    }
    setSharing(true);
    try {
      const { id } = await publishChat({
        data: { title: activeChat?.title || "Диалог", messages: studio.messages },
      });
      const prefix = previewPathPrefix(window.location.hostname, window.location.pathname) ?? "";
      const url = `${window.location.origin}${prefix}/s/${id}`;
      setShareUrl(url);
      try {
        await navigator.clipboard.writeText(url);
        toast("Ссылка скопирована");
      } catch {
        toast("Ссылка готова — скопируйте её");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось создать ссылку");
    } finally {
      setSharing(false);
    }
  }

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const apply = () => {
      const matches = media.matches;
      setNarrow(matches);
      if (matches) {
        setSidebar(false);
        return;
      }
      let shown = true;
      try {
        shown = localStorage.getItem("vv.sidebar") !== "0";
      } catch {
        shown = true;
      }
      setSidebar(shown);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebar((value) => {
      const next = !value;
      if (!window.matchMedia("(max-width: 1023px)").matches) {
        try {
          localStorage.setItem("vv.sidebar", next ? "1" : "0");
        } catch {
          /* private mode */
        }
      }
      return next;
    });
  }, []);

  const focusSearch = useCallback(() => {
    if (window.matchMedia("(max-width: 1023px)").matches) setSidebar(true);
    else {
      setSidebar(true);
      try {
        localStorage.setItem("vv.sidebar", "1");
      } catch {
        /* private mode */
      }
    }
    window.setTimeout(() => document.getElementById("history-search")?.focus(), 40);
  }, []);

  const copyLast = useCallback(() => {
    const last = [...studio.messages].reverse().find((item) => item.role === "assistant" && item.content);
    if (last?.content) void copyText(last.content);
  }, [studio.messages]);

  const shortcutApi = useMemo(
    () => ({
      stop: studio.stop,
      streaming: streamingHere,
      newChat: () => studio.newChat(),
      toggleSidebar,
      focusSearch,
      editLast: () => window.dispatchEvent(new Event("vvvion-edit-last")),
      copyLast,
      showKeys: () => setKeysOpen(true),
    }),
    [studio.stop, studio.newChat, streamingHere, toggleSidebar, focusSearch, copyLast],
  );
  useChatShortcuts(shortcutApi);

  useEffect(() => {
    if (circle || !window.matchMedia("(pointer: fine)").matches) return;
    document.getElementById("composer")?.focus();
  }, [studio.activeChatId, circle]);

  useEffect(() => {
    if (!narrow || sidebar) return;
    let x0 = 0;
    let y0 = 0;
    let t0 = 0;
    let active = false;
    let locked = false;
    const ignore = ".scroll-x,pre,.code-frame,.katex-display,input,textarea,[data-no-swipe]";
    const down = (event: PointerEvent) => {
      if (!gestureSurface() || event.pointerType === "mouse" || event.clientX < 24) return;
      if ((event.target as Element | null)?.closest(ignore)) return;
      x0 = event.clientX;
      y0 = event.clientY;
      t0 = performance.now();
      active = true;
      locked = false;
    };
    const move = (event: PointerEvent) => {
      if (!active) return;
      const dx = event.clientX - x0;
      const dy = event.clientY - y0;
      if (!locked && Math.abs(dy) > 24 && Math.abs(dy) > Math.abs(dx)) active = false;
      else if (Math.abs(dx) > 12 && Math.abs(dx) > 1.5 * Math.abs(dy)) locked = true;
    };
    const up = (event: PointerEvent) => {
      if (!active || !locked) {
        active = false;
        return;
      }
      active = false;
      const dx = event.clientX - x0;
      const velocity = dx / Math.max(1, performance.now() - t0);
      if (dx > 120 || velocity > 0.5) {
        haptic("light");
        setSidebar(true);
      }
    };
    const cancel = () => {
      active = false;
    };
    window.addEventListener("pointerdown", down, { passive: true });
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerup", up, { passive: true });
    window.addEventListener("pointercancel", cancel, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
  }, [narrow, sidebar]);

  useEffect(() => installClickFallback(), []);

  useEffect(() => {
    const release = () => {
      if (document.body.style.pointerEvents === "none" && !document.querySelector("[role='dialog'][data-state='open'], [role='alertdialog'][data-state='open']")) {
        document.body.style.pointerEvents = "";
      }
    };
    release();
    const observer = new MutationObserver(release);
    observer.observe(document.body, { attributes: true, attributeFilter: ["style"], childList: true, subtree: true });
    const timer = window.setInterval(release, 1000);
    return () => {
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (isPending || !user) {
      setBanned(false);
      return;
    }
    let cancelled = false;
    const pull = () => {
      void getAccess()
        .then((access) => {
          if (!cancelled) setBanned(access.banned);
        })
        .catch(() => undefined);
    };
    pull();
    window.addEventListener("focus", pull);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", pull);
    };
  }, [user, isPending]);

  return (
    <div className="app-root relative flex h-dvh overflow-hidden">
      <div ref={chatShell} className="flex min-w-0 flex-1">
      <div className="ambient" aria-hidden="true">
        <div className="orb orb-a" />
        <div className="orb orb-b" />
        <div className="grain" />
      </div>
      <Sidebar
        open={sidebar}
        overlay={narrow}
        onClose={() => setSidebar(false)}
        chats={studio.chats}
        activeId={studio.activeChatId}
        onSelect={studio.selectChat}
        onNew={studio.newChat}
        onRename={(id, title) => void studio.renameChat(id, title)}
        onDelete={(id) => void studio.removeChat(id)}
        onDeleteAll={() => void studio.removeAllChats()}
      />
      <div className="relative z-20 flex min-w-0 flex-1 flex-col">
        <header className="relative z-[70] flex min-h-14 items-center gap-1.5 px-2 sm:gap-2 sm:px-4">
          <button
            type="button"
            className="press inline-flex size-11 shrink-0 items-center justify-center rounded-2xl border border-line bg-elev/80 text-muted"
            aria-label={sidebar ? ui(lang, "hideHistory") : ui(lang, "showHistory")}
            title={`${sidebar ? ui(lang, "hideHistory") : ui(lang, "showHistory")} (${modLabel()}+B)`}
            onClick={toggleSidebar}
          >
            <PanelLeft className="size-4" />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <p className="brand-v hidden shrink-0 lg:block" aria-label="VVVION SPACE">
              V
            </p>
            <p className="min-w-0 flex-1 truncate text-base font-medium">
              {activeChat?.title ?? ui(lang, "newDialog")}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <span className="circle-glow">
              <button
                ref={circleBtn}
                type="button"
                className="press inline-flex h-11 items-center gap-1.5 rounded-2xl border px-3 text-sm"
                onClick={() => (circle ? closeCircle() : openPlace("chat"))}
              >
                {ui(lang, "circle")}
                {unread > 0 ? (
                  <span className="grid min-w-5 place-items-center rounded-full bg-accent px-1 text-xs font-medium tabular-nums text-accent-fg">
                    {unread > 9 ? "9+" : unread}
                  </span>
                ) : null}
              </button>
              {release && unread === 0 ? (
                <a
                  href={lang === "ru" ? "/about#journal" : `/about?lang=${lang}#journal`}
                  className="absolute -top-0.5 -right-0.5 z-10 size-2 rounded-full bg-accent"
                  aria-label={ui(lang, "unreadUpdate")}
                />
              ) : null}
            </span>
            <button
              type="button"
              className="press inline-flex size-11 items-center justify-center rounded-2xl border border-line bg-elev text-muted disabled:opacity-40"
              onClick={() => studio.newChat()}
              aria-label={ui(lang, "newChat")}
              title={`${ui(lang, "newChat")} (${modLabel()}+Shift+O)`}
            >
              <Plus className="size-4" />
            </button>
            <button
              type="button"
              className="press hidden size-11 shrink-0 items-center justify-center rounded-2xl border border-line bg-elev text-muted disabled:opacity-40 lg:inline-flex"
              aria-label={ui(lang, "shareDialog")}
              disabled={studio.messages.length === 0 || streamingHere || sharing}
              onClick={() => void shareDialog()}
            >
              <Share2 className="size-4" />
            </button>
            <button
              type="button"
              className="press hidden size-11 items-center justify-center rounded-2xl border border-line bg-elev text-muted lg:inline-flex"
              aria-label={studio.theme === "dark" ? ui(lang, "lightTheme") : ui(lang, "darkTheme")}
              onClick={() => studio.setTheme(studio.theme === "dark" ? "light" : "dark")}
            >
              {studio.theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
            <span className="hidden lg:inline-flex">
              <LangSwitch compact />
            </span>
            <button
              type="button"
              className="press hidden size-11 items-center justify-center rounded-2xl border border-line bg-elev text-muted lg:inline-flex"
              aria-label={ui(lang, "settings")}
              onClick={() => setSettings(true)}
            >
              <Settings className="size-4" />
            </button>
            <button
              type="button"
              className="press inline-flex size-11 items-center justify-center rounded-2xl border border-line bg-elev text-muted lg:hidden"
              aria-label="Ещё"
              aria-expanded={headerMenu}
              onClick={() => setHeaderMenu(true)}
            >
              <MoreHorizontal className="size-4" />
            </button>
          </div>
        </header>
        <main
          aria-label={ui(lang, "chat")}
          className="chat-paper flex min-h-0 flex-1 flex-col"
          onClick={(event) => {
            const target = event.target;
            if (!(target instanceof Element) || target.closest("button, a, input, textarea, select, label, form")) return;
            document.getElementById("composer")?.focus();
          }}
        >
          {empty ? (
            <EmptyChat
              disabled={builtinLocked || streamingHere}
              suggestions={user && !interests ? [] : suggestions}
              personal={personal}
              onPick={(prompt) => void studio.send(prompt)}
            />
          ) : (
            <Suspense fallback={<div className="min-h-0 flex-1" />}>
              <Transcript
                messages={studio.messages}
                streaming={streamingHere}
                continuing={studio.continuingId === studio.activeChatId}
                face={studio.face}
                labels={{
                  ...studio.modelLabels,
                  ...Object.fromEntries(studio.imageModels.map((item) => [item.name, item.displayName])),
                }}
                reasoningOn={studio.reasoning}
                assistantName={studio.displayName}
                onRegenerate={studio.regenerate}
                onResend={studio.resendFrom}
                onDelete={studio.dropMessage}
                onAsk={(text) =>
                  void studio.send(text, {
                    web: studio.webMode,
                    ask: studio.askMode,
                  })
                }
                onQuote={(text) => {
                  const quote = `> ${text}\n\n`;
                  studio.setDraft(studio.draft.trim() ? `${quote}${studio.draft}` : quote);
                  window.setTimeout(() => {
                    const field = document.getElementById("composer");
                    field?.focus();
                    field?.scrollIntoView({ block: "nearest" });
                  }, 30);
                }}
              />
            </Suspense>
          )}
          <div className="composer-dock relative z-10 border-t border-line bg-bg px-3 pt-2 sm:px-4">
            <div className="mx-auto w-full max-w-3xl">
              {builtinLocked ? (
                <p className="mb-2 rounded-2xl border border-line bg-elev px-3 py-2 text-sm text-danger">
                  {ui(lang, "bannedBuiltin")}
                </p>
              ) : null}
              {!user && !isPending && studio.guestLeft !== null && !studio.needAccount ? (
                <p className="guest-strip mb-2 flex items-center gap-2 px-1 text-xs text-faint">
                  <span className="truncate">{fill(ui(lang, "guestLeft"), { left: studio.guestLeft, limit: GUEST_QUESTION_LIMIT })}</span>
                  <button type="button" className="shrink-0 text-accent" onClick={() => setSignIn(true)}>{ui(lang, "signIn")}</button>
                </p>
              ) : null}
              <Composer
                value={studio.draft}
                onChange={studio.setDraft}
                streaming={streamingHere}
                disabled={builtinLocked}
                imageMode={studio.imageMode}
                webMode={studio.webMode}
                onImageMode={studio.setImageMode}
                onWebMode={studio.setWebMode}
                files={studio.attachments}
                onFiles={studio.setAttachments}
                placeholder={
                  builtinLocked ? ui(lang, "chatClosed") : studio.imageMode ? ui(lang, "describeImage") : studio.webMode ? ui(lang, "askWeb") : ui(lang, "writeMessage")
                }
                onStop={studio.stop}
                reasoning={studio.reasoning}
                onReasoning={studio.setReasoning}
                ask={studio.askMode}
                onAsk={studio.setAskMode}
                modelSlot={<MobileModel studio={studio} plain />}
                endSlot={
                  <span className="flex min-w-0 items-center gap-1">
                    <MobileModel studio={studio} fieldId="model" />
                    <SignalPing
                      kind={studio.activeProvider.kind}
                      baseUrl={studio.activeProvider.baseUrl}
                      model={studio.activeProvider.model}
                      image={studio.imageMode}
                      imageModel={
                        studio.imageMode && studio.activeProvider.kind === "builtin"
                          ? studio.activeProvider.imageModel || studio.imageModels[0]?.name || "grok-imagine-image"
                          : studio.activeProvider.imageModel || ""
                      }
                    />
                  </span>
                }
                onSend={() => void studio.send(studio.draft, { image: studio.imageMode, web: studio.webMode, ask: studio.askMode })}
                captureFiles={!circle}
              />
            </div>
          </div>
        </main>
      </div>
      </div>
      {studio.needAccount && !(circle && !user) ? <AccountGate /> : null}
      {circle && !isPending && !user ? (
        <SignInSheet onClose={closeCircle} />
      ) : circle ? (
        <>
          <button type="button" className="fixed inset-0 z-30 bg-black/45 xl:hidden" aria-label={ui(lang, "closeCircle")} onClick={closeCircle} />
          <aside role="dialog" aria-modal="true" aria-label={ui(lang, "circle")} data-circle className="fixed inset-0 z-40 flex w-full flex-col bg-elev md:inset-y-0 md:right-0 md:left-auto md:w-[min(100%,52rem)] md:border-l md:border-line md:shadow-[var(--shadow)] xl:inset-0 xl:w-full xl:border-0">
            <Suspense fallback={<div className="grid flex-1 place-items-center"><span className="vv-loader" /></div>}>
              <Circle onClose={closeCircle} tab={place} onTab={openPlace} theme={studio.theme} onTheme={studio.setTheme} roomId={openRoom} />
            </Suspense>
          </aside>
        </>
      ) : null}
      <SettingsDialog
        open={settings}
        onOpenChange={setSettings}
        displayName={studio.displayName}
        onDisplayName={studio.setDisplayName}
        theme={studio.theme}
        onTheme={studio.setTheme}
        paper={studio.paper}
        onPaper={studio.setPaper}
        face={studio.face}
        onFace={studio.setFace}
        searchEngine={studio.searchEngine}
        onSearchEngine={studio.setSearchEngine}
        onOpenMcp={() => {
          setSettings(false);
          setMcpOpen(true);
        }}
        prompt={catalogPrompt || builtin?.systemPrompt || ""}
        promptLocked={Boolean(catalogPrompt)}
        promptNote={
          catalogPrompt
            ? fill(ui(lang, "promptLocked"), { name: catalogName || ui(lang, "thisModel") })
            : undefined
        }
        onPrompt={(value) => {
          if (!builtin || catalogPrompt) return;
          studio.updateProvider(builtin.id, { systemPrompt: value });
        }}
        interestsLabel={interests?.topics.length ? interests.topics.map(topicLabel).filter(Boolean).join(", ") : user ? ui(lang, "interestsGeneral") : undefined}
        onEditInterests={
          user
            ? () => {
                setSettings(false);
                setAskInterests(true);
              }
            : undefined
        }
        personas={personaShop?.items.filter((item) => item.owned || item.viaPremium)}
        activePersona={personaShop?.activeId}
        onPersona={
          user
            ? (id) => {
                void setActivePersona({ data: id ?? "" })
                  .then((shop) => {
                    setPersonaShop(shop);
                    writeLivePersona(shop.activeId);
                  })
                  .catch((err) => toast.error(err instanceof Error ? err.message : ui(lang, "personaFailed")));
              }
            : undefined
        }
        onClear={studio.clearLocal}
      />
      <McpDialog
        open={mcpOpen}
        onClose={() => setMcpOpen(false)}
        onBack={() => {
          setMcpOpen(false);
          setSettings(true);
        }}
      />
      <InterestSurvey
        open={askInterests && Boolean(user)}
        initialTopics={interests?.topics ?? []}
        initialTone={interests?.tone || "clear"}
        canDismiss={Boolean(interests?.known)}
        onClose={() => setAskInterests(false)}
        onSaved={(profile) => {
          setInterests(profile);
          setAskInterests(false);
        }}
      />
      <Toaster theme={studio.theme === "light" ? "light" : "dark"} position="top-center" offset={16} />
      <MusicDock />
      <SoundBridge />
      {shareUrl ? <ShareSheet url={shareUrl} onClose={() => setShareUrl(null)} /> : null}
      {headerMenu ? <HeaderMenu onClose={() => setHeaderMenu(false)} onShare={() => void shareDialog()} onTheme={() => studio.setTheme(studio.theme === "dark" ? "light" : "dark")} theme={studio.theme} onSettings={() => { setHeaderMenu(false); setSettings(true); }} shareDisabled={studio.messages.length === 0 || streamingHere || sharing} /> : null}
      {keysOpen ? <KeysSheet onClose={() => setKeysOpen(false)} /> : null}
      {signIn ? <SignInSheet onClose={() => setSignIn(false)} /> : null}
    </div>
  );
}

function ShareSheet({ url, onClose }: { url: string; onClose: () => void }) {
  const lang = useLang();
  const [node, setNode] = useState<HTMLElement | null>(null);
  useEffect(() => setNode(document.body), []);
  if (!node) return null;
  return createPortal(
    <div className="fixed inset-0 z-[75] flex items-end justify-center bg-black/55 p-3 sm:items-center" role="presentation" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-3xl border border-line bg-elev p-4 shadow-[var(--shadow)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <BackButton onClick={onClose} label={ui(lang, "close")} />
          <div className="min-w-0 flex-1">
            <Wordmark />
            <h2 id="share-title" className="mt-2 text-base font-medium">
              {ui(lang, "shareTitle")}
            </h2>
            <p className="mt-1 text-sm text-muted">{ui(lang, "shareNote")}</p>
          </div>
          <button
            type="button"
            className="press hidden size-11 shrink-0 items-center justify-center rounded-2xl border border-line text-muted md:inline-flex"
            aria-label={ui(lang, "close")}
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </div>
        <input readOnly className="field mt-3 font-mono text-xs" value={url} aria-label={ui(lang, "linkLabel")} onFocus={(event) => event.currentTarget.select()} />
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" className="press hidden h-11 rounded-2xl border border-line px-4 text-sm md:inline-flex" onClick={onClose}>
            {ui(lang, "close")}
          </button>
          <button
            type="button"
            className="press h-11 rounded-2xl bg-accent px-4 text-sm font-medium text-accent-fg"
            onClick={() => {
              void shareOut({ url, title: ui(lang, "shareTitle") }).then((how) => {
                if (how === "copy") toast(ui(lang, "copied"));
              });
            }}
          >
            {ui(lang, "copyVerb")}
          </button>
        </div>
      </div>
    </div>,
    node,
  );
}

function SoundBridge() {
  useEffect(() => {
    const seen = new WeakSet<Element>();
    const scan = () => {
      document.querySelectorAll("[data-sonner-toast]").forEach((node) => {
        if (seen.has(node)) return;
        seen.add(node);
        playSound(node.getAttribute("data-type") === "error" ? "fail" : "notice");
      });
    };
    const obs = new MutationObserver(scan);
    obs.observe(document.body, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, []);
  return null;
}

function MobileModel({ studio, fieldId = "model-mobile", plain = false }: { studio: ReturnType<typeof useStudio>; fieldId?: string; plain?: boolean }) {
  if (studio.imageMode && studio.activeProvider.kind === "custom") {
    return (
      <input
        id={fieldId}
        aria-label="Модель картинки"
        className="field"
        value={studio.activeProvider.imageModel ?? ""}
        placeholder="dall-e-3"
        maxLength={120}
        onChange={(event) => studio.updateProvider(studio.activeProvider.id, { imageModel: event.target.value.slice(0, 120) })}
      />
    );
  }
  if (studio.imageMode) {
    return (
      <ModelMenu
        id={fieldId}
        plain={plain}
        value={(studio.imageModels.some((item) => item.name === studio.activeProvider.imageModel) ? studio.activeProvider.imageModel : studio.imageModels[0]?.name) || "grok-imagine-image"}
        options={(studio.imageModels.length ? studio.imageModels : [{ name: "grok-imagine-image", displayName: "Grok Imagine" }]).map((model) => ({
          value: model.name,
          label: model.displayName && model.displayName !== model.name ? model.displayName : model.name,
        }))}
        onChange={(value) => studio.updateProvider(studio.activeProvider.id, { imageModel: value })}
      />
    );
  }
  return (
    <ModelMenu
      id={fieldId}
      plain={plain}
      value={studio.activeProvider.model}
      options={studio.activeProvider.models.map((model) => ({
        value: model,
        label: studio.modelLabels[model] && studio.modelLabels[model] !== model ? studio.modelLabels[model] : model,
        icon: studio.modelIcons[model] || undefined,
      }))}
      onChange={(value) => studio.updateProvider(studio.activeProvider.id, { model: value })}
    />
  );
}

function AccountGate() {
  const lang = useLang();
  return <SignInSheet locked onClose={() => undefined} label={ui(lang, "needAccount")} />;
}

function EmptyChat({
  onPick,
  disabled,
  suggestions,
  personal,
}: {
  onPick: (prompt: string) => void;
  disabled?: boolean;
  suggestions: readonly { title: string; prompt: string }[];
  personal: boolean;
}) {
  const lang = useLang();
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4">
      <div className="m-auto flex w-full max-w-2xl flex-col items-center py-8">
        <Mark size={72} />
        <h1 className="mt-5 text-center font-serif text-4xl tracking-tight">{ui(lang, "howHelp")}</h1>
        <p className="mt-2 max-w-md text-center text-sm text-pretty text-muted">
          {personal ? ui(lang, "emptyPersonal") : ui(lang, "emptyPlain")}
        </p>
        {suggestions.length === 0 ? (
          <p className="mt-8 text-sm text-faint">{ui(lang, "gathering")}</p>
        ) : (
          <div className="mt-8 flex w-full min-w-0 gap-2 overflow-x-auto pr-6 pb-2 pl-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {suggestions.slice(0, 4).map((item, index) => (
              <button
                key={`${item.title}-${index}`}
                type="button"
                disabled={disabled}
                className="press h-12 shrink-0 snap-start rounded-full border border-line bg-elev/90 px-4 text-sm font-medium hover:bg-subtle disabled:opacity-40"
                onClick={() => onPick(item.prompt)}
              >
                {item.title}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SheetFrame({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  useEffect(() => setNode(document.body), []);
  useEffect(() => pushBackLayer(onClose), [onClose]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  if (!node) return null;
  return createPortal(
    <div className="fixed inset-0 z-[75] flex items-end justify-center bg-black/55 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="w-full max-w-md rounded-t-3xl border border-line bg-elev px-3 pt-2 pb-[max(0.85rem,env(safe-area-inset-bottom))] shadow-[var(--shadow)] sm:rounded-3xl sm:pb-3"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-line-strong sm:hidden" />
        {children}
      </div>
    </div>,
    node,
  );
}

function MenuRow({
  icon,
  label,
  onClick,
  disabled,
  trailing,
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  trailing?: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className="flex min-h-12 w-full items-center gap-3 rounded-2xl px-1.5 text-left text-sm enabled:hover:bg-subtle disabled:border-0 disabled:bg-transparent disabled:text-faint"
      onClick={onClick}
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-subtle text-muted">{icon}</span>
      <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
      {trailing}
    </button>
  );
}

function HeaderMenu({
  onClose,
  onShare,
  onTheme,
  theme,
  onSettings,
  shareDisabled,
}: {
  onClose: () => void;
  onShare: () => void;
  onTheme: () => void;
  theme: string;
  onSettings: () => void;
  shareDisabled: boolean;
}) {
  const lang = useLang();
  return (
    <SheetFrame label="Ещё" onClose={onClose}>
      <div className="mb-1 flex items-center justify-between px-1.5">
        <p className="text-[11px] font-medium tracking-[0.16em] text-faint uppercase">Ещё</p>
        <button type="button" className="press grid size-9 place-items-center rounded-xl text-muted" aria-label={ui(lang, "close")} onClick={onClose}>
          <X className="size-4" />
        </button>
      </div>
      <MenuRow icon={<Share2 className="size-4" />} label={ui(lang, "shareDialog")} disabled={shareDisabled} onClick={() => { onClose(); onShare(); }} />
      <MenuRow icon={theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />} label={theme === "dark" ? ui(lang, "lightTheme") : ui(lang, "darkTheme")} onClick={() => { onTheme(); onClose(); }} />
      <div className="flex min-h-12 items-center gap-3 rounded-2xl px-1.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-subtle text-muted">
          <Languages className="size-4" />
        </span>
        <span className="min-w-0 flex-1 text-sm font-medium">{lang === "en" ? "Language" : lang === "kk" ? "Тіл" : "Язык"}</span>
        <LangSwitch compact />
      </div>
      <MenuRow icon={<Settings className="size-4" />} label={ui(lang, "settings")} onClick={onSettings} />
    </SheetFrame>
  );
}

function KeysSheet({ onClose }: { onClose: () => void }) {
  const mod = modLabel();
  const rows = [
    ["Enter", "Отправить"],
    ["Shift+Enter", "Новая строка"],
    ["Esc", "Стоп или закрыть"],
    [`${mod}+K`, "Поиск по истории"],
    [`${mod}+Shift+O`, "Новый чат"],
    [`${mod}+B`, "История"],
    ["/", "В поле ввода"],
    ["↑", "Править последнее"],
    [`${mod}+Shift+C`, "Копировать ответ"],
    [`${mod}+/`, "Эти клавиши"],
  ];
  return (
    <SheetFrame label="Горячие клавиши" onClose={onClose}>
      <p className="px-2 py-2 text-center text-sm font-medium">Горячие клавиши</p>
      <ul className="flex flex-col">
        {rows.map(([key, label]) => (
          <li key={key} className="flex items-center justify-between gap-3 px-2 py-2 text-sm">
            <span>{label}</span>
            <span className="text-faint">{key}</span>
          </li>
        ))}
      </ul>
    </SheetFrame>
  );
}

function SignInSheet({ onClose, locked = false, label }: { onClose: () => void; locked?: boolean; label?: string }) {
  const lang = useLang();
  return (
    <SheetFrame label={label || ui(lang, "signIn")} onClose={locked ? () => undefined : onClose}>
      <div className="max-h-[min(100dvh-2.5rem,40rem)] overflow-y-auto px-1 pb-1">
        <AuthForm locked={locked} />
      </div>
    </SheetFrame>
  );
}
