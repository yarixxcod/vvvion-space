import { Heart, LoaderCircle, UserRound } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type ReactionActor = { id: string; label: string; image?: string | null; node?: ReactNode };
function ReactionAvatar({ actor }: { actor: ReactionActor }) {
  const [failed, setFailed] = useState(false);
  return <span title={actor.label} className="reaction-avatar grid size-6 shrink-0 place-items-center overflow-hidden rounded-full bg-subtle text-fg ring-2 ring-[var(--bg)]">
    {actor.node || (actor.image && !failed ? <img src={actor.image} alt="" className="size-full object-cover" onError={() => setFailed(true)} /> : <UserRound className="size-3.5" />)}
  </span>;
}

export function MessageLike({ liked = false, reacted = false, count = 0, busy = false, bare = false, actors = [], onClick }: {
  liked?: boolean; reacted?: boolean; count?: number; busy?: boolean; bare?: boolean; actors?: ReactionActor[]; onClick?: () => void;
}) {
  const active = liked || reacted;
  const names = actors.map(actor => actor.label).join(", ");
  const label = onClick ? `${liked ? "Убрать лайк" : "Нравится сообщение"}${names ? `. Реакции: ${names}` : ""}` : `Нравится: ${names || count}`;
  const content = <>
    {actors.length ? <span aria-hidden="true" className="mr-1 inline-flex items-center -space-x-2">{actors.slice(0, 3).map(actor => <ReactionAvatar key={`${actor.id}:${actor.image || ""}`} actor={actor} />)}</span> : null}
    {busy ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : <Heart aria-hidden="true" className="size-[18px]" fill={active ? "currentColor" : "none"} strokeWidth={2} />}
    {count > 0 ? <span>{count}</span> : null}
  </>;
  const className = cn("message-like press inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-full px-3 text-sm tabular-nums transition-colors disabled:cursor-wait", active ? "message-like-active" : "message-like-idle", !bare && "border border-current/20");
  if (!onClick) return <span className={className} role="img" aria-label={label}>{content}</span>;
  return <button type="button" aria-label={label} aria-pressed={liked} aria-busy={busy} disabled={busy} className={className}
    onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
    onClick={event => { event.stopPropagation(); onClick(); }}>{content}</button>;
}

/** One reaction group, aligned to the free right edge and outside the message content. */
export function LikePin({ end: _end, dock: _dock, ...props }: {
  liked?: boolean; reacted?: boolean; actors?: ReactionActor[]; count?: number; busy?: boolean; end?: boolean; dock?: boolean; onClick?: () => void;
}) {
  return <div className="message-reaction-row mt-1 flex min-h-11 w-full justify-end"><MessageLike {...props} bare /></div>;
}
