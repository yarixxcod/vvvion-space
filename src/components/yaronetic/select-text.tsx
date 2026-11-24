import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { copyText } from "@/components/yaronetic/markdown";

export function SelectText({ text, onClose }: { text: string; onClose: () => void }) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setNode(document.body), []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!node) return null;
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/55 p-3 sm:items-center" role="presentation" onClick={onClose}>
      <div
        className="flex max-h-[min(32rem,86dvh)] w-full max-w-lg flex-col rounded-3xl border border-line bg-elev p-4 shadow-[var(--shadow)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="select-text-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="select-text-title" className="text-base font-medium">Выделить</h2>
        <p className="mt-1 text-xs text-faint">Зажмите текст и проведите, чтобы взять фрагмент. Вне этого окна текст не выделяется.</p>
        <textarea
          ref={area}
          readOnly
          value={text}
          className="select-sheet mt-3 min-h-40 w-full flex-1 resize-none rounded-2xl border border-line bg-bg px-3 py-3 text-base leading-6 text-fg outline-none"
          aria-label="Текст сообщения"
        />
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <button type="button" className="press h-11 rounded-2xl px-3 text-sm text-muted" onClick={onClose}>
            Закрыть
          </button>
          <button
            type="button"
            className="press h-11 rounded-2xl border border-line px-3 text-sm"
            onClick={() => {
              const field = area.current;
              if (!field) return;
              field.focus();
              field.setSelectionRange(0, field.value.length);
            }}
          >
            Выделить всё
          </button>
          <button
            type="button"
            className="press h-11 rounded-2xl bg-accent px-3 text-sm text-accent-fg"
            onClick={() => {
              const field = area.current;
              if (!field) return;
              const chunk = field.value.slice(field.selectionStart, field.selectionEnd);
              if (!chunk) {
                toast("Сначала выделите фрагмент");
                return;
              }
              void copyText(chunk);
            }}
          >
            Копировать выделенное
          </button>
        </div>
      </div>
    </div>,
    node,
  );
}
