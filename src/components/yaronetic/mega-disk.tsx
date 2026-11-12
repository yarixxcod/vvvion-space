import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Download, FileText, Folder, FolderPlus, Music2, Pencil, Share2, Trash2, X } from "lucide-react";
import { BackButton } from "@/components/yaronetic/back-button";
import { toast } from "sonner";
import { ArtistNames } from "@/components/yaronetic/artist-card";
import { FileBar } from "@/components/yaronetic/file-bar";
import { FileEditor, type AudioPatch } from "@/components/yaronetic/file-editor";
import { FileMenu, type FileAction } from "@/components/yaronetic/file-facts";
import { openAlbum, forgetTrack } from "@/components/yaronetic/music-dock";
import { PageLoader } from "@/components/yaronetic/page-loader";
import { VerifyMailButton } from "@/components/yaronetic/verify-mail";
import { UploadMeter, sizeLabel, type UploadView } from "@/components/yaronetic/upload-meter";
import { compareFiles, matchQuery, type SortDir, type SortKey } from "@/lib/files/order";
import { useTx } from "@/lib/lang";
import { dropTags, loadTags } from "@/lib/music/load";
import { coverUrl, isMusicFile, musicBits, type MusicTags } from "@/lib/music/tags";
import { entryName, siblingName } from "@/lib/social/mega-plan";
import { buyMega, dropMegaShare, getMega, listMegaFolders, makeMegaFolder, moveMega, peekMegaLink, removeMega, renameMega, shareMega, type MegaEntry, type MegaView } from "@/lib/social/mega";
import { downloadMegaFile, finishMegaClient, MegaFinishError, megaAuthHeaders, megaFileUrl, stampMegaFile, uploadMegaFile } from "@/lib/social/mega-upload";
import { shareOut } from "@/lib/app-bridge";
import { previewPathPrefix } from "@/lib/preview-path-prefix";

function untilLabel(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

function mb(bytes: number) {
  return (bytes / (1024 * 1024)).toLocaleString("ru-RU", { maximumFractionDigits: 1 });
}

function fileKind(entry: MegaEntry): "image" | "video" | "audio" | "pdf" | "text" | "file" {
  const mime = entry.mime.toLowerCase();
  const name = entry.name.toLowerCase();
  if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|avif|heic|svg)$/.test(name)) return "image";
  if (mime.startsWith("video/") || /\.(mp4|webm|mov|m4v)$/.test(name)) return "video";
  if (mime.startsWith("audio/") || /\.(mp3|ogg|wav|m4a|aac|flac)$/.test(name)) return "audio";
  if (mime === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (mime.startsWith("text/") || /\.(txt|md|json|csv|log|xml|yaml|yml)$/.test(name)) return "text";
  return "file";
}

function draftName(name: string): string {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 && name.length - dot <= 8 ? name.slice(dot) : "";
  const stem = (ext ? name.slice(0, name.length - ext.length) : name).trim().slice(0, 48);
  const tail = Math.random().toString(36).slice(2, 6);
  return `${stem} ${tail}${ext}`.trim().slice(0, 80);
}

function asFile(bytes: Uint8Array, name: string, type: string): File {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return new File([copy], name, { type });
}

