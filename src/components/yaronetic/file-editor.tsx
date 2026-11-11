import { useEffect, useState } from "react";
import { toast } from "sonner";
import { BackButton } from "@/components/yaronetic/back-button";
import { coverUrl, readTags } from "@/lib/music/tags";
import { planTagWrite, type TagFields } from "@/lib/music/write";

const REWRITE_MAX = 32 * 1024 * 1024;

export type AudioPatch = {
  header: Uint8Array | null;
  full: Uint8Array | null;
};

async function take(res: Response, cap: number): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array(await res.arrayBuffer()).subarray(0, cap);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  while (got < cap) {
    const step = await reader.read();
    if (step.done) break;
    chunks.push(step.value);
    got += step.value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  const merged = new Uint8Array(Math.min(got, cap));
  let offset = 0;
  for (const chunk of chunks) {
    const room = merged.length - offset;
    if (room < 1) break;
    const slice = chunk.subarray(0, room);
    merged.set(slice, offset);
    offset += slice.length;
  }
  return merged.subarray(0, offset);
}

async function coverFromFile(file: File): Promise<{ mime: "image/jpeg"; bytes: Uint8Array }> {
  const bmp = await createImageBitmap(file);
  const max = 720;
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bmp.close?.();
    throw new Error("Обложка не прочиталась");
  }
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  let quality = 0.86;
  let blob: Blob | null = null;
  for (let i = 0; i < 5; i += 1) {
    blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((next) => resolve(next), "image/jpeg", quality));
    if (blob && blob.size <= 320_000) break;
    quality -= 0.14;
  }
  if (!blob || blob.size < 32 || blob.size > 380_000) throw new Error("Обложка слишком большая");
  return { mime: "image/jpeg", bytes: new Uint8Array(await blob.arrayBuffer()) };
}

function overlay(file: Uint8Array, header: Uint8Array): Uint8Array {
  const next = new Uint8Array(file);
  next.set(header, 0);
  return next;
}

