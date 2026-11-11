import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileArchive, FileText, Heart, Play, X } from "lucide-react";
import { BackButton } from "@/components/yaronetic/back-button";
import type { FeedFile } from "@/lib/social/feed";
import { pushBackLayer } from "@/lib/app-back";
import { cn } from "@/lib/utils";

function sizeLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} МБ`;
}

export function FileVideo({ src, name }: { src: string; name: string }) {
  const node = useRef<HTMLVideoElement>(null);
  const [armed, setArmed] = useState(false);
  return (
    <div className="relative mt-1.5 overflow-hidden rounded-2xl bg-black">
      <video
        ref={node}
        src={src}
        controls={armed}
        playsInline
        preload="metadata"
        className="aspect-video max-h-72 w-full bg-black object-contain"
        onLoadedData={() => setArmed(true)}
        onPlay={() => setArmed(true)}
      />
      {armed ? null : (
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
      )}
    </div>
  );
}

export function PostAttachments({ files, urlFor, onLike }: { files: FeedFile[]; urlFor: (file: FeedFile) => string; onLike?: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [heart, setHeart] = useState(false);
  const last = useRef(0);
  const wait = useRef(0);
  const images = files.filter((file) => file.kind === "image");
  const videos = files.filter((file) => file.kind === "video");
  const docs = files.filter((file) => file.kind === "file");
  if (!files.length) return null;

  function tap(src: string) {
    const now = performance.now();
    if (onLike && now - last.current <= 300) {
      last.current = 0;
      window.clearTimeout(wait.current);
      onLike();
      setHeart(true);
      window.setTimeout(() => setHeart(false), 400);
      return;
    }
    last.current = now;
    window.clearTimeout(wait.current);
    wait.current = window.setTimeout(() => setOpen(src), onLike ? 280 : 0);
  }

  return (
    <div className="mt-2 space-y-2">
      {images.length > 0 ? (
        <div className={cn("relative grid gap-2", images.length === 1 ? "grid-cols-1" : "grid-cols-2")}>
          {images.map((file, index) => {
            const src = urlFor(file);
            const lead = images.length === 3 && index === 0;
            return (
              <button
                key={file.id}
                type="button"
                className={cn(
                  "press w-full overflow-hidden rounded-2xl bg-subtle",
                  lead && "col-span-2 aspect-video",
                  !lead && images.length > 1 && "aspect-[4/3]",
                  images.length === 1 && "max-h-[min(70dvh,560px)]",
                )}
                onClick={() => tap(src)}
              >
                <img
                  src={src}
                  alt={file.name}
                  className={cn("w-full bg-subtle", images.length === 1 ? "max-h-[min(70dvh,560px)] w-auto max-w-full object-contain" : "h-full object-cover")}
                />
              </button>
            );
          })}
          {heart ? <Heart className="heart-pop pointer-events-none absolute top-1/2 left-1/2 size-16 fill-white text-white" /> : null}
        </div>
      ) : null}
      {videos.map((file) => (
        <FileVideo key={file.id} src={urlFor(file)} name={file.name} />
      ))}
      {docs.length > 0 ? (
        <ul className="space-y-1.5">
          {docs.map((file) => {
            const zip = file.mime.includes("zip");
            const Icon = zip ? FileArchive : FileText;
            return (
              <li key={file.id}>
                <a
                  href={urlFor(file)}
                  download={file.name}
                  className="press flex items-center gap-3 rounded-2xl border border-line bg-bg px-3 py-2"
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-subtle text-muted">
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{file.name}</span>
                    <span className="text-xs text-faint">{zip ? "Архив" : file.mime === "application/pdf" ? "PDF" : "Файл"} · {sizeLabel(file.size)}</span>
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      ) : null}
      {open ? <PhotoLightbox src={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function PhotoLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const start = useRef({ y: 0, on: false });
  useEffect(() => setNode(document.body), []);
  useEffect(() => pushBackLayer(() => closeRef.current()), []);
  if (!node) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
      onPointerDown={(event) => {
        if (event.pointerType === "mouse") return;
        start.current = { y: event.clientY, on: true };
      }}
      onPointerUp={(event) => {
        if (!start.current.on) return;
        start.current.on = false;
        if (event.clientY - start.current.y >= 96) onClose();
      }}
    >
      <div className="absolute top-3 left-3 md:hidden">
        <BackButton onClick={onClose} label="Назад" className="text-white" />
      </div>
      <button
        type="button"
        className="press absolute top-4 right-4 hidden size-11 items-center justify-center rounded-2xl bg-elev text-fg md:inline-flex"
        aria-label="Закрыть фото"
        onClick={onClose}
      >
        <X className="size-4" />
      </button>
      <img src={src} alt="" className="max-h-[90dvh] max-w-full rounded-2xl object-contain" onClick={(event) => event.stopPropagation()} />
    </div>,
    node,
  );
}
