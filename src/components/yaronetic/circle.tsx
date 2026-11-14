import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { BookOpen, Compass, HardDrive, Landmark, MessageCircle, MessageSquare, Moon, MoreHorizontal, Newspaper, Shield, ShoppingBag, Sun } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { AuthForm } from "@/components/yaronetic/auth-form";
import { Bank } from "@/components/yaronetic/bank";
import { Shop } from "@/components/yaronetic/shop";
import { AdminPanel } from "@/components/yaronetic/admin-panel";
import { Disk } from "@/components/yaronetic/disk";
import { Feed } from "@/components/yaronetic/feed";
import { Library } from "@/components/yaronetic/library";
import { Messenger } from "@/components/yaronetic/messenger";
import { Services } from "@/components/yaronetic/services";
import { UserButton } from "@/lib/auth/gates";
import { Wordmark } from "@/components/yaronetic/wordmark";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { getAccess, type Access } from "@/lib/social/admin";
import { type CircleTab } from "@/lib/places";
import { readJump } from "@/lib/jump";
import { ui, type UiKey } from "@/lib/i18n";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptic";
import { useGestureSurface, pushBackLayer } from "@/lib/app-back";
import { useSwipe } from "@/lib/gestures/use-swipe";

export type { CircleTab };

export function Circle({
  onClose,
  tab: initialTab = "chat",
  onTab,
  theme = "dark",
  onTheme,
  roomId = null,
}: {
  onClose?: () => void;
  tab?: CircleTab;
  onTab?: (tab: CircleTab) => void;
  theme?: "dark" | "light";
  onTheme?: (theme: "dark" | "light") => void;
  roomId?: string | null;
}) {
  const { user, isPending } = useCurrentUserState();
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  if (!ready || isPending) {
    return (
      <div className="flex h-full flex-col gap-3 p-4">
        <div className="h-6 w-24 rounded-lg bg-subtle" />
        <div className="h-24 rounded-2xl bg-subtle" />
        <div className="h-24 rounded-2xl bg-subtle" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex h-full items-end bg-black/55 sm:items-center sm:justify-center sm:p-4">
        <div className="max-h-full w-full max-w-md overflow-y-auto rounded-t-3xl border border-line bg-elev px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[var(--shadow)] sm:rounded-3xl sm:pb-4">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line-strong sm:hidden" />
          <div className="mb-3 flex items-center justify-between gap-2">
            <Wordmark />
            {onClose ? <ToChat onClick={onClose} /> : null}
          </div>
          <AuthForm />
        </div>
      </div>
    );
  }

  return <Home onClose={onClose} initialTab={initialTab} onTab={onTab} theme={theme} onTheme={onTheme} roomId={roomId} />;
}

