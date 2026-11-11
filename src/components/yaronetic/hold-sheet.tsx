import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { pushBackLayer } from "@/lib/app-back";
import { useLongPress } from "@/lib/gestures/use-long-press";

export function HoldSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => setNode(document.body), []);
  useEffect(() => pushBackLayer(() => closeRef.current()), []);
  if (!node) return null;
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end bg-black/50" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="w-full rounded-t-3xl border border-line bg-elev px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]" onClick={(event) => event.stopPropagation()}>
        <p className="px-2 pb-2 text-center text-xs text-faint">{title}</p>
        {children}
      </div>
    </div>,
    node,
  );
}

export function Holdable({ text, className, children }: { text: string; className?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const hold = useLongPress(() => {
    if (text.trim()) setOpen(true);
  });
  return (
    <>
      <div
        className={className}
        onPointerDown={hold.onPointerDown}
        onPointerMove={hold.onPointerMove}
        onPointerUp={hold.onPointerUp}
        onPointerCancel={hold.onPointerCancel}
        onContextMenu={hold.onContextMenu}
      >
        {children}
      </div>
      {open ? (
        <HoldSheet title="Сообщение" onClose={() => setOpen(false)}>
          <button
            type="button"
            className="press flex min-h-12 w-full items-center rounded-2xl px-3 text-left text-base"
            onClick={() => {
              void navigator.clipboard.writeText(text).then(
                () => toast("Скопировано"),
                () => toast(text),
              );
              setOpen(false);
            }}
          >
            Копировать
          </button>
        </HoldSheet>
      ) : null}
    </>
  );
}
