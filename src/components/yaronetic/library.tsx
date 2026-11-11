import { useEffect, useRef, useState } from "react";
import { BookOpen, ChevronLeft, ChevronRight, Clapperboard, Gamepad2, List, Maximize2, Minimize2, Minus, Plus, Search, Share2, Trash2, Upload, X } from "lucide-react";
import { BackButton } from "@/components/yaronetic/back-button";
import { toast } from "sonner";
import { PageLoader } from "@/components/yaronetic/page-loader";
import { PersonFace } from "@/components/yaronetic/person-face";
import { getBearerToken } from "@/lib/auth/client";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { parseBookBytes } from "@/lib/books/parse";
import { listShelf, removeShelfBook, saveShelfProgress, shareShelfBook } from "@/lib/books/shelf";
import { clearJump, readJump } from "@/lib/jump";
import { useCircleNest } from "@/lib/circle-history";
import { useEdgeBack } from "@/lib/gestures/use-edge-back";
import type { BookChapter, ShelfBook } from "@/lib/books/types";
import { previewPathPrefix } from "@/lib/preview-path-prefix";
import { Screen } from "@/components/yaronetic/screen";
import { Games } from "@/components/yaronetic/merge-game";
import { cn } from "@/lib/utils";

const PAPERS = [
  { id: "day", label: "Бумага" },
  { id: "sepia", label: "Сепия" },
  { id: "night", label: "Ночь" },
] as const;

type Paper = (typeof PAPERS)[number]["id"];

const SIZE_KEY = "yaronetic.readSize";
const PAPER_KEY = "yaronetic.readPaper";

