import { useTx } from "@/lib/lang";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { pushBackLayer } from "@/lib/app-back";
import { fmtRubApprox, fmtVub } from "@/lib/pay/format";

export function PurchaseSheet({
  open,
  title,
  price,
  balance,
  detail,
  busy,
  onClose,
  onConfirm,
  onTopup,
  formatAmount = fmtVub,
}: {
  open: boolean;
  title: string;
  price: number;
  balance: number;
  detail: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onTopup: (needVub: number) => void;
  formatAmount?: (amount: number) => string;
}) {
  const tx = useTx();
  const [node, setNode] = useState<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => setNode(document.body), []);
  useEffect(() => {
    if (!open) return;
    return pushBackLayer(() => closeRef.current());
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (!open || !node) return null;
  const short = Math.max(0, price - balance);
  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-end bg-black/50 sm:items-center sm:justify-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="purchase-title"
        className="w-full rounded-t-3xl border border-line bg-elev px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:max-w-md sm:rounded-3xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="purchase-title" className="font-serif text-2xl tracking-tight">
          {title}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">{detail}</p>
        <p className="mt-3 font-serif text-3xl tabular-nums">{formatAmount(price)}</p>
        <p className="text-sm text-faint">
          {fmtRubApprox(price)} · {tx({ ru: "на карте", en: "balance", kk: "баланс" })}{" "}
          {formatAmount(balance)}
        </p>
        <div className="mt-4 flex flex-col gap-2" aria-live="polite">
          {short > 0 ? (
            <button
              type="button"
              className="press min-h-11 rounded-2xl bg-accent text-sm font-medium text-accent-fg"
              onClick={() => onTopup(short)}
            >
              {tx({ ru: "Не хватает", en: "Short by", kk: "Жетпейді" })} {formatAmount(short)} ·{" "}
              {tx({ ru: "Пополнить", en: "Top up", kk: "Толтыру" })}
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              className="press min-h-11 rounded-2xl bg-accent text-sm font-medium text-accent-fg disabled:opacity-40"
              onClick={onConfirm}
            >
              {busy
                ? tx({ ru: "Оформляем…", en: "Processing…", kk: "Өңделуде…" })
                : tx({ ru: "Купить", en: "Buy", kk: "Сатып алу" })}
            </button>
          )}
          <button
            type="button"
            className="press min-h-11 rounded-2xl text-sm text-muted"
            onClick={onClose}
          >
            {tx({ ru: "Закрыть", en: "Close", kk: "Жабу" })}
          </button>
        </div>
      </div>
    </div>,
    node,
  );
}
