import { useEffect, useMemo, useRef, useState } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { Download, FileJson, MoreHorizontal, Pencil, Pin, Plus, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import type { Chat } from "@/lib/ai/types";
import { pushBackLayer, useGestureSurface } from "@/lib/app-back";
import { useSwipe } from "@/lib/gestures/use-swipe";
import { fill, ui, type Lang } from "@/lib/i18n";
import { txNow, useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptic";

function groupOf(ts: number, lang: Lang): string {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ts >= start) return ui(lang, "today");
  if (ts >= start - 86_400_000) return ui(lang, "yesterday");
  if (ts >= start - 6 * 86_400_000) return ui(lang, "thisWeek");
  const locale = lang === "en" ? "en-GB" : lang === "kk" ? "kk-KZ" : "ru-RU";
  return new Date(ts).toLocaleDateString(locale, { month: "long", year: "numeric" });
}

function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function slug(title: string) {
  return (
    title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "dialog"
  );
}

export function exportChat(chat: Chat, format: "md" | "json") {
  const name = slug(chat.title);
  if (format === "json") {
    download(`${name}.json`, JSON.stringify(chat, null, 2), "application/json");
    toast(txNow({ ru: "Диалог экспортирован", en: "Chat exported", kk: "Диалог экспортталды" }));
    return;
  }
  const lines = [`# ${chat.title}`, ""];
  for (const message of chat.messages) {
    const who = message.role === "user" ? txNow({ ru: "Вы", en: "You", kk: "Сіз" }) : message.providerName || "vvvion.space";
    lines.push(`## ${who}`, "", message.content || message.error || "", "");
  }
  download(`${name}.md`, lines.join("\n"), "text/markdown");
  toast(txNow({ ru: "Диалог экспортирован", en: "Chat exported", kk: "Диалог экспортталды" }));
}

function readPins(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem("vv.pins") || "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function writePins(ids: string[]) {
  try {
    localStorage.setItem("vv.pins", JSON.stringify(ids.slice(0, 40)));
  } catch {
    /* private mode */
  }
}

export function Sidebar({
  open,
  overlay,
  onClose,
  chats,
  activeId,
  onSelect,
  onNew,
  onRename,
  onDelete,
  onDeleteAll,
}: {
  open: boolean;
  overlay: boolean;
  onClose: () => void;
  chats: Chat[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onDeleteAll: () => void;
}) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [pendingDelete, setPendingDelete] = useState<Chat | null>(null);
  const [pendingAll, setPendingAll] = useState(false);
  const [tools, setTools] = useState(false);
  const [pins, setPins] = useState<string[]>([]);
  const lang = useLang();
  const surface = useGestureSurface();
  const panel = useRef<HTMLElement>(null);

  useEffect(() => setPins(readPins()), []);
  useEffect(() => {
    if (!open || !overlay) return;
    return pushBackLayer(onClose);
  }, [open, overlay, onClose]);

  function togglePin(id: string) {
    setPins((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [id, ...current];
      writePins(next);
      return next;
    });
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return chats;
    return chats.filter(
      (chat) =>
        chat.title.toLowerCase().includes(q) ||
        chat.messages.some((message) => message.content.toLowerCase().includes(q)),
    );
  }, [chats, query]);

  const pinnedChats = useMemo(() => (query.trim() ? [] : filtered.filter((chat) => pins.includes(chat.id))), [filtered, pins, query]);

  const groups = useMemo(() => {
    const map = new Map<string, Chat[]>();
    for (const chat of filtered) {
      if (!query.trim() && pins.includes(chat.id)) continue;
      const key = groupOf(chat.updatedAt, lang);
      const list = map.get(key) ?? [];
      list.push(chat);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [filtered, lang, pins, query]);

  const swipe = useSwipe({
    enabled: open && overlay && surface,
    onMove(dx) {
      if (dx > 0 || !panel.current) return;
      if (document.documentElement.classList.contains("vv-reduce-motion") || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      panel.current.style.transform = `translateX(${Math.max(dx, -panel.current.offsetWidth)}px)`;
    },
    commit: (dx, velocity) => dx <= -80 || velocity <= -0.5,
    onCommit() {
      if (panel.current) panel.current.style.transform = "";
      onClose();
    },
    onCancel() {
      if (!panel.current) return;
      panel.current.style.transition = "transform .18s";
      panel.current.style.transform = "";
      window.setTimeout(() => {
        if (panel.current) panel.current.style.transition = "";
      }, 200);
    },
  });

  return (
    <>
      {open && overlay ? (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-black/45"
          aria-label={ui(lang, "closeList")}
          onClick={onClose}
        />
      ) : null}
      <aside
        ref={panel}
        {...swipe}
        className={cn(
          "z-40 min-w-0 shrink-0 flex-col overflow-x-hidden border-r border-line bg-elev pb-[var(--player-dock,0px)]",
          overlay ? "w-[min(100%,18.5rem)]" : "w-72 xl:w-[18.5rem]",
          open ? "flex" : "hidden",
          open && overlay && "fixed inset-y-0 left-0",
        )}
      >
        <div className="flex items-center gap-2 p-3">
          <button
            type="button"
            className="press inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl bg-fg text-sm font-medium text-bg"
            title={lang === "en" ? "New chat (Ctrl+Shift+O)" : "Новый чат (Ctrl+Shift+O)"}
            onClick={() => {
              haptic("selection");
              onNew();
              if (overlay) onClose();
            }}
          >
            <Plus className="size-4" />
            {ui(lang, "newChat")}
          </button>
          <div className="relative">
            <button
              type="button"
              className="press inline-flex size-11 items-center justify-center rounded-2xl border border-line text-muted"
              aria-label="Ещё"
              aria-expanded={tools}
              onClick={() => setTools((value) => !value)}
            >
              <MoreHorizontal className="size-4" />
            </button>
            {tools ? (
              <div className="absolute right-0 z-20 mt-1 w-44 rounded-2xl border border-line bg-elev p-1 shadow-[var(--shadow)]">
                <button
                  type="button"
                  className="press flex min-h-11 w-full items-center rounded-xl px-3 text-left text-sm text-danger disabled:opacity-40"
                  disabled={chats.length === 0}
                  onClick={() => {
                    setTools(false);
                    setPendingAll(true);
                  }}
                >
                  {ui(lang, "deleteAll")}
                </button>
              </div>
            ) : null}
          </div>
          {overlay ? (
            <button
              type="button"
              className="press inline-flex size-11 items-center justify-center rounded-2xl border border-line text-muted"
              onClick={onClose}
              aria-label={ui(lang, "closeList")}
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
        <label className="relative mx-3 mb-2 block">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
          <input
            id="history-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={ui(lang, "searchHistory")}
            className="h-11 w-full rounded-2xl border border-line bg-bg pr-3 pl-9 text-sm outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          />
        </label>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {pinnedChats.length > 0 ? (
            <section className="mt-3">
              <h2 className="px-3 py-1 text-xs font-medium tracking-wide text-faint uppercase">{lang === "en" ? "Pinned" : "Закреплённые"}</h2>
              <ul>
                {pinnedChats.map((chat) => (
                  <HistoryItem
                    key={chat.id}
                    chat={chat}
                    active={chat.id === activeId}
                    pinned
                    surface={surface}
                    editing={editing === chat.id}
                    title={title}
                    onTitle={setTitle}
                    onStartEdit={() => {
                      setEditing(chat.id);
                      setTitle(chat.title);
                    }}
                    onFinish={() => {
                      onRename(chat.id, title);
                      setEditing(null);
                    }}
                    onSelect={() => {
                      haptic("selection");
                      onSelect(chat.id);
                      onClose();
                    }}
                    onPin={() => togglePin(chat.id)}
                    onDelete={() => onDelete(chat.id)}
                    onAskDelete={() => setPendingDelete(chat)}
                  />
                ))}
              </ul>
            </section>
          ) : null}
          {groups.length === 0 && pinnedChats.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-faint">
              {query ? ui(lang, "nothingFound") : ui(lang, "noChats")}
            </p>
          ) : (
            groups.map(([label, items]) => (
              <section key={label} className="mt-3">
                <h2 className="px-3 py-1 text-xs font-medium tracking-wide text-faint uppercase">
                  {label}
                </h2>
                <ul>
                  {items.map((chat) => (
                    <HistoryItem
                      key={chat.id}
                      chat={chat}
                      active={chat.id === activeId}
                      pinned={pins.includes(chat.id)}
                      surface={surface}
                      editing={editing === chat.id}
                      title={title}
                      onTitle={setTitle}
                      onStartEdit={() => {
                        setEditing(chat.id);
                        setTitle(chat.title);
                      }}
                      onFinish={() => {
                        onRename(chat.id, title);
                        setEditing(null);
                      }}
                      onSelect={() => {
                        haptic("selection");
                        onSelect(chat.id);
                        onClose();
                      }}
                      onPin={() => togglePin(chat.id)}
                      onDelete={() => onDelete(chat.id)}
                      onAskDelete={() => setPendingDelete(chat)}
                    />
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </aside>

      <AlertDialog.Root
        open={Boolean(pendingDelete)}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null);
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
          <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(100%-2rem,24rem)] -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-line bg-elev p-5 shadow-[var(--shadow)]">
            <AlertDialog.Title className="text-lg font-medium">{ui(lang, "deleteChat")}</AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-sm text-muted">
              {fill(ui(lang, "deleteChatBody"), { title: pendingDelete?.title ?? "" })}
            </AlertDialog.Description>
            <div className="mt-5 flex justify-end gap-2">
              <AlertDialog.Cancel className="press h-11 rounded-2xl border border-line px-4 text-sm">
                {ui(lang, "cancel")}
              </AlertDialog.Cancel>
              <AlertDialog.Action
                className="press h-11 rounded-2xl bg-danger px-4 text-sm font-medium text-bg"
                onClick={() => {
                  if (pendingDelete) onDelete(pendingDelete.id);
                }}
              >
                {ui(lang, "delete")}
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
      <AlertDialog.Root open={pendingAll} onOpenChange={setPendingAll}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-[80] bg-black/50" />
          <AlertDialog.Content className="fixed top-1/2 left-1/2 z-[80] w-[min(100%-2rem,24rem)] -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-line bg-elev p-5 shadow-[var(--shadow)]">
            <AlertDialog.Title className="text-lg font-medium">{ui(lang, "deleteAllChats")}</AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-sm text-muted">{ui(lang, "deleteAllBody")}</AlertDialog.Description>
            <div className="mt-5 flex justify-end gap-2">
              <AlertDialog.Cancel className="press h-11 rounded-2xl border border-line px-4 text-sm">{ui(lang, "cancel")}</AlertDialog.Cancel>
              <AlertDialog.Action
                className="press h-11 rounded-2xl bg-danger px-4 text-sm font-medium text-bg"
                onClick={() => onDeleteAll()}
              >
                {ui(lang, "deleteAll")}
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
}

function HistoryItem({
  chat,
  active,
  pinned,
  surface,
  editing,
  title,
  onTitle,
  onStartEdit,
  onFinish,
  onSelect,
  onPin,
  onDelete,
  onAskDelete,
}: {
  chat: Chat;
  active: boolean;
  pinned: boolean;
  surface: boolean;
  editing: boolean;
  title: string;
  onTitle: (value: string) => void;
  onStartEdit: () => void;
  onFinish: () => void;
  onSelect: () => void;
  onPin: () => void;
  onDelete: () => void;
  onAskDelete: () => void;
}) {
  const lang = useLang();
  const [menu, setMenu] = useState(false);
  const row = useRef<HTMLDivElement>(null);
  const mode = useRef<"open" | "delete" | "close">("close");
  const swipe = useSwipe({
    enabled: surface && !editing,
    onMove(dx) {
      const x = Math.max(-144, Math.min(0, dx));
      if (!row.current) return;
      if (document.documentElement.classList.contains("vv-reduce-motion") || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      row.current.style.transform = `translateX(${x}px)`;
    },
    commit(dx, velocity) {
      mode.current = dx <= -132 || velocity <= -0.8 ? "delete" : dx <= -48 ? "open" : "close";
      return mode.current !== "close";
    },
    onCommit() {
      if (mode.current === "delete") {
        haptic("heavy");
        if (row.current) row.current.style.transform = "";
        onDelete();
        return;
      }
      if (row.current) row.current.style.transform = "translateX(-144px)";
    },
    onCancel() {
      if (!row.current) return;
      row.current.style.transition = "transform .18s";
      row.current.style.transform = "";
      window.setTimeout(() => {
        if (row.current) row.current.style.transition = "";
      }, 200);
    },
  });
  return (
    <li className="group relative mb-0.5 overflow-hidden rounded-xl">
      {surface ? (
        <div className="absolute inset-y-0 right-0 flex">
          <button type="button" className="w-[72px] bg-subtle text-xs" onClick={onPin}>
            {pinned ? (lang === "en" ? "Unpin" : "Открепить") : lang === "en" ? "Pin" : "Закрепить"}
          </button>
          <button
            type="button"
            className="w-[72px] bg-danger text-xs text-bg"
            onClick={() => {
              haptic("heavy");
              onDelete();
            }}
          >
            {ui(lang, "delete")}
          </button>
        </div>
      ) : null}
      {editing ? (
        <form
          className="relative bg-elev p-1"
          onSubmit={(event) => {
            event.preventDefault();
            onFinish();
          }}
        >
          <input
            autoFocus
            value={title}
            onChange={(event) => onTitle(event.target.value)}
            onBlur={onFinish}
            className="h-11 w-full rounded-xl border border-line bg-bg px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          />
        </form>
      ) : (
        <div
          ref={row}
          {...swipe}
          className={cn("relative flex items-center bg-elev pr-0.5", active ? "bg-subtle text-fg" : "text-muted hover:bg-subtle/70 hover:text-fg")}
        >
          <button type="button" onClick={onSelect} className="flex min-h-11 min-w-0 flex-1 items-center rounded-xl px-3 py-2.5 text-left text-sm">
            <span className="flex min-w-0 items-center gap-2">
              {pinned ? <Pin className="size-3.5 shrink-0" /> : null}
              {chat.unread ? (
                <span className="wordmark-bang shrink-0 text-base" aria-label={ui(lang, "unreadMark")}>
                  !
                </span>
              ) : null}
              <span className="truncate">{chat.title}</span>
            </span>
          </button>
          <button
            type="button"
            className="press inline-flex size-8 items-center justify-center rounded-lg text-faint hover:bg-bg hover:text-fg"
            aria-label="Ещё"
            aria-expanded={menu}
            onClick={() => setMenu((value) => !value)}
          >
            <MoreHorizontal className="size-3.5" />
          </button>
          {menu ? (
            <div className="absolute top-10 right-1 z-20 w-44 rounded-2xl border border-line bg-elev p-1 shadow-[var(--shadow)]">
              <button type="button" className="press flex min-h-10 w-full items-center gap-2 rounded-xl px-2 text-left text-sm" onClick={() => { setMenu(false); onStartEdit(); }}>
                <Pencil className="size-3.5" /> {ui(lang, "rename")}
              </button>
              <button type="button" className="press flex min-h-10 w-full items-center gap-2 rounded-xl px-2 text-left text-sm" onClick={() => { setMenu(false); exportChat(chat, "md"); }}>
                <Download className="size-3.5" /> {ui(lang, "downloadMd")}
              </button>
              <button type="button" className="press flex min-h-10 w-full items-center gap-2 rounded-xl px-2 text-left text-sm" onClick={() => { setMenu(false); exportChat(chat, "json"); }}>
                <FileJson className="size-3.5" /> {ui(lang, "downloadJson")}
              </button>
              <button type="button" className="press flex min-h-10 w-full items-center gap-2 rounded-xl px-2 text-left text-sm" onClick={() => { setMenu(false); onPin(); }}>
                <Pin className="size-3.5" /> {pinned ? (lang === "en" ? "Unpin" : "Открепить") : lang === "en" ? "Pin" : "Закрепить"}
              </button>
              <button type="button" className="press flex min-h-10 w-full items-center gap-2 rounded-xl px-2 text-left text-sm text-danger" onClick={() => { setMenu(false); onAskDelete(); }}>
                <Trash2 className="size-3.5" /> {ui(lang, "delete")}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </li>
  );
}
