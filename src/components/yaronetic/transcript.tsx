import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowDown, Check, ChevronDown, Copy, Download, Info, MoreHorizontal, RefreshCw, Square, Trash2, Volume2, X } from "lucide-react";
import { BackButton } from "@/components/yaronetic/back-button";
import { isDiskPath } from "@/lib/social/disk-path";
import type { ChatMessage, Usage } from "@/lib/ai/types";
import { copyText, Markdown } from "@/components/yaronetic/markdown";
import { looksLikeAscii } from "@/lib/ascii";
import { ModelFace, usePassingMood, type FaceVariant } from "@/components/yaronetic/model-face";
import { LiveLine } from "@/components/yaronetic/live-status";
import { formatTime } from "@/lib/format-time";
import { pushBackLayer, useGestureSurface } from "@/lib/app-back";
import { useSwipe } from "@/lib/gestures/use-swipe";
import { useLongPress } from "@/lib/gestures/use-long-press";
import { toast } from "sonner";
import { haptic } from "@/lib/haptic";

function clock(ts: number) {
  return formatTime(ts);
}

function pictureSrc(url?: string) {
  if (!url) return "";
  if (isDiskPath(url)) return url;
  if (url.startsWith("data:image/") && url.length < 2_800_000) return url;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:") return parsed.toString();
  } catch {
    return "";
  }
  return "";
}

function saveBlob(blob: Blob, name: string) {
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(href), 1500);
}

async function downloadPicture(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Не удалось скачать");
  const type = res.headers.get("content-type") || "";
  const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : type.includes("gif") ? "gif" : "jpg";
  saveBlob(await res.blob(), `vvvion.${ext}`);
}

function usageLine(usage?: Usage) {
  if (!usage) return null;
  const parts: string[] = [];
  if (usage.reasoning_tokens != null) parts.push(`мысли ${usage.reasoning_tokens}`);
  if (usage.prompt_tokens != null) parts.push(`вход ${usage.prompt_tokens}`);
  if (usage.completion_tokens != null) parts.push(`выход ${usage.completion_tokens}`);
  if (usage.total_tokens != null && parts.length === 0) parts.push(`всего ${usage.total_tokens}`);
  return parts.length ? parts.join(" · ") : null;
}

function shownModel(message: ChatMessage, labels: Record<string, string>) {
  const live = message.model ? labels[message.model]?.trim() : "";
  if (live && live !== message.model) return live;
  const stored = message.modelLabel?.trim() || "";
  if (stored && stored !== message.model) return stored;
  return live || stored;
}

