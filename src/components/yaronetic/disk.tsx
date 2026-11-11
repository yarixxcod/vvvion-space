import { useEffect, useState } from "react";
import { Download, Folder, FolderPlus, Link2, Pencil, Trash2 } from "lucide-react";
import { BackButton } from "@/components/yaronetic/back-button";
import { toast } from "sonner";
import { ArtistNames } from "@/components/yaronetic/artist-card";
import { FileBar } from "@/components/yaronetic/file-bar";
import { FileEditor, type AudioPatch } from "@/components/yaronetic/file-editor";
import { MegaDisk } from "@/components/yaronetic/mega-disk";
import { openAlbum, forgetTrack } from "@/components/yaronetic/music-dock";
import { PageLoader } from "@/components/yaronetic/page-loader";
import { compareFiles, matchQuery, type SortDir, type SortKey } from "@/lib/files/order";
import { useCircleNest } from "@/lib/circle-history";
import { useTx } from "@/lib/lang";
import { dropTags, loadTags } from "@/lib/music/load";
import { coverUrl, isMusicFile, musicBits } from "@/lib/music/tags";
import { deleteDiskFile, getDisk, makeDiskFolder, moveDiskFiles, removeDiskFolder, renameDiskFile, shareDisk } from "@/lib/social/disk.fn";
import type { DiskFile, DiskSnapshot } from "@/lib/social/disk";
import { cn } from "@/lib/utils";
import { loadError } from "@/lib/load-error";
import { previewPathPrefix } from "@/lib/preview-path-prefix";

function mb(bytes: number) {
  return (bytes / (1024 * 1024)).toLocaleString("ru-RU", { maximumFractionDigits: 1 });
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function downloadUrl(url: string, name: string) {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error("Не удалось скачать");
  saveBlob(await res.blob(), name);
}

function DiskTrack({ file, src, picked, onPlay, onPick }: { file: DiskFile; src: string; picked: boolean; onPlay: () => void; onPick: () => void }) {
  const [title, setTitle] = useState(file.name.replace(/\.[^.]+$/, ""));
  const [artist, setArtist] = useState("");
  const [sub, setSub] = useState("");
  const [cover, setCover] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    void loadTags(src, file.name)
      .then((tags) => {
        if (dead) return;
        setTitle(tags.title || file.name.replace(/\.[^.]+$/, ""));
        setArtist(tags.artist || "");
        setSub(musicBits(tags, file.bytes));
        setCover(coverUrl(tags.cover));
      })
      .catch(() => undefined);
    return () => {
      dead = true;
    };
  }, [file.bytes, file.name, src]);

  return (
    <div className="flex min-w-0 flex-1 items-start gap-2.5">
      <span className="relative mt-0.5 shrink-0">
        <button type="button" className="press block" onClick={onPlay}>
          {cover ? <img src={cover} alt="" loading="lazy" className="size-14 rounded-xl object-cover" /> : <span className="grid size-14 place-items-center rounded-xl bg-subtle text-sm text-faint">♪</span>}
        </button>
        <button
          type="button"
          aria-pressed={picked}
          aria-label={picked ? "Снять выбор" : "Выбрать"}
          className={cn("absolute -top-1.5 -left-1.5 z-10 grid size-6 place-items-center rounded-full border text-[11px] leading-none", picked ? "border-accent bg-accent text-accent-fg" : "border-line bg-bg text-transparent")}
          onClick={onPick}
        >
          ✓
        </button>
      </span>
      <span className="min-w-0 flex-1">
        <button type="button" className="press block w-full text-left text-[0.95rem] leading-snug break-words text-pretty" onClick={onPlay}>{title}</button>
        {artist ? (
          <span className="mt-0.5 block text-[0.8125rem] leading-snug text-pretty text-faint">
            <ArtistNames name={artist} className="text-faint" />
          </span>
        ) : null}
        {sub ? <span className="mt-1 block text-xs leading-none tabular-nums text-faint">{sub}</span> : null}
      </span>
    </div>
  );
}

