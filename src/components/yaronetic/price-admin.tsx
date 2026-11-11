import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageLoader } from "@/components/yaronetic/page-loader";
import { createGiftPrice, listShopPrices, saveShopPrice, type ShopPrice } from "@/lib/social/prices";

const SECTION: Record<string, string> = {
  subs: "Подписки",
  ai: "ИИ",
  storage: "Хранилище",
  look: "Персонажи",
  gifts: "Подарки",
};

export function PriceAdmin() {
  const [rows, setRows] = useState<ShopPrice[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [price, setPrice] = useState("100");

  function load() {
    return listShopPrices().then(setRows);
  }

  useEffect(() => {
    void load().catch((err: unknown) => toast.error(err instanceof Error ? err.message : "Цены не открылись"));
  }, []);

  function save(row: ShopPrice, patch: Partial<ShopPrice>) {
    setBusy(true);
    void saveShopPrice({ data: { sku: row.sku, price: patch.price ?? row.price, title: patch.title ?? row.title, note: patch.note ?? row.note, enabled: patch.enabled ?? row.enabled } })
      .then((next) => {
        setRows(next);
        toast("Цена сохранена");
      })
      .catch((err: unknown) => toast.error(err instanceof Error ? err.message : "Не сохранилось"))
      .finally(() => setBusy(false));
  }

  if (!rows) return <PageLoader compact />;
  const groups = [...new Set(rows.map((row) => row.section))];

  return (
    <div className="mt-4 space-y-4">
      <p className="text-sm text-muted">Цена в вублях. Магазин берёт её сразу, старые покупки не пересчитываются.</p>
      {groups.map((section) => (
        <section key={section} className="rounded-3xl border border-line bg-bg px-3 py-3">
          <p className="text-xs tracking-[0.18em] text-faint">{SECTION[section] ?? section}</p>
          <ul className="mt-2 space-y-2">
            {rows
              .filter((row) => row.section === section)
              .map((row) => (
                <PriceRow key={row.sku} row={row} busy={busy} onSave={save} />
              ))}
          </ul>
        </section>
      ))}
      <form
        className="rounded-3xl border border-line bg-elev px-3 py-3"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          void createGiftPrice({ data: { slug, title, note, price: Number(price) } })
            .then((next) => {
              setRows(next);
              setSlug("");
              setTitle("");
              setNote("");
              toast("Подарок добавлен");
            })
            .catch((err: unknown) => toast.error(err instanceof Error ? err.message : "Не добавилось"))
            .finally(() => setBusy(false));
        }}
      >
        <p className="text-sm font-medium">Новый подарок</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <input className="field" placeholder="код, например moon" value={slug} onChange={(event) => setSlug(event.target.value)} />
          <input className="field" placeholder="Название" value={title} onChange={(event) => setTitle(event.target.value)} />
          <input className="field" placeholder="Короткая подпись" value={note} onChange={(event) => setNote(event.target.value)} />
          <input className="field" inputMode="numeric" placeholder="Цена" value={price} onChange={(event) => setPrice(event.target.value.replace(/\D/g, "").slice(0, 7))} />
        </div>
        <button type="submit" disabled={busy} className="press mt-3 h-11 rounded-xl bg-accent px-3 text-sm font-medium text-accent-fg disabled:opacity-40">
          Добавить подарок
        </button>
      </form>
    </div>
  );
}

function PriceRow({ row, busy, onSave }: { row: ShopPrice; busy: boolean; onSave: (row: ShopPrice, patch: Partial<ShopPrice>) => void }) {
  const [price, setPrice] = useState(String(row.price));
  const [title, setTitle] = useState(row.title);
  useEffect(() => {
    setPrice(String(row.price));
    setTitle(row.title);
  }, [row.price, row.title]);
  return (
    <li className="flex flex-wrap items-center gap-2">
      <span className="w-full text-xs text-faint sm:w-auto sm:min-w-28">{row.sku}</span>
      {row.section === "gifts" ? (
        <input className="field min-w-0 flex-1" value={title} onChange={(event) => setTitle(event.target.value)} />
      ) : (
        <span className="min-w-0 flex-1 truncate text-sm">{row.title}</span>
      )}
      <input className="field w-28" inputMode="numeric" value={price} onChange={(event) => setPrice(event.target.value.replace(/\D/g, "").slice(0, 7))} />
      <button type="button" disabled={busy} className="press h-10 rounded-xl border border-line px-3 text-sm disabled:opacity-40" onClick={() => onSave(row, { price: Number(price), title })}>
        Сохранить
      </button>
      {row.section === "gifts" ? (
        <button type="button" disabled={busy} className="press h-10 rounded-xl px-2 text-xs text-muted" onClick={() => onSave(row, { enabled: !row.enabled })}>
          {row.enabled ? "Скрыть" : "Показать"}
        </button>
      ) : null}
    </li>
  );
}
