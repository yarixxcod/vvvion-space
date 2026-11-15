import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize2, Play, X } from "lucide-react";
import { BackButton } from "@/components/yaronetic/back-button";
import { pushBackLayer } from "@/lib/app-back";
import { cn } from "@/lib/utils";

type Box = { w: number; h: number };

/** Plays a clip in its real frame: tall video stays tall, wide video stays wide. */
export function FileVideo({ src, name, stage = false }: { src: string; name: string; stage?: boolean }) {
  const node = useRef<HTMLVideoElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [armed, setArmed] = useState(stage);
  const [theater, setTheater] = useState(false);
  const portrait = Boolean(box && box.h > box.w * 1.05);
  const ratio = box ? `${box.w} / ${box.h}` : undefined;

  function remember(video: HTMLVideoElement) {
    if (video.videoWidth > 0 && video.videoHeight > 0) setBox({ w: video.videoWidth, h: video.videoHeight });
    setArmed(true);
  }

  return (
    <>
      <div
        className={cn(
          "relative overflow-hidden bg-black",
          stage ? "flex max-h-full max-w-full items-center justify-center" : "mt-1.5 rounded-2xl",
          !stage && portrait && "mx-auto w-fit max-w-full",
          !stage && !portrait && "w-full",
        )}
      >
        <video
          ref={node}
          src={src}
          controls={armed}
          playsInline
          preload="metadata"
          className={cn(
            "bg-black object-contain",
            stage && "max-h-[min(82dvh,100%)] max-w-full",
            !stage && portrait && "max-h-[min(78dvh,720px)] w-auto max-w-full",
            !stage && !portrait && "max-h-[min(62dvh,480px)] w-full",
          )}
          style={ratio ? { aspectRatio: ratio } : undefined}
          onLoadedMetadata={(event) => remember(event.currentTarget)}
          onPlay={() => setArmed(true)}
        />
        {!armed && !stage ? (
          <button
            type="button"
            className="absolute inset-0 grid place-items-center"
            aria-label={`Смотреть ${name}`}
            onClick={() => void node.current?.play()}
          >
            <span className="grid size-11 place-items-center rounded-full bg-white/90 text-black">
              <Play className="size-4 fill-current" />
            </span>
          </button>
        ) : null}
        {box && !stage ? (
          <button
            type="button"
            className="press absolute right-2 bottom-2 inline-flex size-9 items-center justify-center rounded-full bg-black/55 text-white"
            aria-label="На весь экран"
            onClick={() => {
              node.current?.pause();
              setTheater(true);
            }}
          >
            <Maximize2 className="size-4" />
          </button>
        ) : null}
      </div>
      {theater ? <Theater src={src} name={name} portrait={portrait} onClose={() => setTheater(false)} /> : null}
    </>
  );
}

function Theater({ src, name, portrait, onClose }: { src: string; name: string; portrait: boolean; onClose: () => void }) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => setNode(document.body), []);
  useEffect(() => pushBackLayer(() => closeRef.current()), []);
  if (!node) return null;
  return createPortal(
    <div className="fixed inset-0 z-[90] flex flex-col bg-black" role="dialog" aria-modal="true" aria-label={name}>
      <div className="flex items-center gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <BackButton onClick={onClose} label="Назад" className="text-white" />
        <p className="min-w-0 flex-1 truncate text-sm text-white">{name}</p>
        <button type="button" className="press hidden size-11 items-center justify-center rounded-2xl bg-white/10 text-white md:inline-flex" aria-label="Закрыть" onClick={onClose}>
          <X className="size-4" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <video
          src={src}
          controls
          autoPlay
          playsInline
          className={cn("bg-black object-contain", portrait ? "max-h-full w-auto max-w-full" : "max-h-full w-full")}
        />
      </div>
    </div>,
    node,
  );
}
