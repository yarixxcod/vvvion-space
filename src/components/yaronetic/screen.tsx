import { useEffect, useRef, useState, type FormEvent } from "react";
import { Maximize2, Play, Trash2, X } from "lucide-react";
import { BackButton } from "@/components/yaronetic/back-button";
import { toast } from "sonner";
import { PageLoader } from "@/components/yaronetic/page-loader";
import { getAccess } from "@/lib/social/admin";
import { useCircleNest } from "@/lib/circle-history";
import { addScreenVideo, listScreen, removeScreenVideo, type ScreenVideo } from "@/lib/screen/service";

const LABEL = { youtube: "YouTube", rutube: "Rutube", vk: "VK" } as const;

export function Screen() {
  const [rows, setRows] = useState<ScreenVideo[] | null>(null);
  const [admin, setAdmin] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [watch, setWatch] = useState<ScreenVideo | null>(null);
  useCircleNest(Boolean(watch), () => setWatch(null));
  useEffect(() => {
    if (!watch) return;
    window.dispatchEvent(new CustomEvent("vv-circle-nested", { detail: true }));
    return () => {
      window.dispatchEvent(new CustomEvent("vv-circle-nested", { detail: false }));
    };
  }, [watch]);

  useEffect(() => {
    let dead = false;
    void listScreen()
      .then((next) => {
        if (!dead) setRows(next);
      })
      .catch(() => {
        if (!dead) setRows([]);
      });
    void getAccess()
      .then((access) => {
        if (!dead) setAdmin(access.role === "admin");
      })
      .catch(() => undefined);
    return () => {
      dead = true;
    };
  }, []);

  async function add(event: FormEvent) {
    event.preventDefault();
    if (busy || !url.trim()) return;
    setBusy(true);
    try {
      const saved = await addScreenVideo({ data: { url } });
      setRows((current) => [saved, ...(current ?? []).filter((item) => item.id !== saved.id)]);
      setUrl("");
      setWatch(saved);
      toast("Ролик на полке");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ролик не добавился");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (busy) return;
    setBusy(true);
    try {
      await removeScreenVideo({ data: id });
      setRows((current) => current?.filter((item) => item.id !== id) ?? []);
      if (watch?.id === id) setWatch(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось убрать");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-4 pt-4">
        <h3 className="font-serif text-2xl tracking-tight">Смотрельня</h3>
        <p className="mt-1 max-w-md text-sm text-muted">Ролики YouTube, Rutube и VK. Смотреть можно здесь, на весь экран тоже.</p>
        {admin ? (
          <form className="mt-3 flex gap-2" onSubmit={(event) => void add(event)}>
            <input
              className="field"
              value={url}
              placeholder="Ссылка на ролик"
              onChange={(event) => setUrl(event.target.value)}
            />
            <button type="submit" disabled={busy || !url.trim()} className="press h-11 shrink-0 rounded-2xl bg-accent px-3 text-sm font-medium text-accent-fg disabled:opacity-40">
              Добавить
            </button>
          </form>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {rows === null ? <PageLoader compact /> : null}
        {rows && rows.length === 0 ? <p className="text-sm text-faint">Пока нет роликов.</p> : null}
        <ul className="grid gap-3 sm:grid-cols-2">
          {(rows ?? []).map((video) => (
            <Thumb key={video.id} video={video} admin={admin} busy={busy} onOpen={() => setWatch(video)} onRemove={() => void remove(video.id)} />
          ))}
        </ul>
      </div>
      {watch ? <Player video={watch} onClose={() => setWatch(null)} /> : null}
    </div>
  );
}

function Thumb({
  video,
  admin,
  busy,
  onOpen,
  onRemove,
}: {
  video: ScreenVideo;
  admin: boolean;
  busy: boolean;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const [bad, setBad] = useState(false);
  return (
    <li className="overflow-hidden rounded-[1.4rem] border border-line bg-elev">
      <button type="button" className="relative block w-full text-left" onClick={onOpen}>
        {video.thumb && !bad ? (
          <img
            src={video.thumb}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setBad(true)}
            className="aspect-video w-full bg-subtle object-cover"
          />
        ) : (
          <span className="grid aspect-video w-full place-items-center bg-subtle font-serif text-3xl text-muted">{LABEL[video.provider]}</span>
        )}
        <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-xs text-white">
          <Play className="size-3" />
          {LABEL[video.provider]}
        </span>
      </button>
      <div className="flex items-start gap-2 px-3 py-2">
        <p className="min-w-0 flex-1 text-sm">{video.title}</p>
        {admin ? (
          <button type="button" className="press grid size-8 shrink-0 place-items-center rounded-lg text-muted" aria-label="Убрать ролик" disabled={busy} onClick={onRemove}>
            <Trash2 className="size-3.5" />
          </button>
        ) : null}
      </div>
    </li>
  );
}

function Player({ video, onClose }: { video: ScreenVideo; onClose: () => void }) {
  const frame = useRef<HTMLDivElement>(null);
  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-black/80 p-3" role="dialog" aria-modal="true" aria-label={video.title}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <BackButton onClick={onClose} label="Назад" className="text-white" />
        <div className="flex items-center gap-2">
        <button
          type="button"
          className="press inline-flex h-11 items-center gap-1.5 rounded-2xl bg-elev px-3 text-sm"
          onClick={() => {
            const node = frame.current;
            if (!node) return;
            if (document.fullscreenElement) void document.exitFullscreen();
            else void node.requestFullscreen().catch(() => undefined);
          }}
        >
          <Maximize2 className="size-4" />
          На весь экран
        </button>
        <button type="button" className="press hidden h-11 items-center gap-1.5 rounded-2xl border border-line bg-elev px-3 text-sm md:inline-flex" onClick={onClose}>
          <X className="size-4" />
          Закрыть
        </button>
        </div>
      </div>
      <div ref={frame} className="relative min-h-0 w-full flex-1 bg-black">
        <iframe
          title={video.title}
          src={video.embedUrl}
          className="absolute inset-0 h-full w-full"
          allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
    </div>
  );
}