function Home({
  onClose,
  initialTab,
  onTab,
  theme,
  onTheme,
  roomId,
}: {
  onClose?: () => void;
  initialTab: CircleTab;
  onTab?: (tab: CircleTab) => void;
  theme: "dark" | "light";
  onTheme?: (theme: "dark" | "light") => void;
  roomId?: string | null;
}) {
  const lang = useLang();
  const [tab, setTab] = useState<CircleTab>(initialTab);
  const [access, setAccess] = useState<Access | null>(null);
  const [more, setMore] = useState(false);
  const [keys, setKeys] = useState(false);
  const [nested, setNested] = useState(false);
  const armed = useRef(0);
  const tabsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  function pick(next: CircleTab, fromUser = false) {
    if (fromUser && next !== tab) haptic("selection");
    setTab(next);
    onTab?.(next);
  }

  useEffect(() => {
    const onTab = (event: Event) => {
      const next = (event as CustomEvent<CircleTab>).detail;
      if (next) pick(next, true);
    };
    const onNested = (event: Event) => setNested(Boolean((event as CustomEvent<boolean>).detail));
    window.addEventListener("vv-circle-tab", onTab);
    window.addEventListener("vv-circle-nested", onNested);
    return () => {
      window.removeEventListener("vv-circle-tab", onTab);
      window.removeEventListener("vv-circle-nested", onNested);
    };
  }, [tab]);

  useEffect(() => {
    const node = tabsRef.current?.querySelector<HTMLElement>("[aria-selected='true']");
    node?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [tab]);

  useEffect(() => {
    const order: CircleTab[] = ["chat", "feed", "play", "services", "disk", "bank", "shop"];
    const jump: Record<string, CircleTab> = { m: "chat", f: "feed", p: "play", s: "services", d: "disk", b: "bank", h: "shop" };
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      const target = event.target as HTMLElement | null;
      const typing = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (event.key === "?" && !typing) {
        event.preventDefault();
        setKeys(true);
        return;
      }
      if ((event.key === "[" || event.key === "]") && !typing && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        const at = Math.max(0, order.indexOf(tab));
        const next = order[at + (event.key === "]" ? 1 : -1)];
        if (next) pick(next, true);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight") && !typing) {
        event.preventDefault();
        const at = Math.max(0, order.indexOf(tab));
        const next = order[at + (event.key === "ArrowRight" ? 1 : -1)];
        if (next) pick(next, true);
        return;
      }
      if (typing) {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && target?.id === "feed-composer") {
          event.preventDefault();
          target.closest("form")?.requestSubmit();
        }
        return;
      }
      if (event.key === "g" && !event.metaKey && !event.ctrlKey) {
        armed.current = performance.now();
        return;
      }
      if (armed.current && performance.now() - armed.current < 800 && jump[event.key]) {
        event.preventDefault();
        armed.current = 0;
        pick(jump[event.key], true);
        return;
      }
      armed.current = 0;
      if (event.key === "/" ) {
        event.preventDefault();
        (document.getElementById("circle-people") || document.getElementById("shelf-search"))?.focus();
        return;
      }
      if (event.key === "n" && tab === "feed") {
        event.preventDefault();
        document.getElementById("feed-composer")?.focus();
        return;
      }
      if ((event.key === "j" || event.key === "k") && tab === "feed") {
        const posts = [...document.querySelectorAll<HTMLElement>(".feed-post")];
        if (!posts.length) return;
        event.preventDefault();
        const current = document.activeElement as HTMLElement | null;
        const at = posts.indexOf(current && posts.includes(current) ? current : posts[0]);
        const next = posts[Math.min(posts.length - 1, Math.max(0, at + (event.key === "j" ? 1 : -1)))] ?? posts[0];
        next.focus();
        next.scrollIntoView({ block: "nearest" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab]);

  useEffect(() => {
    function go() {
      const jump = readJump();
      if (!jump) return;
      if (jump.book) pick("play");
      else if (jump.post) pick("feed");
    }
    go();
    window.addEventListener("vvvion-jump", go);
    return () => window.removeEventListener("vvvion-jump", go);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getAccess()
      .then((row) => {
        if (!cancelled) setAccess(row);
      })
      .catch(() => {
        if (!cancelled) setAccess({ role: "member", banned: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const admin = access?.role === "admin";
  const banned = access?.banned === true;
  const titleKey: UiKey =
    tab === "admin" ? "admin" : tab === "feed" ? "feed" : tab === "play" ? "play" : tab === "services" ? "services" : tab === "disk" ? "disk" : tab === "bank" ? "bank" : tab === "shop" ? "shop" : "messages";
  const title = ui(lang, titleKey);
  const order: CircleTab[] = ["chat", "feed", "play", "services", "disk", "bank", "shop"];
  const column =
    tab === "feed" ? "max-w-[42rem]" : tab === "disk" || tab === "shop" || tab === "bank" ? "max-w-[45rem]" : tab === "services" || tab === "play" ? "max-w-[60rem]" : "max-w-none";
  const mainTabs: CircleTab[] = ["chat", "feed", "play", "services"];
  const moreTabs: CircleTab[] = admin ? ["disk", "bank", "shop", "admin"] : ["disk", "bank", "shop"];

  function scrollTop() {
    document.querySelector("[data-circle-pane] .overflow-y-auto")?.scrollTo({ top: 0 });
  }

  return (
    <div className="flex h-full min-h-0 bg-elev pb-[var(--player-dock,0px)]">
      <nav className="hidden w-60 shrink-0 flex-col border-r border-line xl:flex" aria-label={ui(lang, "circle")}>
        <div className="p-3">
          {onClose ? <ToChat onClick={onClose} wide /> : null}
        </div>
        <div role="tablist" aria-orientation="vertical" className="flex min-h-0 flex-1 flex-col gap-1 px-2">
          {order.map((id) => (
            <RailTab key={id} id={id} active={tab === id} label={ui(lang, id === "chat" ? "messages" : id)} onClick={() => pick(id, true)} />
          ))}
          {admin ? <RailTab id="admin" active={tab === "admin"} label={ui(lang, "admin")} onClick={() => pick("admin", true)} /> : null}
        </div>
        <div className="p-3">
          <UserButton compact onTheme={onTheme ? () => onTheme(theme === "dark" ? "light" : "dark") : undefined} theme={theme} />
        </div>
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-14 items-center gap-2 border-b border-line px-2 pt-[env(safe-area-inset-top)]">
          {onClose ? (
            <button type="button" className="press inline-flex size-11 items-center justify-center rounded-2xl text-fg xl:hidden" aria-label={ui(lang, "toChat")} onClick={onClose}>
              <MessageSquare className="hidden size-4 md:block" />
              <span className="font-serif text-2xl leading-none md:hidden" aria-hidden="true">‹</span>
            </button>
          ) : null}
          <h1 className="min-w-0 flex-1 truncate font-serif text-xl leading-tight">{title}</h1>
          {onTheme ? (
            <button
              type="button"
              className="press hidden size-11 items-center justify-center rounded-2xl border border-line text-muted md:inline-flex xl:hidden"
              aria-label={theme === "dark" ? "Светлая тема" : "Тёмная тема"}
              onClick={() => onTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
          ) : null}
          <span className="xl:hidden">
            <UserButton compact onTheme={onTheme ? () => onTheme(theme === "dark" ? "light" : "dark") : undefined} theme={theme} />
          </span>
        </header>
        <div ref={tabsRef} role="tablist" aria-label={ui(lang, "circle")} className="snap-row hidden gap-1 px-3 py-2 md:flex xl:hidden" onKeyDown={(event) => onTabKey(event, order, tab, (id) => pick(id, true))}>
          {order.map((id) => (
            <TabButton key={id} active={tab === id} onClick={() => { if (tab === id) scrollTop(); else pick(id, true); }}>
              <TabIcon id={id} />
              {ui(lang, id === "chat" ? "messages" : id)}
            </TabButton>
          ))}
          {admin ? (
            <TabButton active={tab === "admin"} onClick={() => pick("admin", true)}>
              <Shield className="size-3.5" aria-hidden="true" />
              {ui(lang, "admin")}
            </TabButton>
          ) : null}
        </div>
        <SectionSwipe tabs={order} active={order.includes(tab) ? tab : "chat"} paused={nested} onChange={(id) => pick(id, true)}>
          <div data-circle-pane className={cn("mx-auto flex h-full min-h-0 w-full flex-col", column)}>
            {banned ? (
              <p className="p-4 text-sm text-danger">{ui(lang, "banned")}</p>
            ) : tab === "admin" && admin ? (
              <AdminPanel />
            ) : tab === "feed" ? (
              <Feed />
            ) : tab === "play" ? (
              <Library />
            ) : tab === "services" ? (
              <Services />
            ) : tab === "disk" ? (
              <Disk />
            ) : tab === "bank" ? (
              <Bank />
            ) : tab === "shop" ? (
              <Shop />
            ) : (
              <Messenger openRoom={tab === "chat" ? roomId : null} />
            )}
          </div>
        </SectionSwipe>
        <nav className={cn("circle-nav grid shrink-0 grid-cols-5 border-t border-line bg-elev pt-1.5 pb-[max(0.9rem,env(safe-area-inset-bottom))] md:hidden", nested && "hidden")} aria-label={ui(lang, "circle")}>
          {mainTabs.map((id) => (
            <button
              key={id}
              type="button"
              className={cn("press flex min-h-16 flex-col items-center justify-center gap-1 px-0.5 text-[13px] leading-none", tab === id ? "text-fg" : "text-muted")}
              aria-current={tab === id ? "page" : undefined}
              onClick={() => {
                if (tab === id) scrollTop();
                else pick(id, true);
              }}
            >
              <TabIcon id={id} big />
              <span className="max-w-full truncate">{ui(lang, id === "chat" ? "messages" : id)}</span>
            </button>
          ))}
          <button
            type="button"
            className={cn("press flex min-h-16 flex-col items-center justify-center gap-1 px-0.5 text-[13px] leading-none", moreTabs.includes(tab) ? "text-fg" : "text-muted")}
            aria-expanded={more}
            onClick={() => {
              if (moreTabs.includes(tab)) scrollTop();
              setMore(true);
            }}
          >
            <MoreHorizontal className="size-6" />
            <span>Ещё</span>
          </button>
        </nav>
      </div>
      {more ? <MoreSheet title="Ещё" onClose={() => setMore(false)}>
        {moreTabs.map((id) => (
          <button key={id} type="button" className="press flex min-h-12 w-full items-center gap-2 rounded-2xl px-3 text-left text-base" onClick={() => { setMore(false); pick(id, true); }}>
            <TabIcon id={id} />
            {ui(lang, id === "admin" ? "admin" : id)}
          </button>
        ))}
      </MoreSheet> : null}
      {keys ? <MoreSheet title="Клавиши" onClose={() => setKeys(false)}>
        <p className="px-3 py-2 text-sm text-muted">Esc — закрыть. [ ] — раздел. g, затем m f p s d b h — перейти. / — поиск. n — новая запись. j k — записи.</p>
      </MoreSheet> : null}
    </div>
  );
}

const ICONS = {
  chat: MessageCircle,
  feed: Newspaper,
  play: BookOpen,
  services: Compass,
  disk: HardDrive,
  bank: Landmark,
  shop: ShoppingBag,
  admin: Shield,
} as const;

function TabIcon({ id, big = false }: { id: CircleTab; big?: boolean }) {
  const Icon = ICONS[id];
  return <Icon className={big ? "size-6" : "size-4"} aria-hidden="true" />;
}

function RailTab({ id, active, label, onClick }: { id: CircleTab; active: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" role="tab" aria-selected={active} className={cn("circle-tab press flex h-10 items-center gap-2 rounded-xl px-3 text-left text-sm", active ? "bg-subtle text-fg" : "text-muted")} onClick={onClick}>
      <TabIcon id={id} />
      <span className="truncate">{label}</span>
    </button>
  );
}

function ToChat({ onClick, wide = false }: { onClick: () => void; wide?: boolean }) {
  const lang = useLang();
  return (
    <button type="button" className={cn("press inline-flex h-11 items-center gap-2 rounded-2xl bg-accent px-3 text-sm font-medium text-accent-fg", wide && "w-full justify-center")} aria-label={ui(lang, "toChat")} onClick={onClick}>
      <span aria-hidden="true">‹</span>
      {ui(lang, "toChat")}
    </button>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" role="tab" aria-selected={active} onClick={onClick} className={cn("circle-tab press inline-flex h-10 shrink-0 snap-start items-center gap-2 rounded-xl px-3 text-sm whitespace-nowrap", active ? "bg-subtle text-fg" : "text-muted")}>
      {children}
    </button>
  );
}

function onTabKey(event: { key: string; preventDefault: () => void }, order: CircleTab[], tab: CircleTab, pick: (id: CircleTab) => void) {
  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft" && event.key !== "Home" && event.key !== "End") return;
  event.preventDefault();
  const at = Math.max(0, order.indexOf(tab));
  const next = event.key === "Home" ? order[0] : event.key === "End" ? order[order.length - 1] : order[at + (event.key === "ArrowRight" ? 1 : -1)];
  if (next) pick(next);
}

function SectionSwipe({ tabs, active, paused, onChange, children }: { tabs: CircleTab[]; active: CircleTab; paused?: boolean; onChange: (tab: CircleTab) => void; children: ReactNode }) {
  const enabled = useGestureSurface() && !paused;
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const idx = Math.max(0, tabs.indexOf(active));
  function reset() {
    if (!ref.current) return;
    ref.current.style.transform = "";
    ref.current.style.opacity = "";
  }
  const swipe = useSwipe({
    enabled,
    minX: 24,
    ignore: ".snap-row,.scroll-x,pre,.code-frame,[data-no-swipe],input,textarea,video,iframe,.circle-nav",
    onMove(dx) {
      const edge = (dx > 0 && idx === 0) || (dx < 0 && idx === tabs.length - 1);
      const x = edge ? dx / 4 : Math.max(-24, Math.min(24, dx / 3));
      if (reduce || !ref.current) return;
      ref.current.style.transform = `translateX(${x}px)`;
      ref.current.style.opacity = String(1 - Math.min(Math.abs(x) / 160, 0.3));
    },
    commit: (dx, velocity) => Math.abs(dx) > window.innerWidth * 0.35 || Math.abs(velocity) > 0.5,
    onCommit(dir) {
      reset();
      const next = tabs[idx - dir];
      if (next) onChange(next);
    },
    onCancel: reset,
  });
  return (
    <div ref={ref} {...swipe} className="min-h-0 flex-1 overflow-hidden" style={{ ...swipe.style, transition: reduce ? undefined : "transform .16s, opacity .16s" }}>
      {children}
    </div>
  );
}

function MoreSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => setNode(document.body), []);
  useEffect(() => pushBackLayer(() => closeRef.current()), []);
  if (!node) return null;
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end bg-black/50" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="w-full rounded-t-3xl border border-line bg-elev px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]" onClick={(event) => event.stopPropagation()}>
        <p className="px-2 pb-2 text-center text-xs text-faint">{title}</p>
        {children}
      </div>
    </div>,
    node,
  );
}
