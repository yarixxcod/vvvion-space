import { Heart } from "lucide-react";
import { cn } from "@/lib/utils";

export function LikePin({
  liked = false,
  busy = false,
  end = false,
  dock = false,
  onClick,
}: {
  liked?: boolean;
  busy?: boolean;
  end?: boolean;
  dock?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={liked ? "Убрать лайк" : "Нравится"}
      aria-pressed={liked}
      disabled={busy}
      className={cn(
        "like-pin press inline-flex size-6 items-center justify-center text-[#2f80ff]",
        dock ? "relative" : cn("absolute -bottom-3 z-[1]", end ? "right-0" : "left-0"),
        dock && end && "ml-auto",
      )}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <Heart className="size-4" fill={liked ? "currentColor" : "none"} strokeWidth={2.25} />
    </button>
  );
}

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
      disabled={busy}
      className={
        bare
          ? "like-pin press inline-flex size-6 items-center justify-center text-[#2f80ff]"
          : `like-chip press inline-flex min-h-9 items-center justify-center gap-1 rounded-full border px-2.5 text-xs transition-colors ${liked ? "border-accent bg-subtle text-accent" : "border-line bg-elev text-muted"}`
      }
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <Heart className={bare ? "size-4" : "size-3.5"} fill={liked ? "currentColor" : "none"} strokeWidth={2.25} />
      {!bare && count > 0 ? <span>{count}</span> : null}
    </button>
  );
}