export function FileEditor({
  file,
  music,
  busy,
  onClose,
  onSave,
}: {
  file: { id: string; name: string; bytes: number; src: string };
  music: boolean;
  busy: boolean;
  onClose: () => void;
  onSave: (name: string, audio: AudioPatch | null) => Promise<void>;
}) {
  const [name, setName] = useState(file.name);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [genre, setGenre] = useState("");
  const [album, setAlbum] = useState("");
  const [cover, setCover] = useState<TagFields["cover"]>(null);
  const [coverTouched, setCoverTouched] = useState(false);
  const [base, setBase] = useState({ title: "", artist: "", genre: "", cover: "" });
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [partial, setPartial] = useState(false);
  const [reading, setReading] = useState(music);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!music) return;
    let dead = false;
    const ctrl = new AbortController();
    setReading(true);
    void (async () => {
      try {
        const huge = file.bytes > REWRITE_MAX;
        const res = await fetch(file.src, {
          credentials: "same-origin",
          signal: ctrl.signal,
          headers: huge ? { Range: "bytes=0-524287" } : undefined,
        });
        if (!res.ok && res.status !== 206) throw new Error("Файл не прочитался");
        const raw = huge ? await take(res, 524_288) : new Uint8Array(await res.arrayBuffer());
        if (dead) return;
        const tags = readTags(raw);
        setBytes(raw);
        setPartial(huge);
        setTitle(tags.title);
        setArtist(tags.artist);
        setGenre(tags.genre);
        setAlbum(tags.album);
        setCover(tags.cover);
        setCoverTouched(false);
        setBase({ title: tags.title, artist: tags.artist, genre: tags.genre, cover: tags.cover ? String(tags.cover.bytes.length) : "" });
      } catch (error) {
        if (!dead && !(error instanceof DOMException && error.name === "AbortError")) {
          toast.error(error instanceof Error ? error.message : "Файл не прочитался");
        }
      } finally {
        if (!dead) setReading(false);
      }
    })();
    return () => {
      dead = true;
      ctrl.abort();
    };
  }, [file.bytes, file.src, music]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  async function pickCover(list: File[]) {
    const image = list[0];
    if (!image) return;
    try {
      setCover(await coverFromFile(image));
      setCoverTouched(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Обложка не подошла");
    }
  }

  async function save() {
    const nextName = name.trim();
    if (!nextName) {
      toast("Сначала имя");
      return;
    }
    const changedTags =
      music &&
      (title.trim() !== base.title || artist.trim() !== base.artist || genre.trim() !== base.genre || coverTouched);
    let audio: AudioPatch | null = null;
    if (changedTags) {
      if (!bytes) {
        toast(reading ? "Файл ещё читается" : "Файл не прочитался");
        return;
      }
      const plan = planTagWrite(bytes, { title, artist, album, genre, cover }, { partial });
      if (plan.mode === "no") {
        if (nextName === file.name) {
          toast(plan.reason);
          return;
        }
        toast(plan.reason);
      } else if (plan.mode === "keep") {
        audio = { header: plan.header, full: partial ? null : overlay(bytes, plan.header) };
      } else if (plan.mode === "rewrite") {
        audio = { header: null, full: plan.file };
      }
    }
    if (nextName === file.name && !audio) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      await onSave(nextName, audio);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не сохранилось");
    } finally {
      setSaving(false);
    }
  }

  const preview = coverUrl(cover);
  const locked = busy || saving;

  return (
    <div className="fixed inset-0 z-[85] flex items-end justify-center bg-black/50 p-3 sm:items-center" role="dialog" aria-modal="true" aria-label="Файл">
      <form
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-3xl border border-line bg-elev p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="flex items-center gap-1">
          <BackButton onClick={onClose} label="Назад" />
          <p className="font-serif text-2xl">Файл</p>
        </div>
        <label className="mt-3 block text-xs text-faint">
          Имя
          <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} className="field mt-1 h-10 w-full rounded-xl text-sm text-fg" />
        </label>
        {music ? (
          <div className="mt-3">
            <div className="flex items-center gap-3">
              {preview ? <img src={preview} alt="" className="size-16 rounded-2xl object-cover" /> : <span className="grid size-16 place-items-center rounded-2xl bg-subtle text-xs text-faint">Нет</span>}
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <label className="press inline-flex h-9 cursor-pointer items-center justify-center rounded-xl border border-line px-3 text-sm">
                  Обложка
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    disabled={locked || reading}
                    onChange={(event) => {
                      const list = Array.from(event.target.files ?? []);
                      event.target.value = "";
                      void pickCover(list);
                    }}
                  />
                </label>
                {cover ? (
                  <button
                    type="button"
                    className="press h-8 rounded-xl text-xs text-muted"
                    disabled={locked}
                    onClick={() => {
                      setCover(null);
                      setCoverTouched(true);
                    }}
                  >
                    Убрать обложку
                  </button>
                ) : null}
              </div>
            </div>
            <label className="mt-3 block text-xs text-faint">
              Название
              <input value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} className="field mt-1 h-10 w-full rounded-xl text-sm text-fg" disabled={reading} />
            </label>
            <label className="mt-2 block text-xs text-faint">
              Исполнитель
              <input
                value={artist}
                maxLength={160}
                placeholder="Имя, фиты через запятую"
                onChange={(event) => setArtist(event.target.value)}
                className="field mt-1 h-10 w-full rounded-xl text-sm text-fg"
                disabled={reading}
              />
            </label>
            <label className="mt-2 block text-xs text-faint">
              Жанр
              <input value={genre} maxLength={80} onChange={(event) => setGenre(event.target.value)} className="field mt-1 h-10 w-full rounded-xl text-sm text-fg" disabled={reading} />
            </label>
            <p className="mt-2 text-xs text-faint">{reading ? "Читаем теги…" : "Фиты пишите в исполнителя. В mp3 это записывается в сам файл."}</p>
          </div>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="press hidden h-10 rounded-xl border border-line px-3 text-sm md:inline-flex" disabled={locked} onClick={onClose}>
            Закрыть
          </button>
          <button type="submit" className="press h-10 rounded-xl bg-accent px-3 text-sm font-medium text-accent-fg disabled:opacity-40" disabled={locked || (reading && music)}>
            {saving ? "Сохраняем…" : "Сохранить"}
          </button>
        </div>
      </form>
    </div>
  );
}
