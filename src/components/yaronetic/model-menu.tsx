import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptic";
import { pushBackLayer } from "@/lib/app-back";

export type ModelOption = { value: string; label: string; icon?: string; hint?: string };

function modelIcon(icon?: string) {
  if (!icon || icon.length > 80_000 || !/^data:image\/(png|jpeg|webp);base64,/.test(icon)) return "";
  return icon;
}

export function ModelMenu({
  id,
  value,
  options,
  onChange,
  plain = false,
}: {
  id: string;
  value: string;
  options: ModelOption[];
  onChange: (value: string) => void;
  plain?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const startX = useRef(0);
  const startT = useRef(0);
  const dragging = useRef(false);
  const current = options.find((item) => item.value === value) ?? options[0];

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const apply = () => setNarrow(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!open || narrow) return;
    function onDoc(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onDoc);
    return () => document.removeEventListener("pointerdown", onDoc);
  }, [open, narrow]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const picked = listRef.current?.querySelector<HTMLElement>("[role='option'][aria-selected='true']") ?? listRef.current?.querySelector<HTMLElement>("[role='option']");
    picked?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    return pushBackLayer(() => setOpen(false));
  }, [open]);

  if (!current) {
    return (
      <button id={id} type="button" disabled className="h-9 max-w-[70%] rounded-xl border border-line bg-elev px-3 text-sm text-faint">
        Нет модели
      </button>
    );
  }

  function move(from: HTMLElement, step: number) {
    const items = [...(listRef.current?.querySelectorAll<HTMLElement>("[role='option']") ?? [])];
    const at = items.indexOf(from);
    const next = items[at + step];
    (next ?? (step < 0 ? items[0] : items[items.length - 1]))?.focus();
  }

  function pick(next: string) {
    if (next !== value) haptic("selection");
    onChange(next);
    setOpen(false);
  }

  const shown = options.filter((item) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return item.label.toLowerCase().includes(q) || item.value.toLowerCase().includes(q);
  });

  const list = (
    <div ref={listRef} className={narrow ? "max-h-[70dvh] overflow-y-auto" : ""} role="listbox" aria-labelledby={id}>
      {options.length > 8 ? (
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Найти модель"
          className="mb-1 h-10 w-full rounded-xl border border-line-strong bg-bg px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          aria-label="Найти модель"
        />
      ) : null}
      {shown.map((item) => {
        const selected = item.value === current.value;
        return (
          <button
            key={item.value}
            type="button"
            role="option"
            aria-selected={selected}
            className={cn(
              "press flex w-full items-center gap-2 rounded-xl px-3 text-left text-sm",
              narrow ? "min-h-14" : "min-h-10",
              selected ? "bg-subtle" : "hover:bg-subtle",
            )}
            onClick={() => pick(item.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                move(event.currentTarget, 1);
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                move(event.currentTarget, -1);
              } else if (event.key === "Home") {
                event.preventDefault();
                listRef.current?.querySelector<HTMLElement>("[role='option']")?.focus();
              } else if (event.key === "End") {
                event.preventDefault();
                const items = listRef.current?.querySelectorAll<HTMLElement>("[role='option']");
                items?.[items.length - 1]?.focus();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setOpen(false);
                root.current?.querySelector<HTMLElement>("button")?.focus();
              } else if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                pick(item.value);
              }
            }}
          >
            {modelIcon(item.icon) ? <img src={modelIcon(item.icon)} alt="" className="size-6 shrink-0 rounded object-cover" /> : null}
            <span className="min-w-0 flex-1">
              <span className="block truncate">{item.label}</span>
              {item.hint ? <span className="block truncate text-xs text-muted">{item.hint}</span> : null}
            </span>
            {selected ? <Check className="size-4 shrink-0" /> : null}
          </button>
        );
      })}
    </div>
  );

  return (
    <div ref={root} className={cn("relative min-w-0", plain ? "w-full" : "max-w-full md:max-w-[70%]")}>
      <button
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "press inline-flex w-full min-w-0 items-center gap-1.5 text-left text-sm",
          plain ? "h-12 rounded-2xl px-2 hover:bg-subtle" : "rounded-xl border border-line bg-elev px-3",
          !plain && (narrow ? "min-h-14" : "h-9"),
        )}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="inline-flex min-w-0 flex-1 items-center gap-2">
          {modelIcon(current.icon) ? <img src={modelIcon(current.icon)} alt="" className="size-4 shrink-0 rounded object-cover" /> : null}
          <span className="min-w-0 flex-1 truncate">{current.label}</span>
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-muted transition", open && "rotate-180")} />
      </button>
      {open && !narrow ? (
        <div className="vv-enter absolute bottom-full left-0 z-30 mb-1 max-h-80 w-max min-w-[16rem] max-w-[80vw] overflow-y-auto rounded-2xl border border-line bg-elev p-1 shadow-[var(--shadow)]">
          {list}
        </div>
      ) : null}
      {open && narrow && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[80] flex items-end bg-black/45" onClick={() => setOpen(false)}>
              <div
                className="vv-enter w-full rounded-t-3xl border border-line bg-elev px-2 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[var(--shadow)]"
                onClick={(event) => event.stopPropagation()}
              >
                <div
                  className="mb-2 flex touch-none justify-center py-2"
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    try {
                      event.currentTarget.setPointerCapture(event.pointerId);
                    } catch {
                      /* ignore */
                    }
                    startY.current = event.clientY;
                    startX.current = event.clientX;
                    startT.current = performance.now();
                    dragging.current = true;
                  }}
                  onPointerUp={(event) => {
                    if (!dragging.current) return;
                    dragging.current = false;
                    const dy = event.clientY - startY.current;
                    const dx = event.clientX - startX.current;
                    const dt = Math.max(1, performance.now() - startT.current);
                    if (Math.abs(dx) > 24) return;
                    if (dy > 96 && (dy / dt > 0.4 || dy > 160)) setOpen(false);
                  }}
                  onPointerCancel={() => {
                    dragging.current = false;
                  }}
                >
                  <span className="h-1.5 w-10 rounded-full bg-line" />
                </div>
                {list}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