function MegaPreview({
  entry,
  src,
  busy,
  onClose,
  onDownload,
}: {
  entry: MegaEntry;
  src: string;
  busy: boolean;
  onClose: () => void;
  onDownload: () => void;
}) {
  const kind = fileKind(entry);
  const [text, setText] = useState<string | null>(null);
  const [textError, setTextError] = useState<string | null>(null);

  useEffect(() => {
    if (kind !== "text" || entry.bytes > 200_000) return;
    let dead = false;
    void fetch(src, { credentials: "same-origin", headers: megaAuthHeaders() })
      .then(async (res) => {
        if (!res.ok) {
          const parsed = (await res.json().catch(() => ({}))) as { message?: string };
          throw new Error(parsed.message || "Не открылось");
        }
        return res.text();
      })
      .then((value) => {
        if (!dead) setText(value);
      })
      .catch((err: unknown) => {
        if (!dead) setTextError(err instanceof Error ? err.message : "Не открылось");
      });
    return () => {
      dead = true;
    };
  }, [entry.bytes, kind, src]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-black/80 p-3" role="dialog" aria-modal="true" aria-label={entry.name}>
      <div className="flex items-center gap-2">
        <BackButton onClick={onClose} label="Назад" className="text-white" />
        <p className="min-w-0 flex-1 truncate text-sm text-white">{entry.name}</p>
        <button type="button" className="press inline-flex h-11 items-center gap-1.5 rounded-2xl bg-elev px-3 text-sm disabled:opacity-40" disabled={busy} onClick={onDownload}>
          <Download className="size-4" />
          Скачать
        </button>
        <button type="button" className="press hidden h-11 rounded-2xl border border-line bg-elev px-3 text-sm md:inline-flex" onClick={onClose}>
          Закрыть
        </button>
      </div>
      <div className="mt-3 flex min-h-0 flex-1 items-center justify-center overflow-auto">
        {kind === "image" ? <img src={src} alt={entry.name} className="max-h-full max-w-full object-contain" /> : null}
        {kind === "video" ? <video src={src} controls playsInline className="max-h-full max-w-full bg-black" /> : null}
        {kind === "audio" && !isMusicFile(entry.name, entry.mime) ? <audio controls autoPlay src={src} className="w-full max-w-xl" /> : null}
        {kind === "audio" && isMusicFile(entry.name, entry.mime) ? (
          <button type="button" className="press rounded-3xl bg-white px-5 py-3 text-sm font-medium text-black" onClick={() => openAlbum([{ src, name: entry.name, bytes: entry.bytes }])}>
            Слушать
          </button>
        ) : null}
        {kind === "pdf" ? <iframe title={entry.name} src={src} className="h-full min-h-[70dvh] w-full rounded-2xl bg-white" /> : null}
        {kind === "text" ? (
          entry.bytes > 200_000 ? (
            <p className="text-sm text-white">Слишком большой для превью. Его можно скачать.</p>
          ) : textError ? (
            <p className="text-sm text-white">{textError}</p>
          ) : text == null ? (
            <PageLoader compact />
          ) : (
            <pre className="max-h-full w-full overflow-auto rounded-2xl bg-elev p-4 text-left text-xs whitespace-pre-wrap">{text}</pre>
          )
        ) : null}
        {kind === "file" ? <p className="px-6 text-center text-sm text-white">Превью для этого файла нет. Его можно скачать.</p> : null}
      </div>
    </div>
  );
}

function TrackRow({
  src,
  name,
  bytes,
  disabled,
  picked,
  menu,
  onPlay,
  onPick,
}: {
  src: string;
  name: string;
  bytes: number;
  disabled: boolean;
  picked: boolean;
  menu: ReactNode;
  onPlay: () => void;
  onPick: () => void;
}) {
  const [ready, setReady] = useState(false);
  const [tags, setTags] = useState<MusicTags | null>(null);
  const [cover, setCover] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    setReady(false);
    void loadTags(src, name)
      .then((parsed) => {
        if (dead) return;
        setTags(parsed);
        setCover(coverUrl(parsed.cover));
      })
      .catch(() => undefined)
      .finally(() => {
        if (!dead) setReady(true);
      });
    return () => {
      dead = true;
    };
  }, [name, src]);

  if (!ready) return null;

  const title = tags?.title || name.replace(/\.[^.]+$/, "");
  const bits = musicBits(tags, bytes);
  const extra = bits || sizeLabel(bytes);

  return (
    <li className="flex items-center gap-2 rounded-2xl border border-line bg-bg px-3 py-2">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <span className="relative shrink-0">
          <button type="button" className="press block" onClick={onPlay} disabled={disabled}>
            {cover ? <img src={cover} alt="" className="size-14 rounded-xl object-cover" /> : (
              <span className="grid size-14 place-items-center rounded-xl bg-subtle">
                <Music2 className="size-4 text-muted" />
              </span>
            )}
          </button>
          <button
            type="button"
            aria-pressed={picked}
            aria-label={picked ? "Снять выбор" : "Выбрать"}
            className={`absolute -top-1.5 -left-1.5 z-10 grid size-6 place-items-center rounded-full border text-[11px] leading-none ${picked ? "border-accent bg-accent text-accent-fg" : "border-line bg-bg text-transparent"}`}
            onClick={onPick}
          >
            ✓
          </button>
        </span>
        <span className="min-w-0 flex-1">
          <button type="button" className="press block w-full truncate text-left text-[0.95rem] leading-snug" onClick={onPlay} disabled={disabled}>{title}</button>
          {tags?.artist ? (
            <span className="mt-0.5 block overflow-x-auto whitespace-nowrap text-[0.8125rem] leading-snug text-faint [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <ArtistNames name={tags.artist} className="text-faint" />
            </span>
          ) : null}
          {extra ? <span className="mt-1 block truncate text-xs leading-none tabular-nums whitespace-nowrap text-faint">{extra}</span> : null}
        </span>
      </div>
      {menu}
    </li>
  );
}

