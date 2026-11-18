import { useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { REPORT_REASONS } from "@/lib/social/support-core";
import { fileReport } from "@/lib/social/support";

export function ReportDialog({
  targetType,
  targetId,
  onClose,
}: {
  targetType: "user" | "post" | "message";
  targetId: string;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("spam");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  return createPortal(
    <div className="fixed inset-0 z-[240] flex items-end justify-center bg-black/55 sm:items-center" onClick={onClose}>
      <form
        className="w-full max-w-md rounded-t-3xl border border-line bg-elev p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:rounded-3xl"
        role="dialog"
        aria-modal="true"
        aria-label="Жалоба"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          void fileReport({ data: { targetType, targetId, reason, comment } })
            .then(() => {
              toast("Жалоба отправлена");
              onClose();
            })
            .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Жалоба не отправилась"))
            .finally(() => setBusy(false));
        }}
      >
        <h2 className="font-serif text-2xl">Пожаловаться</h2>
        <label className="mt-3 block text-xs text-faint">
          Причина
          <select className="field mt-1" value={reason} onChange={(event) => setReason(event.target.value)}>
            {REPORT_REASONS.map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
        </label>
        <label className="mt-2 block text-xs text-faint">
          Комментарий
          <textarea className="field mt-1 min-h-24" maxLength={500} value={comment} onChange={(event) => setComment(event.target.value)} />
        </label>
        <div className="mt-3 flex gap-2">
          <button type="submit" disabled={busy} className="press h-11 flex-1 rounded-xl bg-accent text-sm font-medium text-accent-fg disabled:opacity-40">Отправить</button>
          <button type="button" className="press h-11 rounded-xl border border-line px-3 text-sm" onClick={onClose}>Отмена</button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
