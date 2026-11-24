import { Heart, LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export function MessageLike({
  liked = false,
  count = 0,
  busy = false,
  bare = false,
  onClick,
}: {
  liked?: boolean;
  count?: number;
  busy?: boolean;
  bare?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={liked ? "Убрать лайк" : "Нравится сообщение"}
      aria-pressed={liked}
      aria-busy={busy}
      disabled={busy}
      className={cn(
        "message-like press inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-full px-3 text-sm tabular-nums transition-colors disabled:cursor-wait",
        liked ? "message-like-active" : "message-like-idle",
        !bare && "border border-current/20",
      )}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {busy ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : <Heart aria-hidden="true" className="size-[18px]" fill={liked ? "currentColor" : "none"} strokeWidth={2} />}
      {count > 0 ? <span>{count}</span> : null}
    </button>
  );
}

/** A reaction takes its own line in the layout; it never covers text, media or timestamps. */
export function LikePin({ end = false, dock: _dock, ...props }: {
  liked?: boolean; count?: number; busy?: boolean; end?: boolean; dock?: boolean; onClick: () => void;
}) {
  return <div className={cn("message-reaction-row mt-1 flex min-h-11 w-full", end ? "justify-end" : "justify-start")}><MessageLike {...props} bare /></div>;
}