export function MegaDisk() {
  const tx = useTx();
  const [view, setView] = useState<MegaView | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [meter, setMeter] = useState<UploadView | null>(null);
  const [meterKind, setMeterKind] = useState<"up" | "down" | null>(null);
  const [open, setOpen] = useState<MegaEntry | null>(null);
  const [edit, setEdit] = useState<MegaEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("date");
  const [dir, setDir] = useState<SortDir>("desc");
  const [query, setQuery] = useState("");
  const [rev, setRev] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  const [dests, setDests] = useState<{ id: string; name: string }[] | null>(null);
  const [share, setShare] = useState<{ id: string; name: string } | null>(null);
  const [held, setHeld] = useState<{ id: string; name: string } | null>(null);
  const [dup, setDup] = useState<{ file: File; existingId: string; name: string; rest: File[] } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  function href(id: string) {
    const url = megaFileUrl(id, "view");
    return rev ? `${url}&r=${rev}` : url;
  }

  function load(next = folder) {
    return getMega({ data: { folder: next } }).then((row) => {
      setView(row);
      setError(null);
      return row;
    });
  }

  function toggle(id: string) {
    setPicked((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  async function openMove() {
    try {
      setDests(await listMegaFolders());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Папки не открылись");
    }
  }

  async function sendMove(dest: string | null) {
    if (!picked.length || busy) return;
    setBusy(true);
    try {
      setView(await moveMega({ data: { ids: picked, folder, dest } }));
      setPicked([]);
      setDests(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось переместить");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let dead = false;
    void getMega({ data: { folder: null } })
      .then((row) => {
        if (!dead) setView(row);
      })
      .catch((err: unknown) => {
        if (!dead) setError(err instanceof Error ? err.message : "Мегадиск не открылся");
      });
    return () => {
      dead = true;
    };
  }, []);

  async function buy() {
    if (busy || !view) return;
    if (!view.verified) {
      toast("Сначала подтвердите почту");
      return;
    }
    setBusy(true);
    try {
      await buyMega();
      await load(null);
      toast("Мегадиск открыт");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не купилось");
    } finally {
      setBusy(false);
    }
  }

  async function openFolder(next: string | null) {
    setFolder(next);
    setOpen(null);
    try {
      await load(next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Папка не открылась");
    }
  }

  async function createFolder() {
    const next = name.trim();
    if (!next) {
      toast("Сначала имя папки");
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      setView(await makeMegaFolder({ data: { folder, name: next } }));
      setName("");
      toast("Папка создана");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Папка не создалась");
    } finally {
      setBusy(false);
    }
  }

  async function sendFile(file: File, signal: AbortSignal) {
    setMeter({ name: file.name, ratio: 0, loaded: 0, total: file.size, speed: 0 });
    await uploadMegaFile(file, folder, (tick) => setMeter({ name: file.name, ...tick }), signal);
  }

  async function runFiles(files: File[], ctrl: AbortController) {
    for (let index = 0; index < files.length; index += 1) {
      if (ctrl.signal.aborted) throw new Error("Загрузка отменена");
      const file = files[index];
      if (!file) continue;
      if (file.size < 1 || file.size > 2 * 1024 * 1024 * 1024) {
        toast.error("Файл пустой или больше 2 ГБ");
        continue;
      }
      let clean = file.name;
      try {
        clean = entryName(file.name);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Так не назвать");
        continue;
      }
      const existing = view?.entries.find((entry) => entry.kind === "file" && entry.name === clean);
      if (existing) {
        setDup({ file, existingId: existing.id, name: clean, rest: files.slice(index + 1) });
        return;
      }
      await sendFile(file, ctrl.signal);
    }
  }

  async function upload(files: File[]) {
    if (!files.length || busy) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);
    setMeterKind("up");
    setHeld(null);
    try {
      await runFiles(files, ctrl);
      await load();
    } catch (err) {
      if (err instanceof MegaFinishError) {
        setHeld({ id: err.id, name: "" });
        toast.error("Не удалось сохранить файл");
      } else {
        toast.error(err instanceof Error ? err.message : "Файл не загрузился");
      }
    } finally {
      setMeter(null);
      setMeterKind(null);
      setBusy(false);
      abortRef.current = null;
    }
  }

  async function answerDup(choice: "replace" | "both" | "cancel") {
    const ask = dup;
    if (!ask || busy) return;
    setDup(null);
    if (choice === "cancel") {
      if (ask.rest.length) void upload(ask.rest);
      return;
    }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);
    setMeterKind("up");
    try {
      let file = ask.file;
      if (choice === "replace") {
        setView(await removeMega({ data: { id: ask.existingId, folder } }));
        forgetTrack(ask.existingId);
      } else {
        const taken = new Set((view?.entries ?? []).filter((entry) => entry.kind === "file").map((entry) => entry.name));
        const next = siblingName(ask.name, taken);
        file = new File([ask.file], next, { type: ask.file.type, lastModified: ask.file.lastModified });
      }
      await sendFile(file, ctrl.signal);
      await runFiles(ask.rest, ctrl);
      await load();
    } catch (err) {
      if (err instanceof MegaFinishError) {
        setHeld({ id: err.id, name: ask.name });
        toast.error("Не удалось сохранить файл");
      } else {
        toast.error(err instanceof Error ? err.message : "Файл не загрузился");
      }
    } finally {
      setMeter(null);
      setMeterKind(null);
      setBusy(false);
      abortRef.current = null;
    }
  }

  async function retryHeld() {
    if (!held || busy) return;
    setBusy(true);
    try {
      await finishMegaClient(held.id);
      setHeld(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось сохранить файл");
    } finally {
      setBusy(false);
    }
  }

  async function download(id: string, fileName: string, bytes: number) {
    if (busy) return;
    setBusy(true);
    setMeterKind("down");
    setMeter({ name: fileName, ratio: 0, loaded: 0, total: bytes, speed: 0 });
    try {
      const how = await downloadMegaFile(id, fileName, bytes, (tick) => setMeter({ name: fileName, ...tick }));
      if (how === "cache") toast("Файл остался в кэше браузера");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось скачать");
    } finally {
      setMeter(null);
      setMeterKind(null);
      setBusy(false);
    }
  }

  async function remove(id: string, label: string) {
    if (busy) return;
    if (!window.confirm(`Убрать «${label}»?`)) return;
    setBusy(true);
    try {
      setView(await removeMega({ data: { id, folder } }));
      forgetTrack(id);
      if (open?.id === id) setOpen(null);
      if (edit?.id === id) setEdit(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось убрать");
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(entry: MegaEntry, nextName: string, audio: AudioPatch | null) {
    const fresh = () => {
      dropTags(megaFileUrl(entry.id, "view"));
      void caches.open("vvvion-mega").then((cache) => cache.delete(new Request(`${location.origin}/__vvvion_mega/${entry.id}`))).catch(() => undefined);
      setRev((value) => value + 1);
    };
    if (audio?.header) {
      if (nextName !== entry.name) setView(await renameMega({ data: { id: entry.id, folder, name: nextName } }));
      await stampMegaFile(entry.id, audio.header);
      fresh();
      await load();
      return;
    }
    if (audio?.full) {
      const draft = draftName(entry.name);
      await renameMega({ data: { id: entry.id, folder, name: draft } });
      try {
        await uploadMegaFile(asFile(audio.full, nextName, entry.mime || "audio/mpeg"), folder);
        setView(await removeMega({ data: { id: entry.id, folder } }));
      } catch (error) {
        await renameMega({ data: { id: entry.id, folder, name: entry.name } }).catch(() => undefined);
        throw error;
      }
      fresh();
      return;
    }
    if (nextName !== entry.name) setView(await renameMega({ data: { id: entry.id, folder, name: nextName } }));
  }

  if (!view && error) {
    return (
      <div className="px-4 py-6">
        <p className="text-sm text-danger">{error}</p>
        <button type="button" className="press mt-3 h-10 rounded-xl border border-line px-3 text-sm" onClick={() => void load(null).catch(() => undefined)}>
          Повторить
        </button>
      </div>
    );
  }

  function fileActions(entry: MegaEntry): FileAction[] {
    const rows: FileAction[] = [
      {
        label: "Поделиться",
        icon: <Share2 className="size-4" />,
        disabled: busy || !view?.ready,
        onClick: () => setShare({ id: entry.id, name: entry.name }),
      },
      {
        label: "Изменить",
        icon: <Pencil className="size-4" />,
        disabled: busy,
        onClick: () => setEdit(entry),
      },
    ];
    if (entry.kind === "file") {
      rows.push({
        label: "Скачать",
        icon: <Download className="size-4" />,
        disabled: busy || !view?.ready,
        onClick: () => void download(entry.id, entry.name, entry.bytes),
      });
    }
    rows.push({
      label: "Убрать",
      icon: <Trash2 className="size-4" />,
      disabled: busy || !view?.ready,
      onClick: () => void remove(entry.id, entry.name),
    });
    return rows;
  }

  if (!view) return <PageLoader />;

  const shown = compareFiles(
    view.entries.filter((entry) => matchQuery(entry.name, query)).map((entry) => ({ ...entry, folder: entry.kind === "folder" })),
    sort,
    dir,
  );

  const ratio = view.quota > 0 ? Math.min(1, view.used / view.quota) : 0;

  return (
    <div className="h-full overflow-y-auto px-3 pt-3 pb-6">
      <section className="rounded-[1.7rem] border border-line bg-elev px-4 py-4">
        <p className="text-xs tracking-[0.22em] text-faint uppercase">{tx({ ru: "Мегадиск", en: "Megadisk", kk: "Мегадиск" })}</p>
        <p className="mt-1 font-serif text-4xl leading-none">
          {mb(view.used)} <span className="text-2xl text-muted">{tx({ ru: `из ${mb(view.quota)} МБ`, en: `of ${mb(view.quota)} MB`, kk: `${mb(view.quota)} МБ ішінен` })}</span>
        </p>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-subtle">
          <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(ratio > 0 ? 4 : 0, ratio * 100)}%` }} />
        </div>
        <p className="mt-2 text-xs text-faint">
          {view.ready ? "Файлы распределяются по свободным серверам" : "Сервер ещё не назначен"}
          {view.active ? ` · до ${untilLabel(view.until)}` : view.until ? " · срок вышел, файлы ещё можно скачать" : ""}
        </p>
        <p className="mt-1 text-xs text-muted">{tx({ ru: "Короткий обрыв сети не сбрасывает загрузку и скачивание: оборванный кусок повторяется сам. Файл до 20 МБ можно прислать и боту в Telegram — он ляжет в корень.", en: "A short network dip does not restart an upload or a download: the broken piece is sent again. A file up to 20 MB can also go to the Telegram bot and lands in the root.", kk: "Желі қысқа үзілсе, жүктеу басынан басталмайды: үзілген бөлік қайта кетеді. 20 МБ-қа дейінгі файлды Telegram ботына жіберуге болады — ол түбірге түседі." })}</p>
        {!view.active ? (
          view.verified ? (
            <button type="button" disabled={busy} className="press mt-3 h-10 rounded-xl bg-accent px-3 text-sm font-medium text-accent-fg disabled:opacity-40" onClick={() => void buy()}>
              {`${view.until ? "Продлить" : "Купить"} за ${view.price} вуб.`}
            </button>
          ) : (
            <div className="mt-3">
              <p className="mb-2 text-sm tabular-nums">{view.price} вуб.</p>
              <VerifyMailButton onVerified={() => void load(null)} />
            </div>
          )
        ) : null}
        {!view.ready && view.active ? <p className="mt-3 text-sm text-muted">Диск ещё не готов. Загрузка откроется, когда машина ответит.</p> : null}
      </section>
      {view.crumbs.length ? (
        <div className="mt-3 flex flex-wrap items-center gap-1 text-sm">
          <button type="button" className="press text-muted" onClick={() => void openFolder(null)}>
            Диск
          </button>
          {view.crumbs.map((crumb) => (
            <button key={crumb.id} type="button" className="press text-muted" onClick={() => void openFolder(crumb.id)}>
              <span className="text-faint"> / </span>
              {crumb.name}
            </button>
          ))}
        </div>
      ) : null}
      {view.active ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={tx({ ru: "Имя папки", en: "Folder name", kk: "Қалта аты" })}
            maxLength={80}
            className="field h-10 min-w-0 flex-1 rounded-xl text-sm"
            onKeyDown={(event) => {
              if (event.key === "Enter") void createFolder();
            }}
          />
          <button type="button" disabled={busy || !view.ready} className="press inline-flex h-10 items-center gap-1.5 rounded-xl border border-line px-3 text-sm disabled:opacity-40" onClick={() => void createFolder()}>
            <FolderPlus className="size-4" />
            {tx({ ru: "Папка", en: "Folder", kk: "Қалта" })}
          </button>
          <label className="press inline-flex h-10 cursor-pointer items-center rounded-xl bg-accent px-3 text-sm font-medium text-accent-fg">
            {tx({ ru: "Загрузить", en: "Upload", kk: "Жүктеу" })}
            <input
              id="mega-disk-file"
              type="file"
              multiple
              className="hidden"
              disabled={busy || !view.ready}
              onChange={(event) => {
                const list = Array.from(event.target.files ?? []);
                event.target.value = "";
                void upload(list);
              }}
            />
          </label>
          {folder ? (
            <button
              type="button"
              className="press inline-flex h-10 items-center gap-1.5 rounded-xl border border-line px-3 text-sm"
              onClick={() => {
                const crumb = view.crumbs[view.crumbs.length - 1];
                if (crumb) setShare(crumb);
              }}
            >
              <Share2 className="size-4" />
              {tx({ ru: "Ссылка", en: "Link", kk: "Сілтеме" })}
            </button>
          ) : null}
        </div>
      ) : null}
      {view.entries.some((entry) => entry.kind === "file") ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="press h-8 rounded-xl px-2 text-xs text-muted"
            onClick={() => setPicked(shown.filter((entry) => entry.kind === "file").map((entry) => entry.id))}
          >
            {tx({ ru: "Выбрать все", en: "Select all", kk: "Бәрін таңдау" })}
          </button>
          {picked.length > 0 ? (
            <>
              <span className="text-xs text-faint">{tx({ ru: `Выбрано ${picked.length}`, en: `Selected ${picked.length}`, kk: `Таңдалды ${picked.length}` })}</span>
              <button type="button" className="press h-8 rounded-xl bg-accent px-2.5 text-xs font-medium text-accent-fg" disabled={busy} onClick={() => void openMove()}>
                {tx({ ru: "В папку", en: "Into a folder", kk: "Қалтаға" })}
              </button>
              <button type="button" className="press h-8 rounded-xl px-2 text-xs text-muted" onClick={() => { setPicked([]); setDests(null); }}>
                {tx({ ru: "Снять", en: "Clear", kk: "Алу" })}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
      {dests ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button type="button" className="press h-8 rounded-xl border border-line px-2.5 text-xs" disabled={busy || !folder} onClick={() => void sendMove(null)}>
            {tx({ ru: "Корень", en: "Root", kk: "Түбір" })}
          </button>
          {dests.filter((item) => item.id !== folder).map((item) => (
            <button key={item.id} type="button" className="press h-8 max-w-40 truncate rounded-xl border border-line px-2.5 text-xs" disabled={busy} onClick={() => void sendMove(item.id)}>
              {item.name}
            </button>
          ))}
        </div>
      ) : null}
      {view.entries.length > 0 ? (
        <FileBar query={query} sort={sort} dir={dir} onQuery={setQuery} onSort={setSort} onDir={() => setDir((value) => (value === "asc" ? "desc" : "asc"))} />
      ) : null}
      {meter ? (
        <div className="mt-3 rounded-2xl border border-line bg-bg px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs tracking-[0.16em] text-faint uppercase">{meterKind === "down" ? tx({ ru: "Скачивание", en: "Download", kk: "Жүктеп алу" }) : tx({ ru: "Отправка", en: "Sending", kk: "Жіберу" })}</p>
            {meterKind === "up" ? (
              <button type="button" className="press h-8 rounded-xl px-2 text-xs text-muted" onClick={() => abortRef.current?.abort()}>
                Отменить
              </button>
            ) : null}
          </div>
          <UploadMeter view={meter} />
        </div>
      ) : null}
      {held ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-bg px-3 py-2 text-sm">
          <p className="min-w-0 flex-1">Не удалось сохранить файл</p>
          <button type="button" className="press h-9 rounded-xl bg-accent px-3 text-sm font-medium text-accent-fg disabled:opacity-40" disabled={busy} onClick={() => void retryHeld()}>
            Повторить
          </button>
        </div>
      ) : null}
      {view.entries.length === 0 ? <p className="mt-4 px-1 text-sm text-faint">{tx({ ru: "Папка пустая.", en: "The folder is empty.", kk: "Қалта бос." })}</p> : null}
      {view.entries.length > 0 && shown.length === 0 ? <p className="mt-4 px-1 text-sm text-faint">{tx({ ru: "Ничего не нашлось.", en: "Nothing matched.", kk: "Ештеңе табылмады." })}</p> : null}
      <ul className="mt-3 space-y-2">
        {shown.map((entry) => {
          const kind = fileKind(entry);
          const src = href(entry.id);
          const menu = (
            <FileMenu
              label={entry.name}
              facts={entry.kind === "file" ? { name: entry.name, mime: entry.mime, bytes: entry.bytes, createdAt: entry.createdAt, server: entry.server } : undefined}
              actions={fileActions(entry)}
            />
          );
          if (entry.kind === "file" && isMusicFile(entry.name, entry.mime)) {
            return (
              <TrackRow
                key={entry.id}
                src={src}
                name={entry.name}
                bytes={entry.bytes}
                disabled={!view.ready}
                picked={picked.includes(entry.id)}
                menu={menu}
                onPick={() => toggle(entry.id)}
                onPlay={() => {
                  const songs = shown.filter((item) => item.kind === "file" && isMusicFile(item.name, item.mime));
                  const at = Math.max(0, songs.findIndex((item) => item.id === entry.id));
                  openAlbum(
                    songs.map((item) => ({ src: href(item.id), name: item.name, bytes: item.bytes })),
                    at,
                  );
                }}
              />
            );
          }
          return (
            <li key={entry.id} className={`flex items-center gap-2 rounded-2xl border border-line bg-bg px-3 py-2`}>
              {entry.kind === "folder" ? (
                <button type="button" className="press flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => void openFolder(entry.id)}>
                  <Folder className="size-4 shrink-0 text-muted" />
                  <span className="truncate text-sm">{entry.name}</span>
                </button>
              ) : (
                <div className="flex min-w-0 flex-1 items-start gap-2.5 py-0.5">
                  <span className="relative shrink-0">
                    <button type="button" className="press block" onClick={() => setOpen(entry)} disabled={!view.ready}>
                      {kind === "image" ? (
                        <img src={src} alt="" className="size-11 rounded-lg object-cover" />
                      ) : (
                        <span className="grid size-11 place-items-center rounded-lg bg-subtle">
                          <FileText className="size-4 text-muted" />
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      aria-pressed={picked.includes(entry.id)}
                      aria-label={picked.includes(entry.id) ? "Снять выбор" : "Выбрать"}
                      className={`absolute -top-1.5 -left-1.5 z-10 grid size-6 place-items-center rounded-full border text-[11px] leading-none ${picked.includes(entry.id) ? "border-accent bg-accent text-accent-fg" : "border-line bg-bg text-transparent"}`}
                      onClick={() => toggle(entry.id)}
                    >
                      ✓
                    </button>
                  </span>
                  <button type="button" className="press min-w-0 flex-1 text-left" onClick={() => setOpen(entry)} disabled={!view.ready}>
                    <span className="block text-[0.95rem] leading-snug break-words">{entry.name}</span>
                    <span className="mt-0.5 block text-xs tabular-nums text-faint">{sizeLabel(entry.bytes)}</span>
                  </button>
                </div>
              )}
              {menu}
            </li>
          );
        })}
      </ul>
      {open ? (
        <MegaPreview entry={open} src={href(open.id)} busy={busy} onClose={() => setOpen(null)} onDownload={() => void download(open.id, open.name, open.bytes)} />
      ) : null}
      {edit ? (
        <FileEditor
          file={{ id: edit.id, name: edit.name, bytes: edit.bytes, src: href(edit.id) }}
          music={edit.kind === "file" && isMusicFile(edit.name, edit.mime)}
          busy={busy}
          onClose={() => setEdit(null)}
          onSave={(nextName, audio) => saveEdit(edit, nextName, audio)}
        />
      ) : null}
      {share ? <ShareBox entry={share} onClose={() => setShare(null)} /> : null}
      {dup ? (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Такое имя уже есть">
          <div className="w-full max-w-sm rounded-3xl border border-line bg-elev p-4">
            <p className="text-sm">Такое имя уже есть: {dup.name}</p>
            <div className="mt-3 flex flex-col gap-2">
              <button type="button" className="press h-10 rounded-xl bg-accent text-sm font-medium text-accent-fg" onClick={() => void answerDup("replace")}>
                Заменить
              </button>
              <button type="button" className="press h-10 rounded-xl border border-line text-sm" onClick={() => void answerDup("both")}>
                Сохранить обе
              </button>
              <button type="button" className="press h-10 rounded-xl text-sm text-muted" onClick={() => void answerDup("cancel")}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function diskLink(token: string) {
  const prefix = previewPathPrefix(window.location.hostname, window.location.pathname) ?? "";
  return `${window.location.origin}${prefix}/d/${token}`;
}

function ShareBox({ entry, onClose }: { entry: { id: string; name: string }; onClose: () => void }) {
  const tx = useTx();
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setNode(document.body), []);
  useEffect(() => {
    let stop = false;
    void peekMegaLink({ data: entry.id })
      .then((value) => {
        if (!stop) setToken(value);
      })
      .catch(() => {
        if (!stop) setToken(null);
      });
    return () => {
      stop = true;
    };
  }, [entry.id]);
  if (!node) return null;
  const url = token ? diskLink(token) : "";
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/55 sm:items-center sm:p-4" role="presentation" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={tx({ ru: "Публичная ссылка", en: "Public link", kk: "Жалпы сілтеме" })}
        className="w-full max-w-md rounded-t-3xl border border-line bg-elev px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[var(--shadow)] sm:rounded-3xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line-strong sm:hidden" />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium tracking-[0.16em] text-faint uppercase">{tx({ ru: "Публичная ссылка", en: "Public link", kk: "Жалпы сілтеме" })}</p>
            <h2 className="mt-1 truncate text-base font-medium">{entry.name}</h2>
            <p className="mt-1 text-sm text-muted">{tx({ ru: "По ссылке можно смотреть и скачивать. Вход не нужен.", en: "Anyone with the link can view and download. No sign-in.", kk: "Сілтемемен қарап, жүктеп алуға болады. Кіру керек емес." })}</p>
          </div>
          <button type="button" className="press grid size-9 shrink-0 place-items-center rounded-xl text-muted" aria-label={tx({ ru: "Закрыть", en: "Close", kk: "Жабу" })} onClick={onClose}>
            <X className="size-4" />
          </button>
        </div>
        {token === undefined ? <p className="mt-4 text-sm text-faint">…</p> : null}
        {token === null ? (
          <button
            type="button"
            disabled={busy}
            className="press mt-4 h-11 w-full rounded-2xl bg-accent text-sm font-medium text-accent-fg disabled:opacity-40"
            onClick={() => {
              setBusy(true);
              void shareMega({ data: entry.id })
                .then((row) => setToken(row.token))
                .catch((err) => toast.error(err instanceof Error ? err.message : tx({ ru: "Ссылка не создалась", en: "The link was not created", kk: "Сілтеме жасалмады" })))
                .finally(() => setBusy(false));
            }}
          >
            {tx({ ru: "Создать ссылку", en: "Create link", kk: "Сілтеме жасау" })}
          </button>
        ) : null}
        {token ? (
          <div className="mt-4">
            <input readOnly className="field font-mono text-xs" value={url} aria-label={tx({ ru: "Ссылка", en: "Link", kk: "Сілтеме" })} onFocus={(event) => event.currentTarget.select()} />
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="press h-11 flex-1 rounded-2xl bg-accent text-sm font-medium text-accent-fg"
                onClick={() => {
                  void shareOut({ url, title: entry.name, text: entry.name }).then((how) => {
                    if (how === "copy") toast(tx({ ru: "Ссылка скопирована", en: "Link copied", kk: "Сілтеме көшірілді" }));
                  });
                }}
              >
                {tx({ ru: "Поделиться", en: "Share", kk: "Бөлісу" })}
              </button>
              <button
                type="button"
                className="press h-11 rounded-2xl border border-line px-3 text-sm text-danger"
                onClick={() => {
                  setBusy(true);
                  void dropMegaShare({ data: entry.id })
                    .then(() => setToken(null))
                    .catch((err) => toast.error(err instanceof Error ? err.message : tx({ ru: "Не удалось закрыть", en: "Could not close", kk: "Жабылмады" })))
                    .finally(() => setBusy(false));
                }}
              >
                {tx({ ru: "Закрыть доступ", en: "Stop sharing", kk: "Жабу" })}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>,
    node,
  );
}
