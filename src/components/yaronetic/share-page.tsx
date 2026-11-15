import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowUpRight,
  ChevronRight,
  Download,
  FileText,
  Folder,
  ImageIcon,
  LoaderCircle,
  Music2,
  Play,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { FileVideo } from "@/components/yaronetic/fit-video";
import { Mark } from "@/components/yaronetic/mark";
import { Wordmark } from "@/components/yaronetic/wordmark";
import {
  downloadShared,
  sizeLabel,
  type DownloadProgress,
  type FileSink,
} from "@/lib/share-download";
import type { ShareEntry, SharePageData } from "@/lib/share-view";

type Pull = DownloadProgress & { id: string; name: string };
function countLabel(value: number, forms: [string, string, string]) {
  const last = value % 10;
  const teen = value % 100 >= 11 && value % 100 <= 14;
  return `${value} ${forms[teen ? 2 : last === 1 ? 0 : last >= 2 && last <= 4 ? 1 : 2]}`;
}

const SHARE_CACHE = "vvvion-share";
const CACHE_LIMIT = 48 * 1024 * 1024;

const spin = "size-5 animate-spin motion-reduce:animate-none";

function Loading({ label = "Загружаем…" }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-muted">
      <LoaderCircle className={spin} aria-hidden="true" />
      {label}
    </span>
  );
}

export function ShareLoading() {
  return (
    <div className="mx-auto min-h-dvh max-w-3xl px-5 pt-12" aria-busy="true">
      <Loading label="Открываем общую ссылку…" />
      <div className="mt-8 h-40 animate-pulse rounded-3xl border border-line bg-elev motion-reduce:animate-none" />
      <div className="mt-4 grid grid-cols-2 gap-3">
        {[0, 1, 2, 3].map((id) => (
          <div
            key={id}
            className="h-24 animate-pulse rounded-2xl bg-subtle motion-reduce:animate-none"
          />
        ))}
      </div>
    </div>
  );
}

async function openSink(name: string): Promise<FileSink | "cancel" | null> {
  const picker = window.matchMedia("(pointer: fine)").matches
    ? (
        window as unknown as {
          showSaveFilePicker?: (options: {
            suggestedName: string;
          }) => Promise<{ createWritable: () => Promise<FileSink> }>;
        }
      ).showSaveFilePicker
    : undefined;
  if (!picker) return null;
  try {
    return await (await picker({ suggestedName: name })).createWritable();
  } catch (error) {
    return error instanceof DOMException && error.name === "AbortError" ? "cancel" : null;
  }
}

function saveBlob(blob: Blob, name: string) {
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = name;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 120_000);
}

