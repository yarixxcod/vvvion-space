import { useState } from "react";
import { Check, LoaderCircle, Sparkles } from "lucide-react";
import type { PersonaCard } from "@/lib/social/personas";
export function RolePicker({
  items,
  activeId,
  onSelect,
  onShop,
}: {
  items: PersonaCard[];
  activeId: string | null;
  onSelect?: (id: string | null) => Promise<void>;
  onShop: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const allowed = items.filter((item) => item.owned || item.viaPremium);
  async function select(id: string | null) {
    if (!onSelect || busy) return;
    setBusy(true);
    try {
      await onSelect(id);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Роли и персонажи" className="mt-2 border-t border-line pt-2">
      <div className="flex items-center gap-2 px-2 py-2">
        <Sparkles className="size-4 text-accent" />
        <h3 className="flex-1 text-sm font-medium">Роли и персонажи</h3>
        {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
      </div>
      <p className="mb-2 px-2 text-xs text-muted">
        Роль задаёт стиль и подход. Модель выбирается отдельно.
      </p>
      <div className="max-h-64 space-y-1 overflow-y-auto">
        <button
          type="button"
          disabled={!onSelect || busy}
          aria-pressed={!activeId}
          onClick={() => void select(null)}
          className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-sm hover:bg-subtle disabled:opacity-50"
        >
          <span className="flex-1">Обычный помощник</span>
          {!activeId ? <Check className="size-4 text-accent" /> : null}
        </button>
        {allowed.map((item) => (
          <button
            key={item.id}
            type="button"
            disabled={busy}
            aria-pressed={activeId === item.id}
            onClick={() => void select(item.id)}
            className={`flex min-h-14 w-full items-center gap-3 rounded-xl border p-2 text-left ${activeId === item.id ? "border-accent bg-subtle" : "border-transparent hover:bg-subtle"}`}
          >
            <img src={item.face} alt="" className="size-10 shrink-0 rounded-xl object-cover" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm">{item.name}</span>
              <span className="block text-xs text-muted">{item.role}</span>
            </span>
            {activeId === item.id ? <Check className="size-4 shrink-0 text-accent" /> : null}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onShop}
        className="mt-2 min-h-11 w-full rounded-xl border border-line px-3 text-sm"
      >
        {allowed.length ? "Все роли в магазине" : "Открыть роли в магазине"}
      </button>
    </section>
  );
}
