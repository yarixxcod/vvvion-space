import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { pushBackLayer } from "@/lib/app-back";
import { confirmMailCode, sendConfirmCode } from "@/lib/mail/codes";

export function VerifyMailButton({ onVerified, label = "Подтвердить почту" }: { onVerified?: () => void; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="press min-h-11 rounded-xl border border-line-strong bg-transparent px-3 text-sm" onClick={() => setOpen(true)}>
        {label}
      </button>
      {open ? (
        <VerifyMailSheet
          onClose={() => setOpen(false)}
          onVerified={() => {
            setOpen(false);
            onVerified?.();
          }}
        />
      ) : null}
    </>
  );
}

export function VerifyMailSheet({ onClose, onVerified }: { onClose: () => void; onVerified: () => void }) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => setNode(document.body), []);
  useEffect(() => pushBackLayer(() => closeRef.current()), []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function send() {
    if (busy) return;
    setBusy(true);
    try {
      await sendConfirmCode();
      setSent(true);
      toast("Код отправлен на почту");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось отправить код");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (busy || code.trim().length < 4) return;
    setBusy(true);
    try {
      await confirmMailCode({ data: { code: code.trim() } });
      toast("Почта подтверждена");
      onVerified();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Код не подошёл");
    } finally {
      setBusy(false);
    }
  }

  if (!node) return null;
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end bg-black/50 sm:items-center sm:justify-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="verify-mail-title"
        className="w-full rounded-t-3xl border border-line bg-elev px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:max-w-md sm:rounded-3xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="verify-mail-title" className="font-serif text-2xl tracking-tight">Подтвердить почту</h2>
        <p className="mt-2 text-sm text-muted">Без подтверждённой почты подписку и пополнение не открыть. Цена товара при этом видна.</p>
        <div className="mt-4 flex flex-col gap-2">
          <button type="button" disabled={busy} className="press min-h-11 rounded-2xl bg-accent text-sm font-medium text-accent-fg disabled:opacity-40" onClick={() => void send()}>
            {sent ? "Отправить код ещё раз" : "Отправить код"}
          </button>
          <label className="text-xs text-faint" htmlFor="verify-mail-code">Код из письма</label>
          <input
            id="verify-mail-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            className="min-h-11 rounded-2xl border border-line bg-bg px-3 text-base"
          />
          <button type="button" disabled={busy || code.trim().length < 4} className="press min-h-11 rounded-2xl border border-line-strong text-sm disabled:opacity-40" onClick={() => void confirm()}>
            Подтвердить
          </button>
          <button type="button" className="press min-h-11 rounded-2xl text-sm text-muted" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </div>,
    node,
  );
}
