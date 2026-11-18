import { Heart } from "lucide-react";
export function MessageLike({
  liked = false,
  count = 0,
  busy = false,
  onClick,
}: {
  liked?: boolean;
  count?: number;
  busy?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={liked ? "Убрать лайк" : "Нравится сообщение"}
      aria-pressed={liked}
      disabled={busy}
      className={`like-chip press inline-flex min-h-9 items-center justify-center gap-1 rounded-full border px-2.5 text-xs transition-colors ${liked ? "border-accent bg-subtle text-accent" : "border-line bg-elev text-muted"}`}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <Heart className="size-3.5" fill={liked ? "currentColor" : "none"} />
      {count > 0 ? <span>{count}</span> : null}
    </button>
  );
}