export function Library() {
  const me = useCurrentUser();
  const [books, setBooks] = useState<ShelfBook[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<ShelfBook | null>(null);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [room, setRoom] = useState<"read" | "watch" | "play">("read");

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("vv-circle-nested", { detail: Boolean(open) }));
    return () => {
      window.dispatchEvent(new CustomEvent("vv-circle-nested", { detail: false }));
    };
  }, [open]);
  useCircleNest(Boolean(open), () => setOpen(null));

  async function share(book: ShelfBook) {
    try {
      const { token } = await shareShelfBook({ data: { id: book.id } });
      const prefix = previewPathPrefix(window.location.hostname, window.location.pathname) ?? "";
      const url = `${window.location.origin}${prefix}/b/${token}`;
      setShareUrl(url);
      try {
        await navigator.clipboard.writeText(url);
        toast("Ссылка на книгу скопирована");
      } catch {
        toast("Ссылка готова — скопируйте её");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось создать ссылку");
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  async function refresh(q = debounced) {
    setBooks(await listShelf({ data: { q } }));
    setError(null);
  }

  useEffect(() => {
    if (!me) return;
    let cancelled = false;
    void listShelf({ data: { q: debounced } })
      .then((rows) => {
        if (!cancelled) {
          setBooks(rows);
          setError(null);
        }
      })
      .catch(() => {
        if (!cancelled) setError("Полка сейчас недоступна");
      });
    return () => {
      cancelled = true;
    };
  }, [me, debounced]);

  useEffect(() => {
    let dead = false;
    function take() {
      const jump = readJump();
      if (!jump?.book) return;
      const id = jump.book;
      clearJump();
      setRoom("read");
      void listShelf({ data: { q: "" } })
        .then((rows) => {
          if (dead) return;
          const book = rows.find((row) => row.id === id);
          if (book) setOpen(book);
        })
        .catch(() => undefined);
    }
    take();
    window.addEventListener("vvvion-jump", take);
    return () => {
      dead = true;
      window.removeEventListener("vvvion-jump", take);
    };
  }, []);

  if (!me) return null;

  if (open) {
    return (
      <Reader
        book={open}
        onClose={() => {
          setOpen(null);
          void refresh().catch(() => undefined);
        }}
        onDrop={
          open.removable
            ? async () => {
                await removeShelfBook({ data: { id: open.id } });
                setOpen(null);
                await refresh();
                toast("Книга убрана с общей полки");
              }
            : undefined
        }
        onShare={() => void share(open)}
        onProgress={(chapter, ratio) => {
          setBooks((current) => current?.map((item) => (item.id === open.id ? { ...item, chapter, ratio } : item)) ?? current);
        }}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-4 pt-3">
        <div role="tablist" aria-label="Читальня, смотрельня и игры" className="grid grid-cols-3 gap-1 rounded-[1.35rem] border border-line bg-bg p-1">
          <button
            type="button"
            role="tab"
            aria-selected={room === "read"}
            className={cn(
              "press flex h-[3.35rem] flex-col items-center justify-center rounded-2xl",
              room === "read" ? "bg-accent text-accent-fg" : "text-muted",
            )}
            onClick={() => setRoom("read")}
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              <BookOpen className="size-4" aria-hidden="true" />
              Читальня
            </span>
            <span className={cn("text-xs leading-none", room === "read" ? "text-accent-fg/75" : "text-faint")}>Книги на полке</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={room === "watch"}
            className={cn(
              "press flex h-[3.35rem] flex-col items-center justify-center rounded-2xl",
              room === "watch" ? "bg-accent text-accent-fg" : "text-muted",
            )}
            onClick={() => setRoom("watch")}
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              <Clapperboard className="size-4" aria-hidden="true" />
              Смотрельня
            </span>
            <span className={cn("text-xs leading-none", room === "watch" ? "text-accent-fg/75" : "text-faint")}>Ролики здесь</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={room === "play"}
            className={cn(
              "press flex h-[3.35rem] flex-col items-center justify-center rounded-2xl",
              room === "play" ? "bg-accent text-accent-fg" : "text-muted",
            )}
            onClick={() => setRoom("play")}
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              <Gamepad2 className="size-4" aria-hidden="true" />
              Игры
            </span>
            <span className={cn("text-xs leading-none", room === "play" ? "text-accent-fg/75" : "text-faint")}>Три игры</span>
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {room === "watch" ? (
          <Screen />
        ) : room === "play" ? (
          <Games />
        ) : (
          <Shelf
            books={books}
            error={error}
            query={query}
            onQuery={setQuery}
            onRetry={() => void refresh().catch(() => setError("Полка сейчас недоступна"))}
            onOpen={setOpen}
            onShare={(book) => void share(book)}
            onAdded={() => void refresh().catch(() => undefined)}
          />
        )}
      </div>
      {shareUrl ? <ShareLink url={shareUrl} onClose={() => setShareUrl(null)} /> : null}
    </div>
  );
}

function Shelf({
  books,
  error,
  query,
  onQuery,
  onRetry,
  onOpen,
  onShare,
  onAdded,
}: {
  books: ShelfBook[] | null;
  error: string | null;
  query: string;
  onQuery: (value: string) => void;
  onRetry: () => void;
  onOpen: (book: ShelfBook) => void;
  onShare: (book: ShelfBook) => void;
  onAdded: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function take(list: File[]) {
    if (!list.length || busy) return;
    setBusy(true);
    let saved = 0;
    for (const file of list.slice(0, 8)) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const parsed = parseBookBytes(bytes, file.name);
        await publishBook(file, parsed);
        saved += 1;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : `«${file.name}» не открылась`);
      }
    }
    setBusy(false);
    if (saved) {
      toast(saved === 1 ? "Книга на общей полке" : `На общей полке новых книг: ${saved}`);
      onAdded();
    }
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        void take([...event.dataTransfer.files]);
      }}
    >
      <div className="flex items-start justify-between gap-3 px-4 pt-4">
        <div>
          <h3 className="font-serif text-2xl tracking-tight">Читальня</h3>
          <p className="mt-1 max-w-md text-sm text-muted">
            EPUB, FB2, TXT и PDF до 25 МБ. Загруженную книгу видят все, кто вошёл. Она остаётся в общей базе и не пропадает после перезапуска. Ищите по названию.
          </p>
        </div>
        <button
          type="button"
          className="press inline-flex h-11 shrink-0 items-center gap-2 rounded-2xl bg-accent px-3 text-sm font-medium text-accent-fg disabled:opacity-40"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          <Upload className="size-4" />
          {busy ? "Читаем файл…" : "На полку"}
        </button>
        <input
          ref={input}
          type="file"
          className="hidden"
          accept=".epub,.fb2,.fbz,.zip,.txt,.pdf,application/epub+zip,application/pdf,text/plain"
          multiple
          onChange={(event) => {
            const list = event.target.files;
            if (list?.length) void take([...list]);
            event.target.value = "";
          }}
        />
      </div>
      <label className="relative mx-4 mt-3 block">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
        <input
          id="shelf-search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Поиск по названию"
          className="field field-search"
          maxLength={80}
        />
      </label>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {error ? (
          <div>
            <p className="text-sm text-danger">{error}</p>
            <button type="button" className="press mt-3 h-10 rounded-xl border border-line px-3 text-sm" onClick={onRetry}>
              Повторить
            </button>
          </div>
        ) : books === null ? (
          <PageLoader compact />
        ) : books.length === 0 ? (
          <div className="mx-auto mt-8 max-w-sm rounded-3xl border border-dashed border-line px-5 py-10 text-center">
            <BookOpen className="mx-auto size-6 text-muted" />
            <p className="mt-3 font-serif text-xl">{query.trim() ? "Такого названия нет" : "Полка пуста"}</p>
            <p className="mt-2 text-sm text-muted">
              {query.trim() ? "Попробуйте другое слово из названия." : "Положите книгу сюда или нажмите «На полку». Её увидят все."}
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(160px,220px))] justify-center gap-3">
            {books.map((book) => (
              <li key={book.id} className="relative">
                <button type="button" className="press group w-full text-left" onClick={() => onOpen(book)}>
                  <Cover book={book} />
                  <p className="mt-2 line-clamp-2 text-sm font-medium">{book.title}</p>
                  <p className="truncate text-xs text-faint">{book.author || "Автор не указан"}</p>
                  <p className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-muted">
                    {book.ownerName ? (
                      <>
                        <PersonFace name={book.ownerName} image={book.ownerImage} size={16} userId={book.ownerId} />
                        <span className="truncate">От {book.ownerName}</span>
                      </>
                    ) : (
                      "Общая полка"
                    )}
                  </p>
                </button>
                <button
                  type="button"
                  className="press absolute top-2 right-2 inline-flex size-11 items-center justify-center rounded-2xl border border-line bg-bg/85 text-fg"
                  aria-label={`Поделиться «${book.title}»`}
                  onClick={() => onShare(book)}
                >
                  <Share2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

async function publishBook(file: File, parsed: { title: string; author: string; language: string; format: string; cover: string; words: number; chapters: { title: string }[] }) {
  const body = new FormData();
  body.set("file", file);
  body.set("title", parsed.title);
  body.set("author", parsed.author);
  body.set("language", parsed.language);
  body.set("format", parsed.format);
  body.set("cover", parsed.cover);
  body.set("words", String(parsed.words));
  body.set("chapters", String(parsed.chapters.length));
  const headers = new Headers();
  const token = getBearerToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch("/api/books", { method: "POST", body, headers });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(payload?.message || "Не удалось поделиться книгой");
  }
}

async function loadBytes(id: string, linkToken?: string): Promise<Uint8Array> {
  const headers = new Headers();
  if (!linkToken) {
    const token = getBearerToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  const response = await fetch(linkToken ? `/api/books/shared/${linkToken}` : `/api/books/${id}`, { headers });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(payload?.message || "Книга не открылась");
  }
  return new Uint8Array(await response.arrayBuffer());
}

function Cover({ book }: { book: ShelfBook }) {
  const pct = book.chapters > 0 ? Math.round(((book.chapter + book.ratio) / book.chapters) * 100) : 0;
  const minutes = book.words > 40 ? Math.max(1, Math.round(book.words / 180)) : 0;
  return (
    <div className="relative aspect-[2/3] overflow-hidden rounded-2xl border border-line bg-subtle shadow-[var(--shadow)]">
      {book.cover ? (
        <img src={book.cover} alt="" loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full flex-col justify-between p-3">
          <span className="text-xs tracking-widest text-faint uppercase">{book.format}</span>
          <span className="font-serif text-lg leading-tight text-balance">{book.title}</span>
          <span className="truncate text-xs text-muted">{book.author || "без автора"}</span>
        </div>
      )}
      <span className="absolute top-2 left-2 rounded-full bg-bg/80 px-2 py-0.5 text-xs tracking-wide text-muted uppercase">
        {book.format}
      </span>
      {minutes ? (
        <span className="absolute right-2 bottom-3 rounded-full bg-bg/80 px-2 py-0.5 text-xs text-muted">~{minutes} мин</span>
      ) : null}
      <span className="absolute inset-x-0 bottom-0 h-1 bg-fg/10">
        <span className="block h-full bg-accent" style={{ width: `${Math.min(100, pct)}%` }} />
      </span>
    </div>
  );
}

export function Reader({
  book,
  onClose,
  onDrop,
  onShare,
  onProgress,
  linkToken,
  closeLabel = "Полка",
}: {
  book: ShelfBook;
  onClose: () => void;
  onDrop?: () => Promise<void>;
  onShare?: () => void;
  onProgress: (chapter: number, ratio: number) => void;
  linkToken?: string;
  closeLabel?: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const edge = useEdgeBack(true, onClose);
  const [full, setFull] = useState(false);
  const [chapters, setChapters] = useState<BookChapter[] | null>(null);
  const [pdfUrl, setPdfUrl] = useState("");
  const [index, setIndex] = useState(book.chapter);
  const [size, setSize] = useState(readSize);
  const [paper, setPaper] = useState<Paper>(readPaper);
  const [contents, setContents] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [fail, setFail] = useState("");
  const saveTimer = useRef(0);

  const restored = useRef(false);

  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === root.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  async function toggleFull() {
    const el = root.current;
    if (!el) return;
    try {
      if (document.fullscreenElement === el) await document.exitFullscreen();
      else await el.requestFullscreen();
    } catch {
      toast.error("Полный экран недоступен");
    }
  }

  useEffect(() => {
    let cancelled = false;
    let url = "";
    void loadBytes(book.id, linkToken)
      .then((bytes) => {
        if (cancelled) return;
        if (book.format === "pdf") {
          const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
          url = URL.createObjectURL(new Blob([copy], { type: "application/pdf" }));
          if (cancelled) {
            URL.revokeObjectURL(url);
            return;
          }
          setPdfUrl(url);
          setChapters([]);
          return;
        }
        const parsed = parseBookBytes(bytes, book.fileName);
        if (cancelled) return;
        setChapters(parsed.chapters);
        setIndex(Math.min(book.chapter, Math.max(parsed.chapters.length - 1, 0)));
      })
      .catch((err) => {
        if (!cancelled) setFail(err instanceof Error ? err.message : "Книга не открылась");
      });
    if (!linkToken) {
      void saveShelfProgress({ data: { id: book.id, chapter: book.chapter, ratio: book.ratio } }).catch(() => undefined);
    }
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [book.id, book.chapter, book.fileName, book.format, book.ratio, linkToken]);

  useEffect(() => {
    if (!chapters || book.format === "pdf" || restored.current) return;
    const el = scroller.current;
    if (!el) return;
    restored.current = true;
    const apply = () => {
      const max = el.scrollHeight - el.clientHeight;
      el.scrollTop = Math.max(0, max * book.ratio);
    };
    apply();
    const frame = requestAnimationFrame(apply);
    return () => cancelAnimationFrame(frame);
  }, [book.format, book.ratio, chapters]);

  function remember(nextIndex: number, ratio: number) {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      if (!linkToken) {
        void saveShelfProgress({ data: { id: book.id, chapter: nextIndex, ratio } }).catch(() => undefined);
      }
      onProgress(nextIndex, ratio);
    }, 350);
  }

  function go(next: number) {
    if (!chapters || next < 0 || next >= chapters.length) return;
    setIndex(next);
    setContents(false);
    const el = scroller.current;
    if (el) el.scrollTop = 0;
    remember(next, 0);
  }

  const chapter = chapters?.[index];

  return (
    <div ref={root} className="flex h-full min-h-0 flex-col bg-bg" {...edge} style={edge.style}>
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <button type="button" className="press inline-flex h-10 items-center gap-1 rounded-xl px-2 text-sm text-muted" onClick={onClose}>
          <ChevronLeft className="size-4" />
          {closeLabel}
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{book.title}</p>
          <p className="truncate text-xs text-faint">{book.author || book.format.toUpperCase()}</p>
        </div>
        {book.format === "pdf" ? null : (
          <>
            <button type="button" className="press inline-flex size-10 items-center justify-center rounded-xl border border-line" aria-label="Уменьшить шрифт" onClick={() => setSize(storeSize(size - 1))}>
              <Minus className="size-4" />
            </button>
            <button type="button" className="press inline-flex size-10 items-center justify-center rounded-xl border border-line" aria-label="Увеличить шрифт" onClick={() => setSize(storeSize(size + 1))}>
              <Plus className="size-4" />
            </button>
            {chapters && chapters.length > 1 ? (
              <button type="button" className="press inline-flex size-10 items-center justify-center rounded-xl border border-line" aria-label="Оглавление" onClick={() => setContents((value) => !value)}>
                <List className="size-4" />
              </button>
            ) : null}
          </>
        )}
        <button
          type="button"
          className="press inline-flex size-10 items-center justify-center rounded-xl border border-line"
          aria-label={full ? "Выйти из полного экрана" : "На весь экран"}
          onClick={() => void toggleFull()}
        >
          {full ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </button>
        {onShare ? (
          <button type="button" className="press inline-flex size-10 items-center justify-center rounded-xl border border-line" aria-label="Поделиться книгой" onClick={onShare}>
            <Share2 className="size-4" />
          </button>
        ) : null}
        {onDrop ? (
          <button type="button" className="press inline-flex size-10 items-center justify-center rounded-xl border border-line text-danger" aria-label="Убрать с полки" onClick={() => setConfirm(true)}>
            <Trash2 className="size-4" />
          </button>
        ) : null}
      </header>
      {confirm ? (
        <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
          <p className="text-sm">Убрать книгу у всех?</p>
          <div className="flex gap-2">
            <button type="button" className="press h-9 rounded-xl px-3 text-sm" onClick={() => setConfirm(false)}>
              Нет
            </button>
            <button type="button" className="press h-9 rounded-xl bg-danger px-3 text-sm font-medium text-bg" onClick={() => void onDrop?.()}>
              Убрать
            </button>
          </div>
        </div>
      ) : null}
      {book.format === "pdf" ? null : (
        <div className="flex gap-1 px-3 pt-2">
          {PAPERS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={cn("press h-8 flex-1 rounded-xl text-xs", paper === item.id ? "bg-subtle text-fg" : "text-muted")}
              onClick={() => {
                setPaper(item.id);
                try {
                  localStorage.setItem(PAPER_KEY, item.id);
                } catch {
                  /* ignore */
                }
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        {fail ? <p className="p-4 text-sm text-danger">{fail}</p> : null}
        {book.format === "pdf" && pdfUrl ? (
          <iframe title={book.title} src={pdfUrl} className="h-full w-full bg-bg" />
        ) : (
          <div
            ref={scroller}
            className={cn("h-full overflow-y-auto", paper === "sepia" ? "paper-sepia" : paper === "night" ? "paper-night" : "paper-day")}
            onScroll={(event) => {
              const el = event.currentTarget;
              const max = el.scrollHeight - el.clientHeight;
              const ratio = max <= 0 ? 1 : el.scrollTop / max;
              remember(index, Math.min(1, Math.max(0, ratio)));
            }}
          >
            {chapter ? (
              <article
                className="reader-sheet mx-auto max-w-2xl px-5 py-8"
                style={{ fontSize: `${size}px` }}
                dangerouslySetInnerHTML={{ __html: chapter.html }}
              />
            ) : fail ? null : (
              <PageLoader />
            )}
          </div>
        )}
        {contents && chapters ? (
          <div className="absolute inset-0 overflow-y-auto bg-elev">
            <ul className="space-y-1 p-3">
              {chapters.map((item, itemIndex) => (
                <li key={`${item.title}-${itemIndex}`}>
                  <button
                    type="button"
                    className={cn("press w-full rounded-xl px-3 py-2 text-left text-sm", itemIndex === index ? "bg-subtle text-fg" : "text-muted")}
                    onClick={() => go(itemIndex)}
                  >
                    <span className="mr-2 text-xs text-faint tabular-nums">{itemIndex + 1}</span>
                    {item.title}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      {chapters && chapters.length > 1 ? (
        <footer className="flex items-center justify-between gap-2 border-t border-line px-3 py-2">
          <button type="button" className="press inline-flex h-10 items-center gap-1 rounded-xl px-2 text-sm disabled:opacity-30" disabled={index === 0} onClick={() => go(index - 1)}>
            <ChevronLeft className="size-4" />
            Назад
          </button>
          <p className="text-xs text-faint tabular-nums">
            {index + 1} / {chapters.length}
          </p>
          <button
            type="button"
            className="press inline-flex h-10 items-center gap-1 rounded-xl px-2 text-sm disabled:opacity-30"
            disabled={index >= chapters.length - 1}
            onClick={() => go(index + 1)}
          >
            Дальше
            <ChevronRight className="size-4" />
          </button>
        </footer>
      ) : null}
    </div>
  );
}

function readSize(): number {
  if (typeof localStorage === "undefined") return 19;
  const raw = Number(localStorage.getItem(SIZE_KEY));
  return raw >= 16 && raw <= 26 ? raw : 19;
}

function storeSize(value: number): number {
  const next = Math.min(26, Math.max(16, value));
  try {
    localStorage.setItem(SIZE_KEY, String(next));
  } catch {
    /* ignore */
  }
  return next;
}

function ShareLink({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[75] flex items-end justify-center bg-black/55 p-3 sm:items-center" role="presentation" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-3xl border border-line bg-elev p-4 shadow-[var(--shadow)]"
        role="dialog"
        aria-modal="true"
        aria-label="Ссылка на книгу"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <BackButton onClick={onClose} label="Назад" />
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-medium">Ссылка на книгу</h2>
            <p className="mt-1 text-sm text-muted">Открывается наша читалка. Книга остаётся на полке.</p>
          </div>
          <button type="button" className="press hidden size-11 shrink-0 items-center justify-center rounded-2xl border border-line text-muted md:inline-flex" aria-label="Закрыть" onClick={onClose}>
            <X className="size-4" />
          </button>
        </div>
        <input readOnly className="field mt-3 font-mono text-xs" value={url} aria-label="Ссылка" onFocus={(event) => event.currentTarget.select()} />
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" className="press hidden h-11 rounded-2xl border border-line px-4 text-sm md:inline-flex" onClick={onClose}>
            Закрыть
          </button>
          <button
            type="button"
            className="press h-11 rounded-2xl bg-accent px-4 text-sm font-medium text-accent-fg"
            onClick={() => {
              void navigator.clipboard.writeText(url).then(
                () => toast("Ссылка скопирована"),
                () => toast("Не удалось скопировать — выделите адрес"),
              );
            }}
          >
            Копировать
          </button>
        </div>
      </div>
    </div>
  );
}

function readPaper(): Paper {
  if (typeof localStorage === "undefined" || typeof document === "undefined") return "night";
  const raw = localStorage.getItem(PAPER_KEY);
  if (raw === "sepia" || raw === "night" || raw === "day") return raw;
  return document.documentElement.classList.contains("light") ? "day" : "night";
}