export function Transcript({
  messages,
  streaming,
  onRegenerate,
  onResend,
  onDelete,
  onAsk,
  readonly = false,
  face,
  labels = {},
  continuing = false,
  reasoningOn = true,
  assistantName = "",
  onQuote,
}: {
  messages: ChatMessage[];
  streaming: boolean;
  onRegenerate: (messageId?: string) => void;
  onResend: (messageId: string, next: string) => void;
  onDelete?: (messageId: string) => void;
  onAsk?: (text: string) => void;
  readonly?: boolean;
  face?: FaceVariant;
  labels?: Record<string, string>;
  continuing?: boolean;
  reasoningOn?: boolean;
  assistantName?: string;
  onQuote?: (text: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const userActive = useRef(false);
  const seenUser = useRef<string | null>(null);
  const [away, setAway] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const reduce = useReducedMotion();
  const lastUserId = [...messages].reverse().find((item) => item.role === "user")?.id ?? "";
  const lastAssistantId = [...messages].reverse().find((item) => item.role === "assistant")?.id ?? "";

  useEffect(() => {
    const edit = () => {
      const last = [...messages].reverse().find((item) => item.role === "user" && item.content.trim());
      if (!last) return;
      setEditing(last.id);
      setEditText(last.content);
    };
    window.addEventListener("vvvion-edit-last", edit);
    return () => window.removeEventListener("vvvion-edit-last", edit);
  }, [messages]);

  useEffect(() => {
    const el = scroller.current;
    const box = content.current;
    if (!el || !box) return;
    let timer = 0;
    const down = () => {
      userActive.current = true;
      window.clearTimeout(timer);
    };
    const up = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        userActive.current = false;
      }, 700);
    };
    const onScroll = () => {
      if (!userActive.current) return;
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      const near = dist < 24;
      stick.current = near;
      setAway(!near);
    };
    el.addEventListener("touchstart", down, { passive: true });
    el.addEventListener("pointerdown", down);
    el.addEventListener("wheel", down, { passive: true });
    el.addEventListener("keydown", down);
    el.addEventListener("touchend", up, { passive: true });
    el.addEventListener("touchcancel", up, { passive: true });
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("keyup", up);
    el.addEventListener("scroll", onScroll, { passive: true });
    const observer = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(box);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
      el.removeEventListener("touchstart", down);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("wheel", down);
      el.removeEventListener("wheel", up);
      el.removeEventListener("keydown", down);
      el.removeEventListener("touchend", up);
      el.removeEventListener("touchcancel", up);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("keyup", up);
      el.removeEventListener("scroll", onScroll);
    };
  }, []);

  useEffect(() => {
    if (!lastUserId || lastUserId === seenUser.current) return;
    const first = seenUser.current === null;
    seenUser.current = lastUserId;
    if (first) return;
    stick.current = true;
    setAway(false);
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastUserId]);

  function jump() {
    const el = scroller.current;
    if (!el) return;
    stick.current = true;
    setAway(false);
    el.scrollTo({ top: el.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scroller} className="h-full overflow-y-auto">
        <div ref={content} className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
          <AnimatePresence initial={false}>
            {messages.map((message, index) => {
              const pending = streaming && index === messages.length - 1 && message.role === "assistant";
              return (
                <motion.article
                  key={message.id}
                  initial={reduce ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                  className={message.role === "user" ? "msg-row flex justify-end" : pending ? "msg-row msg-live" : "msg-row"}
                >
                  {message.role === "user" ? (
                    <UserBubble
                      message={message}
                      editing={editing === message.id}
                      editText={editText}
                      disabled={streaming}
                      readonly={readonly}
                      onEdit={() => {
                        setEditing(message.id);
                        setEditText(message.content);
                      }}
                      onEditText={setEditText}
                      onCancel={() => setEditing(null)}
                      onSave={() => {
                        const next = editText.trim();
                        if (!next) return;
                        setEditing(null);
                        onResend(message.id, next);
                      }}
                      onDelete={readonly || !onDelete ? undefined : () => onDelete(message.id)}
                      onQuote={onQuote}
                    />
                  ) : (
                    <AssistantBubble
                      message={message}
                      pending={pending}
                      continuing={continuing && pending}
                      canRegenerate={!readonly && !streaming && !pending}
                      face={face}
                      label={shownModel(message, labels)}
                      full={message.id === lastAssistantId}
                      reasoningOn={reasoningOn}
                      assistantName={assistantName}
                      onRegenerate={() => onRegenerate(message.id)}
                      onAsk={onAsk}
                      askable={!readonly && !pending && message.id === lastAssistantId && messages[index + 1]?.role !== "user"}
                      askNote={messages[index + 1]?.role === "user" ? messages[index + 1].content : undefined}
                      onDelete={readonly || pending || !onDelete ? undefined : () => onDelete(message.id)}
                      onQuote={onQuote}
                    />
                  )}
                </motion.article>
              );
            })}
          </AnimatePresence>
        </div>
      </div>
      {away ? (
        <button
          type="button"
          className="press absolute bottom-3 left-1/2 inline-flex h-10 -translate-x-1/2 items-center gap-2 rounded-full border border-line bg-elev px-3 text-sm shadow-[var(--shadow)]"
          onClick={jump}
        >
          <ArrowDown className="size-4" />
          К последнему
        </button>
      ) : null}
    </div>
  );
}

function useFinePointer() {
  const [fine, setFine] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(pointer: fine)");
    const apply = () => setFine(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);
  return fine;
}

function motionReduced() {
  return document.documentElement.classList.contains("vv-reduce-motion") || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function UserBubble({
  message,
  editing,
  editText,
  disabled,
  readonly,
  onEdit,
  onEditText,
  onCancel,
  onSave,
  onDelete,
  onQuote,
}: {
  message: ChatMessage;
  editing: boolean;
  editText: string;
  disabled: boolean;
  readonly: boolean;
  onEdit: () => void;
  onEditText: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
  onDelete?: () => void;
  onQuote?: (text: string) => void;
}) {
  const [sheet, setSheet] = useState(false);
  const fine = useFinePointer();
  const gestures = useGestureSurface();
  const hold = useLongPress(() => setSheet(true));
  const box = useRef<HTMLDivElement>(null);
  const crossed = useRef(false);
  const swipe = useSwipe({
    enabled: gestures && !editing,
    onMove(dx) {
      const x = Math.max(0, Math.min(dx, 96));
      if (box.current && !motionReduced()) box.current.style.transform = `translateX(${x}px)`;
      const hit = dx >= 64;
      if (hit !== crossed.current) {
        crossed.current = hit;
        if (hit) haptic("selection");
      }
    },
    commit: (dx, velocity) => dx >= 64 || velocity >= 0.5,
    onCommit() {
      resetSwipe();
      haptic("light");
      if (message.content) onQuote?.(message.content.replace(/\s+/g, " ").trim().slice(0, 240));
    },
    onCancel: resetSwipe,
  });
  function resetSwipe() {
    crossed.current = false;
    if (!box.current) return;
    box.current.style.transition = "transform .18s";
    box.current.style.transform = "";
    window.setTimeout(() => {
      if (box.current) box.current.style.transition = "";
    }, 200);
  }
  return (
    <div className="group/msg max-w-[min(100%,36rem)]" {...swipe}>
      {editing ? (
        <div className="rounded-3xl border border-line bg-subtle p-2">
          <textarea
            value={editText}
            onChange={(event) => onEditText(event.target.value)}
            className="min-h-20 w-full resize-y bg-transparent px-2 py-1 text-base outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          />
          <div className="flex justify-end gap-2">
            <button type="button" className="press h-10 rounded-xl px-3 text-sm text-muted" onClick={onCancel}>
              Отмена
            </button>
            <button type="button" className="press h-10 rounded-xl bg-accent px-3 text-sm text-accent-fg" onClick={onSave}>
              Отправить снова
            </button>
          </div>
        </div>
      ) : (
        <div
          ref={box}
          className="rounded-3xl rounded-br-lg bg-subtle px-4 py-3 select-none [-webkit-touch-callout:none] md:select-text"
          onClick={() => {
            if (fine || window.getSelection()?.toString() || hold.fired.current) return;
          }}
          {...hold}
        >
          {message.files?.length ? (
            <div className="mb-2 flex flex-col gap-2">
              {message.files.map((file) =>
                file.kind === "audio" && file.url ? (
                  <span key={file.id} className="block">
                    <audio controls preload="metadata" src={file.url} className="h-9 w-full max-w-xs" />
                  </span>
                ) : file.kind === "image" && (file.dataUrl || file.url) ? (
                  <img key={file.id} src={file.dataUrl || file.url} alt={file.name} loading="lazy" decoding="async" className="max-h-64 rounded-2xl object-contain" />
                ) : (
                  <span key={file.id} className="rounded-xl border border-line bg-bg px-2 py-1 text-xs">
                    {file.url ? (
                      <a href={file.url} target="_blank" rel="noreferrer">
                        {file.name}
                      </a>
                    ) : (
                      file.name
                    )}
                  </span>
                ),
              )}
            </div>
          ) : null}
          {message.content ? (
            looksLikeAscii(message.content) ? (
              <pre className="ascii-art ascii-in-bubble">{message.content}</pre>
            ) : (
              <p className="whitespace-pre-wrap text-pretty">{message.content}</p>
            )
          ) : null}
        </div>
      )}
      {!editing ? (
        <div className="msg-actions mt-1 flex justify-end gap-1">
          <Ghost label="Копировать" onClick={() => void copyText(message.content)}><Copy className="size-4" /></Ghost>
          {readonly ? null : <Ghost label="Изменить" disabled={disabled} onClick={onEdit}><span className="text-xs">Изм</span></Ghost>}
          {onDelete ? <Ghost label="Удалить" disabled={disabled} onClick={onDelete}><Trash2 className="size-4" /></Ghost> : null}
        </div>
      ) : null}
      {sheet && !editing ? (
        <ActionSheet title={clock(message.createdAt)} onClose={() => setSheet(false)}>
          <SheetRow
            label="Копировать"
            onClick={() => {
              setSheet(false);
              void copyText(message.content);
            }}
          />
          {onQuote && message.content ? (
            <SheetRow
              label="Ответить"
              onClick={() => {
                setSheet(false);
                onQuote(message.content.replace(/\s+/g, " ").trim().slice(0, 240));
              }}
            />
          ) : null}
          {readonly ? null : (
            <SheetRow
              label="Изменить"
              disabled={disabled}
              onClick={() => {
                setSheet(false);
                onEdit();
              }}
            />
          )}
          {onDelete ? (
            <SheetRow
              label="Удалить"
              disabled={disabled}
              onClick={() => {
                setSheet(false);
                onDelete();
              }}
            />
          ) : null}
        </ActionSheet>
      ) : null}
    </div>
  );
}

function AssistantBubble({
  message,
  pending,
  continuing,
  canRegenerate,
  face,
  label,
  full,
  reasoningOn = true,
  assistantName = "",
  onRegenerate,
  onAsk,
  askable,
  askNote,
  onDelete,
  onQuote,
}: {
  message: ChatMessage;
  pending: boolean;
  continuing?: boolean;
  canRegenerate: boolean;
  face?: FaceVariant;
  label: string;
  full?: boolean;
  reasoningOn?: boolean;
  assistantName?: string;
  onRegenerate: () => void;
  onAsk?: (text: string) => void;
  askable?: boolean;
  askNote?: string;
  onDelete?: () => void;
  onQuote?: (text: string) => void;
}) {
  const tokens = usageLine(message.usage);
  const waiting = pending && !message.content && !message.error && !message.imageUrl;
  const mood = usePassingMood(
    message.error ? "oops" : waiting && message.image ? "draw" : waiting && message.web ? "seek" : waiting ? "think" : pending ? "talk" : message.content || message.imageUrl ? "happy" : "idle",
  );
  const src = pictureSrc(message.imageUrl);
  const [more, setMore] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const fine = useFinePointer();
  const gestures = useGestureSurface();
  const box = useRef<HTMLDivElement>(null);
  const crossed = useRef(false);
  const hold = useLongPress(() => setMore(true));
  const swipe = useSwipe({
    enabled: gestures && !pending,
    onMove(dx) {
      const x = Math.max(0, Math.min(dx, 96));
      if (box.current && !motionReduced()) box.current.style.transform = `translateX(${x}px)`;
      const hit = dx >= 64;
      if (hit !== crossed.current) {
        crossed.current = hit;
        if (hit) haptic("selection");
      }
    },
    commit: (dx, velocity) => dx >= 64 || velocity >= 0.5,
    onCommit() {
      resetSwipe();
      haptic("light");
      if (message.content) onQuote?.(message.content.replace(/\s+/g, " ").trim().slice(0, 240));
    },
    onCancel: resetSwipe,
  });
  function resetSwipe() {
    crossed.current = false;
    if (!box.current) return;
    box.current.style.transition = "transform .18s";
    box.current.style.transform = "";
    window.setTimeout(() => {
      if (box.current) box.current.style.transition = "";
    }, 200);
  }
  const done = !pending && Boolean(message.content || message.error || message.imageUrl);
  return (
    <div className="group/msg flex sm:gap-3" {...swipe}>
      <div className="hidden sm:block">
        <ModelFace name={message.model || message.providerName || "vvvion"} mood={mood} size={40} variant={face} />
      </div>
      <div ref={box} className="min-w-0 flex-1" {...hold}>
        <div className="mb-1 flex items-center gap-2 text-xs text-faint">
          <span className="sm:hidden">
            <ModelFace name={message.model || message.providerName || "vvvion"} mood={mood} size={24} variant={face} />
          </span>
          <span>{assistantName.trim() || message.providerName || "vvvion.space"}</span>
          {label ? <span className="max-w-[14rem] truncate">{label}</span> : null}
          <span className="tabular-nums">{clock(message.createdAt)}</span>
          <span className="ml-auto flex items-center">
            {tokens ? (
              <button
                type="button"
                className="press inline-flex size-8 items-center justify-center rounded-lg text-faint hover:bg-subtle hover:text-fg"
                aria-label="Токены"
                aria-expanded={usageOpen}
                onClick={() => setUsageOpen((value) => !value)}
              >
                <Info className="size-3.5" />
              </button>
            ) : null}
            {done && !fine ? (
              <button
                type="button"
                className="press inline-flex size-8 items-center justify-center rounded-lg text-faint hover:bg-subtle hover:text-fg"
                aria-label="Ещё"
                onClick={() => {
                  haptic("light");
                  setMore(true);
                }}
              >
                <MoreHorizontal className="size-4" />
              </button>
            ) : null}
          </span>
        </div>
        {usageOpen && tokens ? <p className="mb-1 text-xs text-faint tabular-nums">{tokens}</p> : null}
        {pending ? (
          <p className="mt-0.5 text-xs text-muted">
            <LiveLine />
          </p>
        ) : null}
        {message.reasoning || (waiting && reasoningOn) ? <Thought text={message.reasoning || ""} live={waiting} /> : null}
        {continuing ? <p className="mb-2 text-sm text-muted">Ответ дописывается сам. Экран можно выключить.</p> : null}
        {src ? <ChatPicture url={src} alt={message.content || "Сгенерированная картинка"} /> : null}
        {message.content ? (
          <div className={pending ? "caret" : undefined}>
            <Markdown text={message.content} live={pending} askable={askable} askNote={askNote} onAsk={onAsk} />
          </div>
        ) : null}
        {message.error ? (
          <p className="mt-2 rounded-2xl border border-line bg-subtle px-3 py-2 text-sm text-danger">{message.error}</p>
        ) : null}
        {message.sources && message.sources.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {message.sources.map((source) => (
              <a
                key={source.url}
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="max-w-full rounded-2xl border border-line bg-subtle px-3 py-2 text-xs hover:bg-elev"
              >
                <span className="block truncate font-medium text-fg">{source.title}</span>
                {source.snippet ? <span className="mt-0.5 line-clamp-2 block text-faint">{source.snippet}</span> : null}
              </a>
            ))}
          </div>
        ) : null}
        {message.stopped ? <p className="mt-2 text-sm text-faint">Остановлено</p> : null}
        {done ? (
          <div className={full ? "msg-actions msg-actions-last mt-1 flex gap-1" : "msg-actions mt-1 flex gap-1"}>
            {message.content ? <SpeakButton text={message.content} /> : null}
            {message.content ? <CopyToggle text={message.content} /> : null}
            {canRegenerate ? (
              <Ghost label="Заново" onClick={onRegenerate}>
                <RefreshCw className="size-4" />
              </Ghost>
            ) : null}
            {onDelete ? (
              <Ghost label="Удалить" onClick={onDelete}>
                <Trash2 className="size-4" />
              </Ghost>
            ) : null}
          </div>
        ) : null}
        {more ? (
          <ActionSheet title="Действия" onClose={() => setMore(false)}>
            {message.content ? (
              <SheetRow
                label="Озвучить"
                onClick={() => {
                  setMore(false);
                  void playSpeech(message.content);
                }}
              />
            ) : null}
            {message.content ? (
              <SheetRow
                label="Копировать"
                onClick={() => {
                  setMore(false);
                  void copyText(message.content);
                }}
              />
            ) : null}
            {onQuote && message.content ? (
              <SheetRow
                label="Ответить"
                onClick={() => {
                  setMore(false);
                  onQuote(message.content.replace(/\s+/g, " ").trim().slice(0, 240));
                }}
              />
            ) : null}
            {canRegenerate ? (
              <SheetRow
                label="Заново"
                onClick={() => {
                  setMore(false);
                  onRegenerate();
                }}
              />
            ) : null}
            {onDelete ? (
              <SheetRow
                label="Удалить"
                onClick={() => {
                  setMore(false);
                  onDelete();
                }}
              />
            ) : null}
          </ActionSheet>
        ) : null}
      </div>
    </div>
  );
}

function ChatPicture({ url, alt }: { url: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [node, setNode] = useState<HTMLElement | null>(null);
  useEffect(() => setNode(document.body), []);
  useEffect(() => {
    if (!open) return;
    return pushBackLayer(() => setOpen(false));
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);
  if (failed) {
    return <p className="mt-2 text-sm text-muted">Картинка не открылась</p>;
  }
  return (
    <>
      <button type="button" className="mt-2 block max-w-xl text-left" onClick={() => setOpen(true)}>
        <img
          src={url}
          alt={alt}
          className="max-h-[28rem] w-full rounded-2xl border border-line object-contain"
          onError={() => setFailed(true)}
        />
      </button>
      {open && node
        ? createPortal(
            <div className="fixed inset-0 z-[80] flex flex-col bg-black/80 p-3" role="dialog" aria-modal="true" aria-label={alt}>
              <div className="flex items-center justify-between gap-2">
                <BackButton onClick={() => setOpen(false)} label="Назад" className="text-white" />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="press inline-flex h-11 items-center gap-1.5 rounded-2xl bg-elev px-3 text-sm"
                    onClick={() => void downloadPicture(url).catch(() => undefined)}
                  >
                    <Download className="size-4" />
                    Скачать
                  </button>
                  <button type="button" className="press hidden h-11 items-center gap-1.5 rounded-2xl border border-line bg-elev px-3 text-sm md:inline-flex" onClick={() => setOpen(false)}>
                    <X className="size-4" />
                    Закрыть
                  </button>
                </div>
              </div>
              <button type="button" className="flex min-h-0 flex-1 items-center justify-center" aria-label="Закрыть" onClick={() => setOpen(false)}>
                <img src={url} alt={alt} className="max-h-full max-w-full object-contain" />
              </button>
            </div>,
            node,
          )
        : null}
    </>
  );
}

function Thought({ text, live }: { text: string; live: boolean }) {
  const [open, setOpen] = useState(live);
  useEffect(() => {
    setOpen(live);
  }, [live]);
  return (
    <div className="mb-2">
      <button
        type="button"
        className="press inline-flex h-8 items-center gap-1 rounded-xl px-1 text-xs text-muted"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronDown className={open ? "size-3.5 transition-transform" : "size-3.5 -rotate-90 transition-transform"} />
        Ход мысли
      </button>
      {open && text ? (
        <div className="mt-1 max-h-48 overflow-y-auto rounded-2xl border border-line bg-subtle px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap text-muted">
          {text}
        </div>
      ) : null}
    </div>
  );
}

function speakable(raw: string) {
  return raw
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]+`/g, " ")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[*_~>#|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2500);
}

function speechHash(text: string) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

let speechNow = "";
let speechAudio: HTMLAudioElement | null = null;
let speechGen = 0;
const speechUrls = new Map<string, string>();
const speechWatch = new Set<() => void>();

function speechEmit() {
  for (const fn of speechWatch) fn();
}

async function playSpeech(text: string) {
  const clean = speakable(text);
  if (clean.length < 2) return;
  if (speechNow === clean) {
    speechGen += 1;
    speechAudio?.pause();
    speechNow = "";
    speechEmit();
    return;
  }
  const mine = ++speechGen;
  speechAudio?.pause();
  speechNow = clean;
  speechEmit();
  try {
    let url = speechUrls.get(clean);
    if (!url) {
      const key = new Request(new URL(`/__vvvion_tts__/${speechHash(clean)}`, window.location.origin));
      const cache = await caches.open("vvvion-tts");
      let hit = await cache.match(key);
      if (!hit) {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: clean }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { message?: string };
          throw new Error(body.message || "Голос не ответил");
        }
        const blob = await res.blob();
        await cache.put(key, new Response(blob, { headers: { "content-type": blob.type || "audio/mpeg" } }));
        hit = await cache.match(key);
      }
      const blob = hit ? await hit.blob() : null;
      if (!blob) throw new Error("Голос не ответил");
      url = URL.createObjectURL(blob);
      speechUrls.set(clean, url);
      if (speechUrls.size > 8) {
        const first = speechUrls.keys().next().value;
        if (first && first !== clean) {
          const old = speechUrls.get(first);
          if (old) URL.revokeObjectURL(old);
          speechUrls.delete(first);
        }
      }
    }
    if (mine !== speechGen) return;
    const audio = new Audio(url);
    speechAudio = audio;
    audio.onended = () => {
      if (speechAudio === audio) {
        speechNow = "";
        speechEmit();
      }
    };
    await audio.play();
    speechEmit();
  } catch (err) {
    if (mine !== speechGen) return;
    speechNow = "";
    speechEmit();
    toast.error(err instanceof Error ? err.message : "Голос не ответил");
  }
}

function SpeakButton({ text }: { text: string }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((value) => value + 1);
    speechWatch.add(fn);
    return () => {
      speechWatch.delete(fn);
    };
  }, []);
  const clean = speakable(text);
  if (clean.length < 2) return null;
  const on = speechNow === clean;
  return (
    <Ghost label={on ? "Стоп" : "Озвучить"} onClick={() => void playSpeech(text)}>
      {on ? <Square className="size-3.5 fill-current" /> : <Volume2 className="size-4" />}
    </Ghost>
  );
}

function CopyToggle({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <Ghost
      label="Копировать"
      onClick={() => {
        void copyText(text).then(() => {
          setDone(true);
          window.setTimeout(() => setDone(false), 1200);
        });
      }}
    >
      {done ? <Check className="size-4" /> : <Copy className="size-4" />}
    </Ghost>
  );
}

function ActionSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const startX = useRef(0);
  const startT = useRef(0);
  const dragging = useRef(false);
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
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/45 md:items-center" onClick={onClose}>
      <div
        ref={sheet}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-lg rounded-t-3xl border border-line bg-elev px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:rounded-3xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="mx-auto mb-1 flex h-6 w-full touch-none items-center justify-center md:hidden"
          aria-hidden
          onPointerDown={(event) => {
            dragging.current = true;
            startY.current = event.clientY;
            startX.current = event.clientX;
            startT.current = performance.now();
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!dragging.current || !sheet.current) return;
            const dy = event.clientY - startY.current;
            const dx = event.clientX - startX.current;
            if (Math.abs(dx) > 24) {
              dragging.current = false;
              sheet.current.style.transform = "";
              return;
            }
            sheet.current.style.transform = `translateY(${Math.max(0, dy)}px)`;
          }}
          onPointerUp={(event) => {
            if (!dragging.current) return;
            dragging.current = false;
            const dy = event.clientY - startY.current;
            const dx = event.clientX - startX.current;
            const velocity = dy / Math.max(1, performance.now() - startT.current);
            if (sheet.current) sheet.current.style.transform = "";
            if (Math.abs(dx) > 24) return;
            if ((dy >= 96 && velocity >= 0.4) || dy >= 160) onClose();
          }}
          onPointerCancel={() => {
            dragging.current = false;
            if (sheet.current) sheet.current.style.transform = "";
          }}
        >
          <span className="h-1.5 w-10 rounded-full bg-line-strong" />
        </div>
        <p className="px-2 py-2 text-center text-xs text-faint">{title}</p>
        <div className="flex flex-col gap-1">{children}</div>
      </div>
    </div>,
    node,
  );
}

function SheetRow({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} className="press min-h-12 rounded-2xl px-3 text-left text-base disabled:opacity-40" onClick={onClick}>
      {label}
    </button>
  );
}

function Ghost({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      className="press inline-flex size-10 items-center justify-center rounded-lg text-faint hover:bg-subtle hover:text-fg disabled:opacity-40"
      onClick={onClick}
    >
      {children}
    </button>
  );
}
