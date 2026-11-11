import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowUp, Brain, Globe, ImageIcon, MessageCircleQuestion, Paperclip, Plus, Square, X } from "lucide-react";
import { toast } from "sonner";
import { MicButton } from "@/components/yaronetic/mic-button";
import { HoldHint } from "@/components/yaronetic/hold-hint";
import { CHAT_FILE_COUNT, CHAT_FILE_MAX, readChatFile } from "@/lib/ai/attach";
import { uploadChatFile } from "@/lib/social/circle-upload";
import { UploadMeter, type UploadView } from "@/components/yaronetic/upload-meter";
import type { ChatFile } from "@/lib/ai/types";
import { cn } from "@/lib/utils";
import { ui } from "@/lib/i18n";
import { useLang } from "@/lib/lang";

export function Composer({
  value,
  onChange,
  onSend,
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
  ask,
  onAsk,
  modelSlot,
  endSlot,
  captureFiles = true,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
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
  ask?: boolean;
  onAsk?: (value: boolean) => void;
  modelSlot?: ReactNode;
  endSlot?: ReactNode;
  captureFiles?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadAbort = useRef<AbortController | null>(null);
  const sentAt = useRef(0);
  const [upload, setUpload] = useState<UploadView | null>(null);
  const [more, setMore] = useState(false);
  const lang = useLang();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    const cap = Math.min(200, window.innerHeight * 0.3);
    el.style.height = `${Math.min(el.scrollHeight, cap)}px`;
  }, [value]);

  function fire() {
    const now = Date.now();
    if (now - sentAt.current < 350) return;
    if (streaming || disabled || upload) return;
    if (!value.trim() && files.length === 0) return;
    sentAt.current = now;
    onSend();
    ref.current?.focus();
  }

  const empty = !value.trim() && files.length === 0;

  return (
    <form
      className="rounded-[1.75rem] border border-line bg-elev p-1.5 shadow-[var(--shadow)] focus-within:border-accent"
      onSubmit={(event) => {
        event.preventDefault();
        fire();
      }}
    >
      {files.length > 0 ? (
        <div className="flex flex-wrap gap-1 px-1 pb-1">
          {files.map((file) => (
            <button
              key={file.id}
              type="button"
              className="press inline-flex h-8 max-w-full items-center gap-1 rounded-full border border-line px-2 text-xs"
              onClick={() => onFiles(files.filter((item) => item.id !== file.id))}
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
            <button type="button" className="press h-8 rounded-xl px-2 text-xs text-muted" onClick={() => uploadAbort.current?.abort()}>
              Отменить
            </button>
          </div>
          <UploadMeter view={upload} />
        </div>
      ) : null}
      {imageMode || webMode ? (
        <div className="mb-1 flex flex-wrap gap-1 px-1 lg:hidden">
          {webMode ? (
            <button type="button" className="press inline-flex h-8 items-center gap-1 rounded-full border border-accent bg-subtle px-2 text-xs" onClick={() => onWebMode(false)}>
              {ui(lang, "web")}
              <X className="size-3" />
            </button>
          ) : null}
          {imageMode ? (
            <button type="button" className="press inline-flex h-8 items-center gap-1 rounded-full border border-accent bg-subtle px-2 text-xs" onClick={() => onImageMode(false)}>
              {ui(lang, "image")}
              <X className="size-3" />
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="flex items-end gap-1">
        <button
          type="button"
          className="press mb-0.5 inline-flex size-11 shrink-0 items-center justify-center rounded-2xl border border-line text-muted lg:hidden"
          aria-label="Ещё"
          aria-expanded={more}
          onClick={() => setMore((open) => !open)}
        >
          <Plus className="size-5" />
        </button>
        <textarea
          ref={ref}
          id="composer"
          rows={1}
          value={value}
          disabled={disabled}
          aria-label={ui(lang, "messageAria")}
          placeholder={placeholder}
          className="max-h-[min(200px,30dvh)] min-h-11 w-full flex-1 resize-none rounded-2xl border-0 bg-transparent px-3 py-2.5 text-base shadow-none outline-none ring-0 placeholder:text-faint focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 disabled:opacity-60"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              fire();
            }
          }}
        />
        <div className="mb-0.5 shrink-0">
          {streaming ? (
            <button type="button" className="press inline-flex size-11 items-center justify-center rounded-full bg-fg text-bg lg:hidden" onClick={onStop} aria-label={ui(lang, "stop")} title="Стоп · Esc">
              <Square className="size-3.5 fill-current" />
            </button>
          ) : empty ? (
            <span className="lg:hidden">
              <MicButton
                value={value}
                onChange={onChange}
                disabled={disabled || streaming}
                onVoice={(file) => {
                  if (files.length >= CHAT_FILE_COUNT) {
                    toast.error(ui(lang, "tooManyFiles"));
                    return;
                  }
                  onFiles([...files, file]);
                }}
              />
            </span>
          ) : (
            <button
              type="submit"
              disabled={disabled || upload !== null || empty}
              className="press inline-flex size-11 items-center justify-center rounded-full bg-accent text-accent-fg disabled:opacity-40 lg:hidden"
              aria-label={ui(lang, "send")}
              onClick={(event) => {
                event.preventDefault();
                fire();
              }}
            >
              <ArrowUp className="size-5" />
            </button>
          )}
        </div>
      </div>
      <div className="mt-1 hidden items-center gap-1 px-1 lg:flex">
        <div data-composer-tools className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          {imageMode ? null : (
            <HoldHint text={ui(lang, "filesHint")}>
              <button
                type="button"
                className="press inline-flex size-10 items-center justify-center rounded-2xl border border-line text-muted"
                aria-label={ui(lang, "attach")}
                title={ui(lang, "attach")}
                disabled={disabled || files.length >= CHAT_FILE_COUNT || upload !== null}
                onClick={() => fileRef.current?.click()}
              >
                <Paperclip className="size-4" />
              </button>
            </HoldHint>
          )}
          <HoldHint text={ui(lang, "voiceHint")}>
            <MicButton
              value={value}
              onChange={onChange}
              disabled={disabled || streaming}
              onVoice={(file) => {
                if (files.length >= CHAT_FILE_COUNT) {
                  toast.error(ui(lang, "tooManyFiles"));
                  return;
                }
                onFiles([...files, file]);
              }}
            />
          </HoldHint>
          <HoldHint text={ui(lang, "imageHint")}>
            <ModeButton pressed={imageMode} label={ui(lang, "image")} onClick={() => onImageMode(!imageMode)}>
              <ImageIcon className="size-4" />
              <span className="hidden sm:inline">{ui(lang, "image")}</span>
            </ModeButton>
          </HoldHint>
          <HoldHint text={ui(lang, "webHint")}>
            <ModeButton pressed={webMode} label={ui(lang, "webSearch")} onClick={() => onWebMode(!webMode)}>
              <Globe className="size-4" />
              <span className="hidden sm:inline">{ui(lang, "web")}</span>
            </ModeButton>
          </HoldHint>
          {onReasoning ? (
            <button
              type="button"
              aria-pressed={Boolean(reasoning)}
              aria-label={reasoning ? ui(lang, "reasonOn") : ui(lang, "reasonOff")}
              title={reasoning ? ui(lang, "reasonOn") : ui(lang, "reasonOff")}
              className={cn("press inline-flex size-10 items-center justify-center rounded-2xl border", reasoning ? "border-accent bg-subtle text-fg" : "border-line text-faint")}
              onClick={() => onReasoning(!reasoning)}
            >
              <Brain className="size-4" />
            </button>
          ) : null}
          {onAsk ? (
            <button
              type="button"
              aria-pressed={Boolean(ask)}
              aria-label={ask ? ui(lang, "askOn") : ui(lang, "askOff")}
              title={ask ? ui(lang, "askOn") : ui(lang, "askOff")}
              className={cn("press inline-flex size-10 items-center justify-center rounded-2xl border", ask ? "border-accent bg-accent text-accent-fg" : "border-line text-faint")}
              onClick={() => onAsk(!ask)}
            >
              <MessageCircleQuestion className="size-4" />
            </button>
          ) : null}
        </div>
        {endSlot ? <div className="min-w-0 max-w-[16rem] shrink">{endSlot}</div> : null}
        <div className="shrink-0">
          {streaming ? (
            <button type="button" className="press inline-flex h-11 items-center gap-1 rounded-2xl bg-fg px-3 text-sm font-medium text-bg" onClick={onStop} aria-label={ui(lang, "stop")} title="Стоп · Esc">
              <Square className="size-3.5 fill-current" />
              {ui(lang, "stopShort")}
            </button>
          ) : (
            <button
              type="submit"
              disabled={disabled || upload !== null || empty}
              className="press inline-flex h-11 items-center gap-1 rounded-2xl bg-accent px-3 text-sm font-medium text-accent-fg disabled:opacity-40"
              aria-label={ui(lang, "send")}
              onClick={(event) => {
                event.preventDefault();
                fire();
              }}
            >
              <ArrowUp className="size-4" />
              {ui(lang, "send")}
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
          void (async () => {
            const next = [...files];
            for (const file of [...list]) {
              if (next.length >= CHAT_FILE_COUNT) {
                toast(ui(lang, "tooManyFiles"));
                break;
              }
              if (file.size > CHAT_FILE_MAX) {
                toast.error(ui(lang, "fileTooBig"));
                continue;
              }
              try {
                const read = await readChatFile(file);
                if (read.kind === "file") {
                  const ctrl = new AbortController();
                  uploadAbort.current = ctrl;
                  setUpload({ name: file.name, ratio: 0, loaded: 0, total: file.size, speed: 0 });
                  const saved = await uploadChatFile(file, (tick) => setUpload({ name: file.name, ...tick }), ctrl.signal);
                  read.id = saved.id;
                  read.url = `/api/circle-file/${saved.id}`;
                }
                next.push(read);
              } catch (err) {
                const message = err instanceof Error ? err.message : ui(lang, "fileRejected");
                if (message === "Загрузка отменена") toast("Загрузка отменена");
                else toast.error(message);
              } finally {
                uploadAbort.current = null;
                setUpload(null);
              }
            }
            onFiles(next.slice(0, CHAT_FILE_COUNT));
          })();
          event.target.value = "";
        }}
      />
      ) : null}
      {more ? (
        <MoreSheet onClose={() => setMore(false)}>
          {imageMode ? null : (
            <ToolRow
              icon={<Paperclip className="size-4" />}
              title="Файл"
              hint="В сообщение"
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
            onClick={() => onImageMode(!imageMode)}
          />
          <ToolRow
            icon={<Globe className="size-4" />}
            title="Поиск в сети"
            hint="Ответ со ссылками"
            pressed={webMode}
            onClick={() => onWebMode(!webMode)}
          />
          {onReasoning ? (
            <ToolRow
              icon={<Brain className="size-4" />}
              title="Ход мысли"
              hint={reasoning ? "Включён" : "Выключен"}
              pressed={Boolean(reasoning)}
              onClick={() => onReasoning(!reasoning)}
            />
          ) : null}
          {onAsk ? (
            <ToolRow
              icon={<MessageCircleQuestion className="size-4" />}
              title="Уточняющие вопросы"
              hint={ask ? "Включены" : "Выключены"}
              pressed={Boolean(ask)}
              onClick={() => onAsk(!ask)}
            />
          ) : null}
          {modelSlot ? (
            <div className="mt-1 border-t border-line pt-1">
              <p className="px-2 pt-2 text-[11px] font-medium tracking-[0.14em] text-faint uppercase">Модель</p>
              {modelSlot}
            </div>
          ) : null}
        </MoreSheet>
      ) : null}
    </form>
  );
}

function ToolRow({
  icon,
  title,
  hint,
  pressed,
  onClick,
}: {
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
      className="flex min-h-[3.25rem] w-full items-center gap-3 rounded-2xl px-1.5 text-left hover:bg-subtle"
      onClick={onClick}
    >
      <span className={cn("grid size-10 shrink-0 place-items-center rounded-2xl border", pressed ? "border-accent bg-accent text-accent-fg" : "border-line bg-bg text-muted")}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        {hint ? <span className="block truncate text-xs text-faint">{hint}</span> : null}
      </span>
      {pressed == null ? null : (
        <span className={cn("relative h-6 w-10 shrink-0 rounded-full p-0.5", pressed ? "bg-accent" : "bg-line")} aria-hidden="true">
          <span className={cn("block size-5 rounded-full bg-elev shadow-sm", pressed ? "translate-x-4" : "translate-x-0")} />
        </span>
      )}
    </button>
  );
}

function MoreSheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const startY = useRef(0);
  const startX = useRef(0);
  const startT = useRef(0);
  const dragging = useRef(false);
  useEffect(() => setNode(document.body), []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!node) return null;
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end bg-black/50 lg:hidden" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Ещё"
        className="relative max-h-[min(80dvh,32rem)] w-full overflow-y-auto rounded-t-3xl border-t border-line bg-elev px-2 pt-2 pb-[max(0.85rem,env(safe-area-inset-bottom))] shadow-[var(--shadow)]"
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
          <button type="button" className="press grid size-9 place-items-center rounded-xl text-muted" aria-label="Закрыть" onClick={onClose}>
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
  pressed,
  label,
  onClick,
  children,
}: {
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
      className={cn(
        "press inline-flex h-10 items-center gap-1.5 rounded-2xl border px-2.5 text-sm",
        pressed ? "border-accent bg-accent text-accent-fg" : "border-line bg-transparent text-muted",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}