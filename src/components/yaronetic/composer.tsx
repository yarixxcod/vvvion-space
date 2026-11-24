import { StickerPicker } from "@/components/yaronetic/sticker-picker";
import { stickerBody } from "@/lib/stickers";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Smile,
  ArrowUp,
  Brain,
  Globe,
  ImageIcon,
  MessageCircleQuestion,
  Paperclip,
  Phone,
  Plus,
  Square,
  UserRound,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { MicButton } from "@/components/yaronetic/mic-button";
import { attachmentQueue, composerSubmitKey } from "@/lib/ai/composer-input";
import { CHAT_FILE_COUNT, CHAT_FILE_MAX, pasteAsFile, readChatFile } from "@/lib/ai/attach";
import { uploadChatFile } from "@/lib/social/circle-upload";
import { UploadMeter, type UploadView } from "@/components/yaronetic/upload-meter";
import type { ChatFile } from "@/lib/ai/types";
import { cn } from "@/lib/utils";
import { ui, type Lang } from "@/lib/i18n";
import { useLang } from "@/lib/lang";

function reasonLabel(lang: Lang, mode: "auto" | "always" | "never", on: boolean) {
  if (mode === "never") return ui(lang, "reasonNever");
  if (mode === "always") return ui(lang, on ? "reasonDeep" : "reasonMin");
  return ui(lang, on ? "reasonOn" : "reasonOff");
}