export function SharePage({ token, data }: { token: string; data: SharePageData }) {
  const navigate = useNavigate();
  const [opened, setOpened] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [pull, setPull] = useState<Pull | null>(null);
  const controller = useRef<AbortController | null>(null);
  const folderLock = useRef(false);
  useEffect(() => () => controller.current?.abort(), []);
  const file =
    data.file ?? data.entries.find((entry) => entry.id === opened && entry.kind === "file") ?? null;
  const folders = data.file ? [] : data.entries.filter((entry) => entry.kind === "folder");
  const files = data.file ? [] : data.entries.filter((entry) => entry.kind === "file");

  async function openFolder(id: string) {
    if (folderLock.current) return;
    folderLock.current = true;
    setOpened(null);
    setOpening(true);
    try {
      await navigate({
        to: "/d/$token",
        params: { token },
        search: { f: id === data.rootId ? undefined : id },
      });
    } catch {
      toast.error("Не удалось открыть папку. Попробуйте ещё раз.");
    } finally {
      folderLock.current = false;
      setOpening(false);
    }
  }

  async function save(entry: ShareEntry) {
    if (!entry.download || controller.current) return;
    const abort = new AbortController();
    controller.current = abort;
    setPull({ id: entry.id, name: entry.name, got: 0, total: entry.bytes, pct: null, speed: 0 });
    try {
      const absolute = new URL(entry.download, window.location.origin).href;
      if (entry.bytes > 0 && entry.bytes <= CACHE_LIMIT && "caches" in window) {
        try {
          const hit = await (await caches.open(SHARE_CACHE)).match(absolute);
          if (hit) {
            const cached = await hit.blob();
            abort.signal.throwIfAborted();
            if (cached.size === entry.bytes) {
              saveBlob(cached, entry.name);
              toast.success("Файл сохранён из кэша");
              return;
            }
          }
        } catch {
          /* Caching is optional; a fresh download remains available. */
        }
      }
      abort.signal.throwIfAborted();
      const sink = await openSink(entry.name);
      if (sink === "cancel") return;
      const blob = await downloadShared(
        entry.download,
        entry.bytes,
        abort.signal,
        (progress) => setPull({ ...progress, id: entry.id, name: entry.name }),
        sink,
      );
      if (blob) {
        saveBlob(blob, entry.name);
        if (blob.size > 0 && blob.size <= CACHE_LIMIT && "caches" in window) {
          void caches
            .open(SHARE_CACHE)
            .then((cache) =>
              cache.put(
                absolute,
                new Response(blob.slice(), {
                  headers: { "content-type": blob.type || "application/octet-stream" },
                }),
              ),
            )
            .catch(() => undefined);
        }
      }
      toast.success("Файл передан на сохранение");
    } catch (error) {
      if (!abort.signal.aborted)
        toast.error(error instanceof Error ? error.message : "Не удалось скачать файл");
    } finally {
      controller.current = null;
      setPull(null);
    }
  }

  return (
    <div className="min-h-dvh bg-bg">
      <main className="mx-auto w-full max-w-3xl px-4 pt-5 pb-16 sm:px-8">
        <header className="flex items-center justify-between gap-3">
          <Link to="/" className="press flex min-w-0 items-center gap-2.5">
            <Mark size={28} />
            <Wordmark />
          </Link>
          <Link
            to="/"
            className="press inline-flex min-h-11 items-center gap-1 rounded-full border border-line px-4 text-xs text-muted"
          >
            На сайт
            <ArrowUpRight className="size-3.5" />
          </Link>
        </header>
        <section className="relative mt-7 overflow-hidden rounded-3xl border border-accent/20 bg-elev p-5 sm:p-7">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-16 -right-10 size-56 rounded-full bg-accent/10 blur-3xl"
          />
          <div className="relative flex items-start gap-4">
            <div className="grid size-14 shrink-0 place-items-center rounded-2xl border border-accent/20 bg-accent/10 text-accent">
              {data.file ? <FileText className="size-7" /> : <Folder className="size-7" />}
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-medium tracking-[0.18em] text-accent uppercase">
                С вами поделились
              </p>
              <h1 className="mt-2 break-words font-serif text-3xl leading-tight sm:text-4xl">
                {data.title}
              </h1>
              <p className="mt-2 text-xs text-muted">
                {data.file
                  ? sizeLabel(data.file.bytes)
                  : `${countLabel(folders.length, ["папка", "папки", "папок"])} · ${countLabel(files.length, ["файл", "файла", "файлов"])}`}{" "}
                · Общий доступ
              </p>
            </div>
          </div>
        </section>
        {!data.file ? (
          <nav
            aria-label="Путь к папке"
            className="mt-5 flex flex-wrap items-center gap-1 text-xs text-muted"
          >
            {data.crumbs.map((crumb, i) => (
              <span key={crumb.id} className="inline-flex max-w-full items-center gap-1">
                {i > 0 ? <ChevronRight className="size-3 shrink-0 text-faint" /> : null}
                <button
                  type="button"
                  disabled={opening}
                  aria-current={i === data.crumbs.length - 1 ? "page" : undefined}
                  onClick={() => void openFolder(crumb.id)}
                  className="press min-h-10 max-w-52 truncate rounded-xl px-2 hover:bg-subtle disabled:opacity-50"
                >
                  {crumb.name}
                </button>
              </span>
            ))}
          </nav>
        ) : null}
        {pull ? (
          <section
            role="status"
            aria-live="polite"
            className="sticky top-3 z-10 mt-4 rounded-2xl border border-accent/30 bg-elev p-4 shadow-xl"
          >
            <div className="flex items-center gap-3">
              <LoaderCircle className={`${spin} shrink-0 text-accent`} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{pull.name}</p>
                <p className="mt-1 text-xs tabular-nums text-muted">
                  {pull.pct === null ? "Загружаем" : `${pull.pct}%`} · {sizeLabel(pull.got)}
                  {pull.total > 0 ? ` из ${sizeLabel(pull.total)}` : ""} ·{" "}
                  {sizeLabel(Math.round(pull.speed))}/с
                </p>
              </div>
              <button
                type="button"
                aria-label="Отменить скачивание"
                onClick={() => controller.current?.abort()}
                className="press grid size-11 shrink-0 place-items-center rounded-xl hover:bg-subtle"
              >
                <X className="size-4" />
              </button>
            </div>
            <div
              role="progressbar"
              aria-label="Скачивание файла"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pull.pct ?? undefined}
              className="mt-3 h-1.5 overflow-hidden rounded-full bg-line"
            >
              <div
                className={`h-full rounded-full bg-accent transition-[width] ${pull.pct === null ? "w-1/3 animate-pulse motion-reduce:animate-none" : ""}`}
                style={pull.pct === null ? undefined : { width: `${Math.max(2, pull.pct)}%` }}
              />
            </div>
          </section>
        ) : null}
        <div aria-busy={opening} className="relative mt-4">
          {opening ? (
            <div className="absolute inset-0 z-20 flex justify-center rounded-3xl bg-bg/85 pt-8 backdrop-blur-sm">
              <Loading label="Открываем папку…" />
            </div>
          ) : null}
          {file ? (
            <Preview
              key={file.view}
              entry={file}
              busy={Boolean(pull)}
              onSave={() => void save(file)}
              onClose={data.file ? undefined : () => setOpened(null)}
            />
          ) : null}
          {folders.length > 0 ? (
            <section className="mt-6">
              <h2 className="mb-3 text-xs font-medium text-faint">ПАПКИ</h2>
              <ul className="grid grid-cols-2 gap-2.5">
                {folders.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      disabled={opening}
                      onClick={() => void openFolder(entry.id)}
                      className="press flex min-h-24 w-full flex-col items-start rounded-2xl border border-line bg-elev p-4 text-left hover:border-accent/40"
                    >
                      <Folder className="size-7 text-accent" />
                      <span className="mt-3 line-clamp-2 w-full break-words text-sm">
                        {entry.name}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {files.length > 0 ? (
            <section className="mt-6">
              <h2 className="mb-3 text-xs font-medium text-faint">ФАЙЛЫ</h2>
              <ul className="space-y-2">
                {files.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-center gap-3 rounded-2xl border border-line bg-elev p-3"
                  >
                    <button
                      type="button"
                      className="press flex min-w-0 flex-1 items-center gap-3 text-left"
                      onClick={() => setOpened(entry.id)}
                    >
                      <span className="relative grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-accent/10 text-accent">
                        {entry.media === "image" ? (
                          <SharedImage
                            key={entry.view}
                            src={entry.view}
                            name={entry.name}
                            thumbnail
                          />
                        ) : entry.media === "audio" ? (
                          <Music2 className="size-6" />
                        ) : entry.media === "video" ? (
                          <Play className="size-6" />
                        ) : (
                          <FileText className="size-6" />
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm">{entry.name}</span>
                        <span className="mt-1 block text-xs text-faint">
                          {sizeLabel(entry.bytes)} ·{" "}
                          {entry.media === "image"
                            ? "Изображение"
                            : entry.media === "audio"
                              ? "Аудио"
                              : entry.media === "video"
                                ? "Видео"
                                : "Документ"}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Сохранить ${entry.name}`}
                      disabled={Boolean(pull)}
                      className="press grid size-11 shrink-0 place-items-center rounded-xl text-accent hover:bg-accent/10 disabled:opacity-40"
                      onClick={() => void save(entry)}
                    >
                      {pull?.id === entry.id ? (
                        <LoaderCircle className={spin} />
                      ) : (
                        <Download className="size-4" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {!data.file && data.entries.length === 0 ? (
            <div className="mt-8 rounded-3xl border border-dashed border-line py-14 text-center">
              <Folder className="mx-auto size-8 text-faint" />
              <p className="mt-3 text-sm text-muted">В этой папке пока ничего нет</p>
            </div>
          ) : null}
        </div>
        <p className="mt-8 text-center text-[11px] text-faint">
          Файлы доступны по ссылке. Для просмотра не нужна регистрация.
        </p>
      </main>
    </div>
  );
}

function SharedImage({
  src,
  name,
  thumbnail = false,
}: {
  src: string;
  name: string;
  thumbnail?: boolean;
}) {
  const ref = useRef<HTMLImageElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    if (ref.current?.complete) setState(ref.current.naturalWidth > 0 ? "ready" : "error");
  }, [src]);
  return (
    <span
      className={`relative block w-full overflow-hidden bg-subtle ${thumbnail ? "h-full" : "min-h-48"}`}
    >
      {state === "loading" ? (
        <span
          role="status"
          aria-label="Загружаем изображение"
          className="absolute inset-0 flex items-center justify-center text-accent"
        >
          <LoaderCircle className={spin} />
        </span>
      ) : null}
      {state === "error" ? (
        <span
          role="status"
          className="flex min-h-14 flex-col items-center justify-center gap-2 px-3 py-4 text-xs text-muted"
        >
          <ImageIcon className="size-5" />
          {thumbnail ? null : "Предпросмотр недоступен. Можно скачать файл."}
        </span>
      ) : null}
      <img
        ref={ref}
        src={src}
        alt={thumbnail ? "" : name}
        loading={thumbnail ? "lazy" : "eager"}
        onLoad={() => setState("ready")}
        onError={() => setState("error")}
        className={`${state === "error" ? "hidden" : ""} ${thumbnail ? "size-full object-cover" : "max-h-[65dvh] w-full object-contain"}`}
      />
    </span>
  );
}

function Preview({
  entry,
  busy,
  onSave,
  onClose,
}: {
  entry: ShareEntry;
  busy: boolean;
  onSave: () => void;
  onClose?: () => void;
}) {
  const [loading, setLoading] = useState(
    entry.media === "pdf" || entry.media === "audio" || entry.media === "video",
  );
  const [failed, setFailed] = useState(false);
  return (
    <figure className="mt-5 overflow-hidden rounded-3xl border border-accent/20 bg-elev">
      {onClose ? (
        <div className="flex items-center justify-between border-b border-line px-4 py-1">
          <span className="text-xs text-muted">Предпросмотр</span>
          <button
            type="button"
            className="press grid size-11 place-items-center"
            aria-label="Закрыть предпросмотр"
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </div>
      ) : null}
      {entry.media === "image" ? <SharedImage src={entry.view} name={entry.name} /> : null}
      {loading ? (
        <div className="px-5 py-4">
          <Loading label="Готовим предпросмотр…" />
        </div>
      ) : null}
      {failed ? (
        <p role="status" className="px-5 py-4 text-sm text-muted">
          Предпросмотр недоступен. Скачайте файл, чтобы открыть его на устройстве.
        </p>
      ) : null}
      <div
        onLoadedMetadataCapture={() => setLoading(false)}
        onErrorCapture={() => {
          setLoading(false);
          setFailed(true);
        }}
      >
        {entry.media === "video" ? <FileVideo src={entry.view} name={entry.name} /> : null}
        {entry.media === "audio" ? (
          <div className="flex items-center gap-3 p-5">
            <Music2 className="size-6 shrink-0 text-accent" />
            <audio controls preload="metadata" src={entry.view} className="h-11 w-full min-w-0" />
          </div>
        ) : null}
        {entry.media === "pdf" ? (
          <iframe
            title={entry.name}
            src={entry.view}
            onLoad={() => setLoading(false)}
            className="h-[60dvh] w-full bg-white"
          />
        ) : null}
      </div>
      {entry.media === "file" ? (
        <div className="grid place-items-center gap-3 px-5 py-10 text-muted">
          <FileText className="size-10 text-accent" />
          <p className="text-xs">Скачайте файл, чтобы открыть его</p>
        </div>
      ) : null}
      <figcaption className="flex flex-wrap items-center gap-3 border-t border-line p-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm">{entry.name}</p>
          <p className="mt-1 text-xs text-faint">{sizeLabel(entry.bytes)}</p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={onSave}
          className="press inline-flex min-h-11 items-center gap-2 rounded-full bg-accent px-4 text-sm font-medium text-accent-fg disabled:opacity-40"
        >
          <Download className="size-4" />
          Сохранить
        </button>
      </figcaption>
    </figure>
  );
}