function OwnDisk() {
  const tx = useTx();
  const [disk, setDisk] = useState<DiskSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cacheNote, setCacheNote] = useState<string | null>(null);
  const [open, setOpen] = useState<DiskFile | null>(null);
  const [edit, setEdit] = useState<DiskFile | null>(null);
  const [sort, setSort] = useState<SortKey>("date");
  const [dir, setDir] = useState<SortDir>("desc");
  const [query, setQuery] = useState("");
  const [rev, setRev] = useState(0);
  const [folder, setFolder] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [folderName, setFolderName] = useState("");
  const [moving, setMoving] = useState(false);
  useCircleNest(Boolean(folder), () => {
    setFolder(null);
    setPicked([]);
    setMoving(false);
  });
  useCircleNest(Boolean(open), () => setOpen(null));
  useCircleNest(Boolean(edit), () => setEdit(null));
  useEffect(() => {
    const on = Boolean(folder || open || edit);
    window.dispatchEvent(new CustomEvent("vv-circle-nested", { detail: on }));
    return () => {
      window.dispatchEvent(new CustomEvent("vv-circle-nested", { detail: false }));
    };
  }, [folder, open, edit]);

  useEffect(() => {
    let cancelled = false;
    void getDisk()
      .then((next) => {
        if (!cancelled) setDisk(next);
      })
      .catch((err) => {
        if (!cancelled) setError(loadError(err instanceof Error ? err.message : "", "Диск не открылся"));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function remove(file: DiskFile) {
    if (busy) return;
    if (!window.confirm(`Убрать «${file.name}» с диска?`)) return;
    setBusy(true);
    try {
      setDisk(await deleteDiskFile({ data: file.id }));
      forgetTrack(file.id);
      if (open?.id === file.id) setOpen(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось убрать файл");
    } finally {
      setBusy(false);
    }
  }

  async function downloadAll() {
    if (busy) return;
    setBusy(true);
    setCacheNote("Кэшируем архив…");
    try {
      const res = await fetch("/api/disk", { credentials: "same-origin" });
      const type = res.headers.get("content-type") || "";
      if (!res.ok || type.includes("json") || !res.body) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message || "Архив не собрался");
      }
      const total = Number(res.headers.get("content-length") || 0);
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let got = 0;
      while (true) {
        const step = await reader.read();
        if (step.done) break;
        chunks.push(step.value);
        got += step.value.byteLength;
        if (total > 0) setCacheNote(`Кэш ${Math.min(99, Math.round((got / total) * 100))}%`);
      }
      const merged = new Uint8Array(got);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const blob = new Blob([merged.buffer as ArrayBuffer], { type: "application/zip" });
      let ready = blob;
      try {
        const cache = await caches.open("vvvion-disk");
        const key = new Request("/__vvvion_disk_zip__");
        await cache.put(key, new Response(blob, { headers: { "content-type": "application/zip" } }));
        const hit = await cache.match(key);
        if (hit) ready = await hit.blob();
        await cache.delete(key);
      } catch {
        ready = blob;
      }
      setCacheNote(null);
      saveBlob(ready, "vvvion-disk.zip");
    } catch (err) {
      setCacheNote(null);
      toast.error(err instanceof Error ? err.message : "Архив не собрался");
    } finally {
      setBusy(false);
    }
  }

  async function copyShare() {
    if (busy) return;
    setBusy(true);
    try {
      const { token } = await shareDisk();
      const prefix = previewPathPrefix(window.location.hostname, window.location.pathname) ?? "";
      const url = `${window.location.origin}${prefix}/d/${token}`;
      try {
        await navigator.clipboard.writeText(url);
        toast("Ссылка на диск скопирована");
      } catch {
        toast(url);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось сделать ссылку");
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p className="p-4 text-sm text-danger">{error}</p>;
  if (!disk) return <PageLoader />;

  const pool = disk.files.filter((file) => (folder ? file.folderId === folder : !file.folderId));
  const shown = compareFiles(
    pool.filter((file) => matchQuery(file.name, query)).map((file) => ({ ...file, folder: false })),
    sort,
    dir,
  );
  const images = shown.filter((file) => file.kind === "image");
  const voices = shown.filter((file) => file.kind === "audio");
  const ratio = disk.quota > 0 ? Math.min(1, disk.used / disk.quota) : 0;

  function srcOf(file: DiskFile) {
    return rev ? `${file.url}?r=${rev}` : file.url;
  }

  async function saveEdit(file: DiskFile, name: string, audio: AudioPatch | null) {
    if (name !== file.name) setDisk(await renameDiskFile({ data: { id: file.id, name } }));
    if (!audio?.full) return;
    const copy = new ArrayBuffer(audio.full.byteLength);
    new Uint8Array(copy).set(audio.full);
    const body = new FormData();
    body.set("op", "replace");
    body.set("id", file.id);
    body.set("file", new File([copy], name, { type: file.mime || "audio/mpeg" }));
    const res = await fetch("/api/disk", { method: "POST", credentials: "same-origin", body });
    const parsed = (await res.json().catch(() => ({}))) as { message?: string };
    if (!res.ok) throw new Error(parsed.message || "Теги не записались");
    dropTags(file.url);
    setRev((value) => value + 1);
    setDisk(await getDisk());
  }

  function toggle(id: string) {
    setPicked((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  async function moveTo(folderId: string | null) {
    if (!picked.length || busy) return;
    setBusy(true);
    try {
      setDisk(await moveDiskFiles({ data: { ids: picked, folderId } }));
      setPicked([]);
      setMoving(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tx({ ru: "Не удалось переместить", en: "Could not move", kk: "Жылжытылмады" }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto px-3 pt-3 pb-6">
      <section className="rounded-[1.7rem] border border-line bg-elev px-4 py-4">
        <p className="text-xs tracking-[0.22em] text-faint uppercase">{tx({ ru: "Диск", en: "Disk", kk: "Диск" })}</p>
        <p className="mt-1 font-serif text-4xl leading-none">
          {mb(disk.used)} <span className="text-2xl text-muted">{tx({ ru: `из ${mb(disk.quota)} МБ`, en: `of ${mb(disk.quota)} MB`, kk: `${mb(disk.quota)} МБ ішінен` })}</span>
        </p>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-subtle">
          <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(ratio > 0 ? 4 : 0, ratio * 100)}%` }} />
        </div>
        <p className="mt-2 text-xs text-faint">{tx({ ru: "Сюда сами складываются картинки и голосовые из чата. Нет места — новые картинки не рисуются.", en: "Pictures and voice notes from the chat land here on their own. No space means no new pictures.", kk: "Чаттағы сурет пен дауыс осында өзі түседі. Орын болмаса, жаңа сурет салынбайды." })}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="press inline-flex h-10 items-center gap-2 rounded-xl bg-accent px-3 text-sm font-medium text-accent-fg disabled:opacity-40"
            disabled={busy || disk.files.length === 0}
            onClick={() => void downloadAll()}
          >
            <Download className="size-4" />
            {cacheNote ?? tx({ ru: "Скачать всё архивом", en: "Download everything", kk: "Бәрін архивпен жүктеу" })}
          </button>
          <button
            type="button"
            className="press inline-flex h-10 items-center gap-2 rounded-xl border border-line px-3 text-sm disabled:opacity-40"
            disabled={busy}
            onClick={() => void copyShare()}
          >
            <Link2 className="size-4" />
            {tx({ ru: "Общая ссылка", en: "Shared link", kk: "Ортақ сілтеме" })}
          </button>
        </div>
      </section>

      <section className="mt-3 rounded-3xl border border-line bg-bg px-3 py-3">
        {folder ? (
          <button type="button" className="press mb-2 text-sm text-muted" onClick={() => { setFolder(null); setPicked([]); setMoving(false); }}>
            ← {tx({ ru: "Все файлы", en: "All files", kk: "Барлық файл" })}
          </button>
        ) : disk.folders.length > 0 ? (
          <ul className="mb-2 space-y-1">
            {disk.folders.map((item) => (
              <li key={item.id} className="flex items-center gap-2">
                <button type="button" className="press flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => { setFolder(item.id); setPicked([]); setMoving(false); }}>
                  <Folder className="size-4 shrink-0 text-muted" />
                  <span className="truncate text-sm">{item.name}</span>
                </button>
                <button
                  type="button"
                  className="press grid size-8 place-items-center rounded-lg text-muted"
                  aria-label={tx({ ru: "Убрать папку", en: "Remove folder", kk: "Қалтаны алу" })}
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm(tx({ ru: `Убрать папку «${item.name}»? Файлы останутся в корне.`, en: `Remove “${item.name}”? Files stay at the root.`, kk: `«${item.name}» қалтасын алу керек пе? Файлдар түбірде қалады.` }))) return;
                    setBusy(true);
                    void removeDiskFolder({ data: item.id })
                      .then((next) => {
                        setDisk(next);
                        if (folder === item.id) setFolder(null);
                      })
                      .catch((err: unknown) => toast.error(err instanceof Error ? err.message : tx({ ru: "Папка не убралась", en: "The folder stayed", kk: "Қалта кетпеді" })))
                      .finally(() => setBusy(false));
                  }}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex gap-2">
          <input
            value={folderName}
            onChange={(event) => setFolderName(event.target.value)}
            placeholder={tx({ ru: "Новая папка", en: "New folder", kk: "Жаңа қалта" })}
            maxLength={80}
            className="field h-10 min-w-0 flex-1 rounded-xl text-sm"
          />
          <button
            type="button"
            className="press inline-flex h-10 items-center gap-2 rounded-xl border border-line px-3 text-sm disabled:opacity-40"
            disabled={busy || !folderName.trim()}
            onClick={() => {
              setBusy(true);
              void makeDiskFolder({ data: folderName.trim() })
                .then((next) => {
                  setDisk(next);
                  setFolderName("");
                })
                .catch((err: unknown) => toast.error(err instanceof Error ? err.message : tx({ ru: "Папка не создалась", en: "The folder was not created", kk: "Қалта жасалмады" })))
                .finally(() => setBusy(false));
            }}
          >
            <FolderPlus className="size-4" />
            {tx({ ru: "Папка", en: "Folder", kk: "Қалта" })}
          </button>
        </div>
        {pool.length > 0 ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" className="press h-8 rounded-xl px-2 text-xs text-muted" onClick={() => setPicked(shown.map((file) => file.id))}>
              {tx({ ru: "Выбрать все", en: "Select all", kk: "Бәрін таңдау" })}
            </button>
            {picked.length > 0 ? (
              <>
                <span className="text-xs text-faint">{tx({ ru: `Выбрано ${picked.length}`, en: `Selected ${picked.length}`, kk: `Таңдалды ${picked.length}` })}</span>
                <button type="button" className="press h-8 rounded-xl bg-accent px-2.5 text-xs font-medium text-accent-fg" onClick={() => setMoving((value) => !value)}>
                  {tx({ ru: "В папку", en: "Into a folder", kk: "Қалтаға" })}
                </button>
                <button type="button" className="press h-8 rounded-xl px-2 text-xs text-muted" onClick={() => { setPicked([]); setMoving(false); }}>
                  {tx({ ru: "Снять", en: "Clear", kk: "Алу" })}
                </button>
              </>
            ) : null}
          </div>
        ) : null}
        {moving ? (
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="press h-8 rounded-xl border border-line px-2.5 text-xs" disabled={busy} onClick={() => void moveTo(null)}>
              {tx({ ru: "Корень", en: "Root", kk: "Түбір" })}
            </button>
            {disk.folders.filter((item) => item.id !== folder).map((item) => (
              <button key={item.id} type="button" className="press h-8 max-w-40 truncate rounded-xl border border-line px-2.5 text-xs" disabled={busy} onClick={() => void moveTo(item.id)}>
                {item.name}
              </button>
            ))}
          </div>
        ) : null}
      </section>

      {disk.files.length === 0 ? (
        <p className="mt-4 px-1 text-sm text-faint">{tx({ ru: "Пока пусто. Нарисуйте картинку в чате или запишите голос.", en: "Nothing yet. Draw a picture in the chat or record a voice.", kk: "Әзірге бос. Чатта сурет салыңыз немесе дауыс жазыңыз." })}</p>
      ) : (
        <FileBar query={query} sort={sort} dir={dir} onQuery={setQuery} onSort={setSort} onDir={() => setDir((value) => (value === "asc" ? "desc" : "asc"))} />
      )}
      {disk.files.length > 0 && shown.length === 0 ? <p className="mt-4 px-1 text-sm text-faint">{tx({ ru: "Ничего не нашлось.", en: "Nothing matched.", kk: "Ештеңе табылмады." })}</p> : null}

      {images.length > 0 ? (
        <section className="mt-4">
          <h3 className="px-1 text-sm font-medium">{tx({ ru: "Картинки", en: "Pictures", kk: "Суреттер" })}</h3>
          <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {images.map((file) => (
              <li key={file.id} className="overflow-hidden rounded-2xl border border-line bg-bg">
                <button type="button" className="block w-full" onClick={() => setOpen(file)}>
                  <img src={srcOf(file)} alt={file.name} loading="lazy" className="aspect-square w-full object-cover" />
                </button>
                <div className="flex items-center gap-1 px-2 py-1.5">
                  <button type="button" aria-pressed={picked.includes(file.id)} className={cn("press grid size-8 shrink-0 place-items-center rounded-lg text-xs", picked.includes(file.id) ? "bg-accent text-accent-fg" : "text-muted")} onClick={() => toggle(file.id)}>
                    {picked.includes(file.id) ? "✓" : ""}
                  </button>
                  <p className="min-w-0 flex-1 truncate text-xs text-muted">{file.name}</p>
                  <button type="button" className="press grid size-8 place-items-center rounded-lg text-muted" aria-label="Изменить" onClick={() => setEdit(file)}>
                    <Pencil className="size-3.5" />
                  </button>
                  <button type="button" className="press grid size-8 place-items-center rounded-lg text-muted" aria-label="Скачать" onClick={() => void downloadUrl(`${file.url}?dl=1`, file.name).catch(() => toast.error("Не удалось скачать"))}>
                    <Download className="size-3.5" />
                  </button>
                  <button type="button" className="press grid size-8 place-items-center rounded-lg text-muted" aria-label="Убрать" disabled={busy} onClick={() => void remove(file)}>
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {voices.length > 0 ? (
        <section className="mt-4">
          <h3 className="px-1 text-sm font-medium">{tx({ ru: "Звук", en: "Sound", kk: "Дыбыс" })}</h3>
          <ul className="mt-2 space-y-2">
            {voices.map((file) => {
              const music = isMusicFile(file.name, file.mime);
              const songs = voices.filter((item) => isMusicFile(item.name, item.mime));
              return (
                <li key={`${file.id}:${rev}`} className="rounded-2xl border border-line bg-bg px-3 py-2">
                  <div className="flex items-start gap-1">
                    {music ? (
                      <DiskTrack
                        file={file}
                        src={srcOf(file)}
                        picked={picked.includes(file.id)}
                        onPick={() => toggle(file.id)}
                        onPlay={() => {
                          const at = Math.max(0, songs.findIndex((item) => item.id === file.id));
                          openAlbum(
                            songs.map((item) => ({ src: srcOf(item), name: item.name, bytes: item.bytes })),
                            at,
                          );
                        }}
                      />
                    ) : (
                      <>
                        <button type="button" aria-pressed={picked.includes(file.id)} className={cn("press mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border text-[11px] leading-none", picked.includes(file.id) ? "border-accent bg-accent text-accent-fg" : "border-line bg-bg text-transparent")} onClick={() => toggle(file.id)}>
                          ✓
                        </button>
                        <p className="min-w-0 flex-1 py-1 text-[0.95rem] leading-snug break-words">{file.name}</p>
                      </>
                    )}
                    <div className="flex shrink-0">
                    <button type="button" className="press grid size-8 place-items-center rounded-lg text-muted" aria-label="Изменить" onClick={() => setEdit(file)}>
                      <Pencil className="size-3.5" />
                    </button>
                    <button type="button" className="press grid size-8 place-items-center rounded-lg text-muted" aria-label="Скачать" onClick={() => void downloadUrl(`${file.url}?dl=1`, file.name).catch(() => toast.error("Не удалось скачать"))}>
                      <Download className="size-3.5" />
                    </button>
                    <button type="button" className="press grid size-8 place-items-center rounded-lg text-muted" aria-label="Убрать" disabled={busy} onClick={() => void remove(file)}>
                      <Trash2 className="size-3.5" />
                    </button>
                    </div>
                  </div>
                  {music ? null : <audio controls preload="metadata" src={srcOf(file)} className="mt-2 h-9 w-full" />}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {open ? (
        <div className="fixed inset-0 z-[80] flex flex-col bg-black/80 p-3" role="dialog" aria-modal="true" aria-label={open.name}>
          <div className="flex items-center justify-between gap-2">
            <BackButton onClick={() => setOpen(null)} label="Назад" className="text-white" />
            <div className="flex items-center gap-2">
            <button
              type="button"
              className="press inline-flex h-11 items-center gap-2 rounded-2xl bg-elev px-3 text-sm"
              onClick={() => void downloadUrl(`${open.url}?dl=1`, open.name).catch(() => toast.error("Не удалось скачать"))}
            >
              <Download className="size-4" />
              Скачать
            </button>
            <button type="button" className="press hidden h-11 rounded-2xl border border-line bg-elev px-3 text-sm md:inline-flex" onClick={() => setOpen(null)}>
              Закрыть
            </button>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center gap-2">
            {images.length > 1 ? (
              <button type="button" className="press grid size-11 shrink-0 place-items-center rounded-2xl bg-elev text-lg" aria-label="Предыдущая" onClick={() => {
                const at = images.findIndex((file) => file.id === open.id);
                const next = images[(at - 1 + images.length) % images.length];
                if (next) setOpen(next);
              }}>‹</button>
            ) : null}
            <img src={srcOf(open)} alt={open.name} loading="lazy" className="max-h-full max-w-full object-contain" />
            {images.length > 1 ? (
              <button type="button" className="press grid size-11 shrink-0 place-items-center rounded-2xl bg-elev text-lg" aria-label="Следующая" onClick={() => {
                const at = images.findIndex((file) => file.id === open.id);
                const next = images[(at + 1) % images.length];
                if (next) setOpen(next);
              }}>›</button>
            ) : null}
          </div>
        </div>
      ) : null}
      {edit ? (
        <FileEditor
          file={{ id: edit.id, name: edit.name, bytes: edit.bytes, src: srcOf(edit) }}
          music={edit.kind === "audio" && isMusicFile(edit.name, edit.mime)}
          busy={busy}
          onClose={() => setEdit(null)}
          onSave={(name, audio) => saveEdit(edit, name, audio)}
        />
      ) : null}
    </div>
  );
}

export function Disk() {
  const tx = useTx();
  const [lane, setLane] = useState<"own" | "mega">("own");
  useEffect(() => {
    try {
      if (sessionStorage.getItem("vvvion.disk-lane") === "mega") setLane("mega");
    } catch {
      /* private mode */
    }
  }, []);
  function choose(next: "own" | "mega") {
    setLane(next);
    try {
      sessionStorage.setItem("vvvion.disk-lane", next);
    } catch {
      /* private mode */
    }
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex gap-1 px-3 pt-3">
        <button
          type="button"
          aria-pressed={lane === "own"}
          className={cn("press h-9 rounded-full px-3 text-sm", lane === "own" ? "bg-accent text-accent-fg" : "text-muted")}
          onClick={() => choose("own")}
        >
          {tx({ ru: "Диск", en: "Disk", kk: "Диск" })}
        </button>
        <button
          type="button"
          aria-pressed={lane === "mega"}
          className={cn("press h-9 rounded-full px-3 text-sm", lane === "mega" ? "bg-accent text-accent-fg" : "text-muted")}
          onClick={() => choose("mega")}
        >
          {tx({ ru: "Мегадиск", en: "Megadisk", kk: "Мегадиск" })}
        </button>
      </div>
      <div className="min-h-0 flex-1">{lane === "mega" ? <MegaDisk /> : <OwnDisk />}</div>
    </div>
  );
}