export function Composer({
  value,
  onChange,
  onSend,
  onSticker,
  onStop,
  streaming,
  disabled,
  placeholder,
  imageMode,
  webMode,
  onImageMode,
  onWebMode,
  files,
  onFiles,
  reasoning,
  onReasoning,
  reasoningMode = "auto",
  ask,
  onAsk,
  modelSlot,
  roleSlot,
  roleLabel,
  endSlot,
  captureFiles = true,
  onCall,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onSticker?: (body: string) => void;
  onStop: () => void;
  streaming: boolean;
  disabled?: boolean;
  placeholder: string;
  imageMode: boolean;
  webMode: boolean;
  onImageMode: (value: boolean) => void;
  onWebMode: (value: boolean) => void;
  files: ChatFile[];
  onFiles: (files: ChatFile[]) => void;
  reasoning?: boolean;
  onReasoning?: (value: boolean) => void;
  reasoningMode?: "auto" | "always" | "never";
  ask?: boolean;
  onAsk?: (value: boolean) => void;
  modelSlot?: ReactNode;
  roleSlot?: ReactNode | ((close: () => void, roomy?: boolean) => ReactNode);
  roleLabel?: string;
  endSlot?: ReactNode;
  captureFiles?: boolean;
  onCall?: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const uploadAbort = useRef<AbortController | null>(null);
  const sentAt = useRef(0);
  const filesRef = useRef(files);
  filesRef.current = files;
  const queue = useRef(attachmentQueue());
  const pendingRef = useRef(0);
  const cancelled = useRef(0);
  const alive = useRef(true);
  const [processing, setProcessing] = useState(false);
  const [callMode, setCallMode] = useState(false);
  useEffect(() => {
    try {
      setCallMode(localStorage.getItem("vvvion.voice.mode") === "call");
    } catch {
      /* optional preference */
    }
  }, []);
  function switchVoiceMode() {
    const next = !callMode;
    setCallMode(next);
    try {
      localStorage.setItem("vvvion.voice.mode", next ? "call" : "dictation");
    } catch {
      /* optional preference */
    }
    toast(
      next
        ? "Режим звонка. Нажмите трубку, чтобы начать."
        : "Режим диктофона. Нажмите микрофон для записи.",
    );
  }
  useEffect(() => {
    const cancellation = cancelled;
    alive.current = true;
    return () => {
      alive.current = false;
      cancellation.current++;
      uploadAbort.current?.abort();
    };
  }, []);
  function changeFiles(next: ChatFile[]) {
    filesRef.current = next;
    onFiles(next);
  }
  function cancelUpload() {
    cancelled.current++;
    uploadAbort.current?.abort();
  }

  const [upload, setUpload] = useState<UploadView | null>(null);
  const [more, setMore] = useState(false);
  const [roles, setRoles] = useState(false);
  const [stickers, setStickers] = useState(false);
  useEffect(() => {
    if (!roles) return;
    const onDown = (event: PointerEvent) => {
      const node = formRef.current;
      if (!node || !(event.target instanceof Node) || node.contains(event.target)) return;
      setRoles(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRoles(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [roles]);
  const lang = useLang();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const resize = () => {
      el.style.height = "0px";
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const cap = Math.min(200, viewportHeight * 0.3);
      el.style.height = `${Math.min(el.scrollHeight, cap)}px`;
    };
    resize();
    window.visualViewport?.addEventListener("resize", resize);
    window.addEventListener("resize", resize);
    return () => {
      window.visualViewport?.removeEventListener("resize", resize);
      window.removeEventListener("resize", resize);
    };
  }, [value]);

  function fire() {
    const now = Date.now();
    if (now - sentAt.current < 350) return;
    if (streaming || disabled || pendingRef.current) return;
    if (!value.trim() && files.length === 0) return;
    sentAt.current = now;
    onSend();
    ref.current?.focus();
  }

  const empty = !value.trim() && files.length === 0;

  function takeFiles(list: File[]) {
    if (disabled || !captureFiles) return Promise.resolve(0);
    const generation = cancelled.current;
    pendingRef.current++;
    setProcessing(true);
    return queue.current(async () => {
      let added = 0;
      try {
        for (const file of list) {
          if (!alive.current || generation !== cancelled.current) break;
          if (filesRef.current.length >= CHAT_FILE_COUNT) {
            toast(ui(lang, "tooManyFiles"));
            break;
          }
          if (file.size > CHAT_FILE_MAX) {
            toast.error(ui(lang, "fileTooBig"));
            continue;
          }
          const ctrl = new AbortController();
          uploadAbort.current = ctrl;
          setUpload({ name: file.name, ratio: 0, loaded: 0, total: file.size, speed: 0 });
          try {
            const read = await readChatFile(file);
            ctrl.signal.throwIfAborted();
            if (read.kind === "file") {
              const saved = await uploadChatFile(
                file,
                (tick) => {
                  if (alive.current) setUpload({ name: file.name, ...tick });
                },
                ctrl.signal,
              );
              read.id = saved.id;
              read.url = `/api/circle-file/${saved.id}`;
            }
            ctrl.signal.throwIfAborted();
            if (!alive.current || generation !== cancelled.current) break;
            changeFiles([...filesRef.current, read].slice(0, CHAT_FILE_COUNT));
            added++;
          } catch (err) {
            if (!ctrl.signal.aborted && alive.current)
              toast.error(err instanceof Error ? err.message : ui(lang, "fileRejected"));
          } finally {
            uploadAbort.current = null;
          }
        }
        return added;
      } finally {
        pendingRef.current--;
        if (alive.current) {
          setProcessing(pendingRef.current > 0);
          setUpload(null);
        }
      }
    });
  }
  const locked = Boolean(disabled || streaming || processing);
  const attachLocked = Boolean(disabled || processing);
  const toolClass =
    "composer-tool press inline-flex size-11 shrink-0 items-center justify-center rounded-xl border border-transparent text-muted transition-colors hover:bg-subtle hover:text-fg disabled:opacity-40";
  const deepLabel = `${lang === "ru" ? "Рассуждение" : lang === "kk" ? "Ойлау" : "Reasoning"} · ${reasonLabel(lang, reasoningMode, Boolean(reasoning))}`;
  const voice = (file: ChatFile) => {
    if (filesRef.current.length >= CHAT_FILE_COUNT) {
      toast.error(ui(lang, "tooManyFiles"));
      return;
    }
    changeFiles([...filesRef.current, file]);
  };

  return (
    <form
      ref={formRef}
      data-vv-upload=""
      data-tour="composer"
      className="composer-surface relative min-w-0 rounded-3xl border border-line bg-elev p-2 shadow-[var(--shadow)] transition-[border-color,box-shadow] duration-200 focus-within:border-accent/70"
      onDragOver={(event) => {
        if (captureFiles && event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          event.dataTransfer.dropEffect = attachLocked ? "none" : "copy";
        }
      }}
      onDrop={(event) => {
        if (!captureFiles || !event.dataTransfer.files.length) return;
        event.preventDefault();
        event.stopPropagation();
        if (!attachLocked) void takeFiles([...event.dataTransfer.files]);
      }}
      onSubmit={(event) => {
        event.preventDefault();
        fire();
      }}
    >
      {roles && roleSlot ? (
        <div className="absolute bottom-[calc(100%+0.6rem)] left-0 z-30 hidden w-full lg:block">
          <div
            role="dialog"
            aria-label="Роли"
            className="max-h-[min(70dvh,34rem)] overflow-y-auto rounded-3xl border border-line bg-elev p-3 shadow-[var(--shadow)]"
          >
            <div className="mb-3 flex items-start justify-between gap-3 px-1">
              <div>
                <p className="font-serif text-2xl tracking-tight">Роли</p>
                <p className="mt-1 text-sm text-muted">
                  Только персонаж и его описание. Файл, сеть, картинка и модель остаются в строке
                  ввода.
                </p>
              </div>
              <button
                type="button"
                className="press grid size-9 shrink-0 place-items-center rounded-xl text-muted"
                aria-label="Закрыть"
                onClick={() => setRoles(false)}
              >
                <X className="size-4" />
              </button>
            </div>
            {typeof roleSlot === "function" ? roleSlot(() => setRoles(false), true) : roleSlot}
          </div>
        </div>
      ) : null}
      {stickers && onSticker ? (
        <div className="mb-2">
          <StickerPicker
            ai
            disabled={locked}
            onClose={() => setStickers(false)}
            onPick={(code) => {
              setStickers(false);
              onSticker(stickerBody(code));
            }}
          />
        </div>
      ) : null}
      {files.length > 0 ? (
        <div className="flex flex-wrap gap-1 px-1 pb-1">
          {files.map((file) => (
            <button
              key={file.id}
              type="button"
              className="press inline-flex h-8 max-w-full items-center gap-1 rounded-full border border-line px-2 text-xs"
              aria-label={`${lang === "ru" ? "Убрать файл" : lang === "kk" ? "Файлды алып тастау" : "Remove file"}: ${file.name}`}
              onClick={() => changeFiles(filesRef.current.filter((item) => item.id !== file.id))}
            >
              <span className="truncate">{file.name}</span>
              <X className="size-3 shrink-0" />
            </button>
          ))}
        </div>
      ) : null}
      {upload ? (
        <div className="px-1 pb-1">
          <div className="flex justify-end">
            <button
              type="button"
              className="press h-8 rounded-xl px-2 text-xs text-muted"
              onClick={cancelUpload}
            >
              Отменить
            </button>
          </div>
          <UploadMeter view={upload} />
        </div>
      ) : null}
      {imageMode || webMode ? (
        <div className="mb-1 flex flex-wrap gap-1 px-1 lg:hidden">
          {webMode ? (
            <button
              type="button"
              className="press inline-flex h-8 items-center gap-1 rounded-full border border-accent bg-subtle px-2 text-xs"
              onClick={() => onWebMode(false)}
            >
              {ui(lang, "web")}
              <X className="size-3" />
            </button>
          ) : null}
          {imageMode ? (
            <button
              type="button"
              className="press inline-flex h-8 items-center gap-1 rounded-full border border-accent bg-subtle px-2 text-xs"
              onClick={() => onImageMode(false)}
            >
              {ui(lang, "image")}
              <X className="size-3" />
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="flex items-end gap-1">
        <textarea
          ref={ref}
          id="composer"
          rows={1}
          value={value}
          disabled={disabled}
          aria-label={ui(lang, "messageAria")}
          placeholder={placeholder}
          className="max-h-[min(200px,30dvh)] min-h-14 min-w-0 w-full flex-1 resize-none rounded-2xl border-0 bg-transparent px-3 py-2.5 text-base shadow-none outline-none ring-0 placeholder:text-faint focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 disabled:opacity-60"
          onChange={(event) => onChange(event.target.value)}
          onPaste={(event) => {
            const data = event.clipboardData;
            if (!data || !captureFiles) return;
            if (data.files.length) {
              event.preventDefault();
              event.stopPropagation();
              if (!attachLocked) void takeFiles([...data.files]);
              return;
            }
            const text = data.getData("text/plain");
            if (!pasteAsFile(text) || locked) return;
            event.preventDefault();
            const file = new File([text], "Вставленный текст.txt", { type: "text/plain" });
            void takeFiles([file]).then((added) => {
              if (added) toast("Большой текст приложен файлом");
            });
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === "Escape" && (more || roles)) {
              event.preventDefault();
              setMore(false);
              setRoles(false);
              return;
            }
            if (event.key === "Escape" && streaming) {
              event.preventDefault();
              onStop();
              return;
            }
            if (
              composerSubmitKey(
                {
                  key: event.key,
                  shiftKey: event.shiftKey,
                  ctrlKey: event.ctrlKey,
                  metaKey: event.metaKey,
                  keyCode: event.keyCode,
                  isComposing: event.nativeEvent.isComposing,
                },
                window.matchMedia("(pointer: coarse)").matches,
              )
            ) {
              event.preventDefault();
              fire();
            }
          }}
        />
        {onSticker && !imageMode ? (
          <button
            type="button"
            className={cn(
              toolClass,
              "mb-1 rounded-xl",
              stickers && "border-accent/30 bg-accent/10 text-accent",
            )}
            aria-label="Стикеры"
            aria-pressed={stickers}
            disabled={locked}
            onClick={() => setStickers((v) => !v)}
          >
            <Smile className="size-5" />
          </button>
        ) : null}
      </div>
      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            className={cn(toolClass, "lg:hidden", more && "bg-accent/10 text-accent")}
            aria-label="Ещё"
            aria-expanded={more}
            onClick={() => {
              setRoles(false);
              setMore((v) => !v);
            }}
          >
            <Plus className="size-5" strokeWidth={1.8} />
          </button>
          {!imageMode && captureFiles ? (
            <button
              type="button"
              className={cn(toolClass, "hidden lg:inline-flex")}
              aria-label={ui(lang, "attach")}
              title={ui(lang, "attach")}
              disabled={attachLocked || files.length >= CHAT_FILE_COUNT}
              onClick={() => fileRef.current?.click()}
            >
              <Paperclip className="size-5" strokeWidth={1.8} />
            </button>
          ) : null}
          <MicButton
            className="composer-tool rounded-xl"
            value={value}
            onChange={onChange}
            disabled={locked}
            onVoice={voice}
            callMode={Boolean(onCall && callMode)}
            onCall={onCall}
            onMode={onCall ? switchVoiceMode : undefined}
          />
          <div data-composer-tools className="hidden items-center gap-0.5 lg:flex">
            <ModeButton
              pressed={imageMode}
              disabled={locked}
              label={ui(lang, "image")}
              onClick={() => onImageMode(!imageMode)}
            >
              <ImageIcon className="size-5" strokeWidth={1.8} />
            </ModeButton>
            <ModeButton
              pressed={webMode}
              disabled={locked}
              label={ui(lang, "webSearch")}
              onClick={() => onWebMode(!webMode)}
            >
              <Globe className="size-5" strokeWidth={1.8} />
            </ModeButton>
            {onReasoning ? (
              <ModeButton
                pressed={reasoningMode !== "never" && Boolean(reasoning)}
                disabled={locked || reasoningMode === "never"}
                label={deepLabel}
                onClick={() => onReasoning(!reasoning)}
              >
                <Brain className="size-5" strokeWidth={1.8} />
              </ModeButton>
            ) : null}
            {onAsk ? (
              <ModeButton
                pressed={Boolean(ask)}
                disabled={locked}
                label={ui(lang, ask ? "askOn" : "askOff")}
                onClick={() => onAsk(!ask)}
              >
                <MessageCircleQuestion className="size-5" strokeWidth={1.8} />
              </ModeButton>
            ) : null}
          </div>
        </div>
        <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-1.5">
          {roleSlot ? (
            <button
              type="button"
              disabled={locked}
              aria-label="Роли"
              aria-expanded={roles}
              onClick={() => {
                setMore(false);
                setRoles((v) => !v);
              }}
              className={cn(
                toolClass,
                "hidden w-auto max-w-36 gap-1.5 px-2.5 text-sm lg:inline-flex",
                roleLabel && "bg-accent/10 text-accent",
              )}
            >
              <UserRound className="size-[18px] shrink-0" />
              <span className="truncate">{roleLabel || "Роль"}</span>
            </button>
          ) : null}
          {endSlot ? <div className="min-w-0 flex-1 lg:max-w-[14rem]">{endSlot}</div> : null}
          {streaming ? (
            <button
              type="button"
              className="press grid size-11 shrink-0 place-items-center rounded-2xl bg-fg text-bg"
              onClick={onStop}
              aria-label={ui(lang, "stop")}
              title={`${ui(lang, "stop")} · Esc`}
            >
              <Square className="size-4 fill-current" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={disabled || processing || empty}
              className="press grid size-11 shrink-0 place-items-center rounded-2xl bg-accent text-accent-fg transition-opacity disabled:opacity-35"
              aria-label={ui(lang, "send")}
              title={ui(lang, "send")}
            >
              <ArrowUp className="size-5" strokeWidth={2.2} />
            </button>
          )}
        </div>
      </div>
      {captureFiles ? (
        <input
          ref={fileRef}
          id="chat-file"
          type="file"
          className="hidden"
          multiple
          onChange={(event) => {
            const list = event.target.files;
            if (!list?.length) return;
            void takeFiles([...list]);
            event.target.value = "";
          }}
        />
      ) : null}
      {more ? (
        <MoreSheet onClose={() => setMore(false)}>
          {onCall ? (
            <ToolRow
              icon={<Phone className="size-4" />}
              title="Голосовой звонок"
              hint="Разговор с выбранной моделью"
              disabled={locked}
              onClick={() => {
                setMore(false);
                onCall();
              }}
            />
          ) : null}
          {imageMode ? null : (
            <ToolRow
              icon={<Paperclip className="size-4" />}
              title="Файл"
              hint="В сообщение"
              disabled={attachLocked || !captureFiles || files.length >= CHAT_FILE_COUNT}
              onClick={() => {
                setMore(false);
                fileRef.current?.click();
              }}
            />
          )}
          <ToolRow
            icon={<ImageIcon className="size-4" />}
            title="Картинка"
            hint="Ответ будет изображением"
            pressed={imageMode}
            disabled={locked}
            onClick={() => onImageMode(!imageMode)}
          />
          <ToolRow
            icon={<Globe className="size-4" />}
            title="Поиск в сети"
            hint="Ответ со ссылками"
            pressed={webMode}
            disabled={locked}
            onClick={() => onWebMode(!webMode)}
          />
          {onReasoning ? (
            <ToolRow
              icon={<Brain className="size-4" />}
              title="Ход мысли"
              hint={reasonLabel(lang, reasoningMode, Boolean(reasoning))}
              pressed={reasoningMode !== "never" && Boolean(reasoning)}
              disabled={locked || reasoningMode === "never"}
              onClick={() => {
                if (reasoningMode === "never") return;
                onReasoning(!reasoning);
              }}
            />
          ) : null}
          {onAsk ? (
            <ToolRow
              icon={<MessageCircleQuestion className="size-4" />}
              title="Уточняющие вопросы"
              hint={ask ? "Включены" : "Выключены"}
              pressed={Boolean(ask)}
              disabled={locked}
              onClick={() => onAsk(!ask)}
            />
          ) : null}
          {modelSlot ? (
            <div className="mt-1 border-t border-line pt-1">
              <p className="px-2 pt-2 text-[11px] font-medium tracking-[0.14em] text-faint uppercase">
                Модель
              </p>
              {modelSlot}
            </div>
          ) : null}
          {typeof roleSlot === "function" ? roleSlot(() => setMore(false)) : roleSlot}
        </MoreSheet>
      ) : null}
    </form>
  );
}

function ToolRow({
  disabled,
  icon,
  title,
  hint,
  pressed,
  onClick,
}: {
  disabled?: boolean;
  icon: ReactNode;
  title: string;
  hint?: string;
  pressed?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      className="disabled:opacity-40 flex min-h-[3.25rem] w-full items-center gap-3 rounded-2xl px-1.5 text-left hover:bg-subtle"
      onClick={onClick}
    >
      <span
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-2xl border",
          pressed ? "border-accent bg-accent text-accent-fg" : "border-line bg-bg text-muted",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        {hint ? <span className="block truncate text-xs text-faint">{hint}</span> : null}
      </span>
      {pressed == null ? null : (
        <span
          className={cn(
            "relative h-6 w-10 shrink-0 rounded-full p-0.5",
            pressed ? "bg-accent" : "bg-line",
          )}
          aria-hidden="true"
        >
          <span
            className={cn(
              "block size-5 rounded-full bg-elev shadow-sm",
              pressed ? "translate-x-4" : "translate-x-0",
            )}
          />
        </span>
      )}
    </button>
  );
}

function MoreSheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const startX = useRef(0);
  const startT = useRef(0);
  const dragging = useRef(false);
  useEffect(() => setNode(document.body), []);
  useEffect(() => {
    if (!node) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sheetRef.current?.querySelector<HTMLElement>("button")?.focus();
    return () => previous?.focus();
  }, [node]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!node) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-end bg-black/50 lg:justify-end lg:p-5"
      onClick={onClose}
    >
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="Ещё"
        className="vv-enter relative max-h-[min(80dvh,32rem)] w-full overflow-y-auto rounded-t-3xl border-t border-line bg-elev px-2 pt-2 pb-[max(0.85rem,env(safe-area-inset-bottom))] shadow-[var(--shadow)] lg:max-h-[85dvh] lg:max-w-md lg:rounded-3xl lg:border"
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="flex touch-none justify-center py-1.5"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            try {
              event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
              /* the sheet is already gone */
            }
            startY.current = event.clientY;
            startX.current = event.clientX;
            startT.current = performance.now();
            dragging.current = true;
          }}
          onPointerUp={(event) => {
            if (!dragging.current) return;
            dragging.current = false;
            const dy = event.clientY - startY.current;
            const dx = event.clientX - startX.current;
            const dt = Math.max(1, performance.now() - startT.current);
            if (Math.abs(dx) > 24) return;
            if ((dy >= 96 && dy / dt >= 0.4) || dy >= 160) onClose();
          }}
          onPointerCancel={() => {
            dragging.current = false;
          }}
        >
          <span className="h-1 w-10 rounded-full bg-line-strong" />
        </div>
        <div className="mb-1 flex items-center justify-between px-1.5">
          <p className="text-[11px] font-medium tracking-[0.16em] text-faint uppercase">Ещё</p>
          <button
            type="button"
            className="press grid size-9 place-items-center rounded-xl text-muted"
            aria-label="Закрыть"
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    node,
  );
}

function ModeButton({
  disabled,
  pressed,
  label,
  onClick,
  children,
}: {
  disabled?: boolean;
  pressed: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      disabled={disabled}
      className={cn(
        "composer-tool press inline-flex size-11 shrink-0 items-center justify-center rounded-xl border transition-colors disabled:opacity-35",
        pressed
          ? "border-accent/30 bg-accent/10 text-accent"
          : "border-transparent bg-transparent text-muted hover:bg-subtle hover:text-fg",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
