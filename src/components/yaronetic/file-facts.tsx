import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Info, MoreHorizontal, X } from "lucide-react";
import { sizeLabel } from "@/components/yaronetic/upload-meter";
import { pushBackLayer } from "@/lib/app-back";

function formatOf(name: string, mime: string): string {
  const clean = mime.toLowerCase().split(";")[0]?.trim() ?? "";
  if (clean && clean !== "application/octet-stream") return clean;
  const dot = name.lastIndexOf(".");
  if (dot > 0 && name.length - dot <= 8) return name.slice(dot + 1).toUpperCase();
  return "файл";
}

function whenOf(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("ru-RU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  useEffect(() => setNode(document.body), []);
  useEffect(() => pushBackLayer(onClose), [onClose]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  if (!node) return null;
  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/55 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="w-full max-w-md rounded-t-3xl border border-line bg-elev px-3 pt-2 pb-[max(0.85rem,env(safe-area-inset-bottom))] shadow-[var(--shadow)] sm:rounded-3xl sm:pb-3"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-line-strong sm:hidden" />
        {children}
      </div>
    </div>,
    node,
  );
}

export type FileAction = {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
};

export function FileMenu({
  label,
  facts,
  actions,
}: {
  label: string;
  facts?: { name: string; mime: string; bytes: number; createdAt: string; server?: string };
  actions: FileAction[];
}) {
  const [open, setOpen] = useState(false);
  const [about, setAbout] = useState(false);
  return (
    <>
      <button type="button" className="press grid size-9 shrink-0 place-items-center rounded-xl text-muted" aria-label="Ещё" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        <MoreHorizontal className="size-4" />
      </button>
      {open ? (
        <Sheet label={label} onClose={() => setOpen(false)}>
          <div className="mb-1 flex items-center justify-between px-1.5">
            <p className="text-[11px] font-medium tracking-[0.16em] text-faint uppercase">Ещё</p>
            <button type="button" className="press grid size-9 place-items-center rounded-xl text-muted" aria-label="Закрыть" onClick={() => setOpen(false)}>
              <X className="size-4" />
            </button>
          </div>
          {facts ? (
            <button
              type="button"
              className="flex min-h-12 w-full items-center gap-3 rounded-2xl px-1.5 text-left text-sm hover:bg-subtle"
              onClick={() => {
                setOpen(false);
                setAbout(true);
              }}
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-subtle text-muted">
                <Info className="size-4" />
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">О файле</span>
            </button>
          ) : null}
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              disabled={action.disabled}
              className="flex min-h-12 w-full items-center gap-3 rounded-2xl px-1.5 text-left text-sm enabled:hover:bg-subtle disabled:text-faint"
              onClick={() => {
                setOpen(false);
                action.onClick();
              }}
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-subtle text-muted">{action.icon}</span>
              <span className="min-w-0 flex-1 truncate font-medium">{action.label}</span>
            </button>
          ))}
        </Sheet>
      ) : null}
      {about && facts ? (
        <Sheet label="О файле" onClose={() => setAbout(false)}>
          <div className="mb-1 flex items-center justify-between px-1.5">
            <p className="text-[11px] font-medium tracking-[0.16em] text-faint uppercase">О файле</p>
            <button type="button" className="press grid size-9 place-items-center rounded-xl text-muted" aria-label="Закрыть" onClick={() => setAbout(false)}>
              <X className="size-4" />
            </button>
          </div>
          <p className="px-1.5 text-sm font-medium break-words">{facts.name}</p>
          <dl className="mt-3 space-y-2 px-1.5 pb-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-faint">Формат</dt>
              <dd className="min-w-0 truncate text-right">{formatOf(facts.name, facts.mime)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-faint">Вес</dt>
              <dd className="tabular-nums">{sizeLabel(facts.bytes)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-faint">Загружен</dt>
              <dd className="text-right">{whenOf(facts.createdAt)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-faint">Сервер</dt>
              <dd className="min-w-0 truncate text-right">{facts.server || "Этот сайт"}</dd>
            </div>
          </dl>
        </Sheet>
      ) : null}
    </>
  );
}
