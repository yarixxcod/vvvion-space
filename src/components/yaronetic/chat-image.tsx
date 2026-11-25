import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Loader2,
  Share2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { toast } from "sonner";
import { pushBackLayer } from "@/lib/app-back";
import { fetchImageFile, saveImageFile } from "@/lib/image-download";

export type ChatImageSource = { src: string; name: string; alt?: string };
export function ChatImage({
  src,
  name,
  alt,
  className = "max-h-64 max-w-full rounded-2xl object-contain",
}: ChatImageSource & { className?: string }) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <>
      {failed ? (
        <p className="text-sm text-muted">Картинка не открылась</p>
      ) : (
        <button
          type="button"
          aria-label={`Открыть изображение: ${name}`}
          className="group relative mt-1.5 block max-w-full overflow-hidden rounded-2xl text-left"
          onClick={() => setOpen(true)}
        >
          <img
            src={src}
            alt={alt || name}
            className={className}
            loading="lazy"
            decoding="async"
            onError={() => setFailed(true)}
          />
          <span
            className="pointer-events-none absolute right-2 bottom-2 grid size-9 place-items-center rounded-full bg-black/65 text-white shadow-sm"
            aria-hidden
          >
            <Download className="size-4" />
          </span>
        </button>
      )}
      {open ? <ImageViewer image={{ src, name, alt }} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** Shared by AI pictures, user attachments and private-chat photo stacks. */
export function ImageViewer({
  image,
  onClose,
  navigation,
}: {
  image: ChatImageSource;
  onClose: () => void;
  navigation?: { index: number; total: number; previous: () => void; next: () => void };
}) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState(false);
  const [sharing, setSharing] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    root.current?.focus();
    const pop = pushBackLayer(() => close.current());
    return () => {
      pop();
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setFile(null);
    setError("");
    if (!image.src) return () => controller.abort();
    void fetchImageFile(image.src, image.name, controller.signal)
      .then(setFile)
      .catch((err) => {
        if (!controller.signal.aborted)
          setError(err instanceof Error ? err.message : "Не удалось подготовить изображение");
      });
    return () => controller.abort();
  }, [image.src, image.name]);
  const canShare =
    file && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });
  async function share() {
    if (!file || sharing) return;
    setSharing(true);
    try {
      await navigator.share({ files: [file], title: image.name });
    } catch (err) {
      if (!(err instanceof Error && err.name === "AbortError"))
        toast.error("Не удалось поделиться изображением. Используйте «Скачать».");
    } finally {
      setSharing(false);
    }
  }
  return createPortal(
    <div
      ref={root}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={`Изображение: ${image.name}`}
      className="fixed inset-0 z-[120] flex flex-col bg-[#09090c] text-white outline-none"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
        if (event.key === "ArrowLeft" && navigation) {
          event.preventDefault();
          navigation.previous();
        }
        if (event.key === "ArrowRight" && navigation) {
          event.preventDefault();
          navigation.next();
        }
        if (event.key === "Tab") {
          const controls = [
            ...(root.current?.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]") ??
              []),
          ];
          const first = controls[0],
            last = controls.at(-1);
          if (
            event.shiftKey &&
            (document.activeElement === first || document.activeElement === root.current)
          ) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-white/15 px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-5">
        <p className="min-w-0 flex-1 truncate text-sm text-white/75">{image.name}</p>
        <button
          type="button"
          aria-label="Закрыть изображение"
          title="Закрыть · Esc"
          className="press grid size-11 place-items-center rounded-full bg-white/10 hover:bg-white/20"
          onClick={onClose}
        >
          <X className="size-5" />
        </button>
      </header>
      <div
        className={`flex min-h-0 flex-1 ${zoom ? "overflow-auto" : "items-center justify-center overflow-hidden"}`}
      >
        {image.src ? (
          <img
            src={image.src}
            alt={image.alt || image.name}
            className={zoom ? "m-auto max-w-none shrink-0" : "max-h-full max-w-full object-contain"}
          />
        ) : (
          <Loader2 aria-label="Загружаю фото" className="m-auto size-8 animate-spin" />
        )}
      </div>
      <footer className="shrink-0 border-t border-white/15 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
        {error ? (
          <div role="alert" className="mb-3 text-center text-sm text-rose-200">
            {error}.{" "}
            <a
              href={image.src}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-1 underline"
            >
              Открыть оригинал
              <ExternalLink className="size-4" />
            </a>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-center gap-2">
          {navigation ? (
            <>
              <button
                type="button"
                aria-label="Предыдущее фото"
                className="press grid size-11 place-items-center rounded-full bg-white/10"
                onClick={navigation.previous}
              >
                <ChevronLeft className="size-5" />
              </button>
              <span className="text-sm tabular-nums">
                {navigation.index + 1} / {navigation.total}
              </span>
              <button
                type="button"
                aria-label="Следующее фото"
                className="press grid size-11 place-items-center rounded-full bg-white/10"
                onClick={navigation.next}
              >
                <ChevronRight className="size-5" />
              </button>
            </>
          ) : null}
          <button
            type="button"
            disabled={!file}
            onClick={() => {
              if (file) {
                try {
                  saveImageFile(file);
                } catch {
                  toast.error("Не удалось сохранить изображение");
                }
              }
            }}
            className="press inline-flex min-h-11 items-center gap-2 rounded-full bg-[#c4b5e8] px-5 text-sm font-medium text-[#1b1526] disabled:opacity-50"
          >
            {!file && !error ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            {!file && !error ? "Готовлю оригинал…" : "Скачать"}
          </button>
          {canShare ? (
            <button
              type="button"
              disabled={sharing}
              onClick={() => void share()}
              className="press inline-flex min-h-11 items-center gap-2 rounded-full bg-white/10 px-4 text-sm"
            >
              <Share2 className="size-4" />
              Поделиться
            </button>
          ) : null}
          <button
            type="button"
            aria-label={zoom ? "Уместить изображение" : "Увеличить изображение"}
            title={zoom ? "Уместить" : "Увеличить"}
            aria-pressed={zoom}
            className="press grid size-11 place-items-center rounded-full bg-white/10"
            onClick={() => setZoom((v) => !v)}
          >
            {zoom ? <ZoomOut className="size-5" /> : <ZoomIn className="size-5" />}
          </button>
        </div>
      </footer>
    </div>,
    document.body,
  );
}
