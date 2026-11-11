import { useEffect, useRef, useState } from "react";
import { Maximize2, Play, X } from "lucide-react";
import { BackButton } from "@/components/yaronetic/back-button";
import { getScreen, type ScreenVideo } from "@/lib/screen/service";

const LABEL = { youtube: "YouTube", rutube: "Rutube", vk: "VK" } as const;

const cache = new Map<string, { at: number; row: Promise<ScreenVideo | null> }>();

function loadOne(id: string): Promise<ScreenVideo | null> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < 30_000) return hit.row;
  const row = getScreen({ data: id }).catch((error) => {
    cache.delete(id);
    throw error;
  });
  cache.set(id, { at: Date.now(), row });
  return row;
}

export function ScreenClip({ id }: { id: string }) {
  const [video, setVideo] = useState<ScreenVideo | "miss" | "wait">("wait");
  const [open, setOpen] = useState(false);
  const [bad, setBad] = useState(false);

  useEffect(() => {
    let dead = false;
    void loadOne(id)
      .then((row) => {
        if (dead) return;
        setVideo(row ?? "miss");
      })
      .catch(() => {
        if (!dead) setVideo("miss");
      });
    return () => {
      dead = true;
    };
  }, [id]);

  if (video === "wait") {
    return <div className="mt-1.5 aspect-video w-full animate-pulse rounded-2xl bg-black/20" />;
  }
  if (video === "miss") {
    return <p className="mt-1.5 text-xs opacity-70">Ролик уже убрали</p>;
  }

  return (
    <>
      <button type="button" className="relative mt-1.5 block w-full overflow-hidden rounded-2xl bg-black text-left" onClick={() => setOpen(true)}>
        {video.thumb && !bad ? (
          <img src={video.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBad(true)} className="aspect-video w-full bg-subtle object-cover" />
        ) : (
          <span className="grid aspect-video w-full place-items-center bg-subtle font-serif text-3xl text-muted">{LABEL[video.provider]}</span>
        )}
        <span className="absolute inset-0 grid place-items-center">
          <span className="grid size-11 place-items-center rounded-full bg-white/90 text-black shadow">
            <Play className="size-4 fill-current" />
          </span>
        </span>
        <span className="absolute right-2 bottom-2 left-2 truncate rounded-full bg-black/55 px-2 py-1 text-left text-xs text-white">
          {LABEL[video.provider]} · {video.title}
        </span>
      </button>
      {open ? <ScreenPlayer video={video} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function ScreenPlayer({ video, onClose }: { video: ScreenVideo; onClose: () => void }) {
  const frame = useRef<HTMLDivElement>(null);
  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-black/80 p-3" role="dialog" aria-modal="true" aria-label={video.title}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <BackButton onClick={onClose} label="Назад" className="text-white" />
        <div className="flex items-center gap-2">
        <button
          type="button"
          className="press inline-flex h-11 items-center gap-1.5 rounded-2xl bg-elev px-3 text-sm text-fg"
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
        <button type="button" className="press hidden h-11 items-center gap-1.5 rounded-2xl border border-line bg-elev px-3 text-sm text-fg md:inline-flex" onClick={onClose}>
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
