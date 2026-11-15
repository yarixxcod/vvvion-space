import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { PurchaseSheet } from "@/components/yaronetic/purchase-sheet";
import { fmtRubApprox } from "@/lib/pay/format";
import { getGiftDesk, sellReceivedGift, sendGift, type GiftInboxItem, type GiftItem } from "@/lib/social/gifts";
import { lookupHandle } from "@/lib/social/handles";
import { haptic } from "@/lib/haptic";

import { CatalogArt, giftRarity } from "@/components/yaronetic/catalog-art";

function GiftArt({ sku, compact = false }: { sku: string; compact?: boolean }) {
  return <CatalogArt kind="gifts" id={sku.replace(/^gift:/, "")} className={compact ? "size-14 rounded-xl" : "aspect-square w-full rounded-2xl"} />;
}

export function GiftDesk({ balance, verified, onDone, onNeed }: { balance: number; verified: boolean; onDone: () => void; onNeed: (missing: number) => void }) {
  const [gifts, setGifts] = useState<GiftItem[]>([]);
  const [inbox, setInbox] = useState<GiftInboxItem[]>([]);
  const [handle, setHandle] = useState("");
  const [note, setNote] = useState("");
  const [found, setFound] = useState<string | null>(null);
  const [verifiedHandle, setVerifiedHandle] = useState<string | null>(null);
  const [lookupState, setLookupState] = useState<"idle" | "checking" | "found" | "missing" | "error">("idle");
  const [pick, setPick] = useState<GiftItem | null>(null);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const [deskState, setDeskState] = useState<"loading" | "ready" | "error">("loading");

  async function load() {
    setDeskState("loading");
    try {
      const desk = await getGiftDesk();
      setGifts(desk.gifts);
      setInbox(desk.inbox);
      setDeskState("ready");
    } catch (error) {
      setDeskState("error");
      throw error;
    }
  }

  useEffect(() => {
    void load().catch(() => undefined);
  }, []);

  useEffect(() => {
    const raw = handle.trim().replace(/^@/, "");
    let active = true;

    // Never leave a previous recipient selected while a new handle is checked.
    setFound(null);
    setVerifiedHandle(null);
    setLookupState(raw.length < 3 ? "idle" : "checking");
    if (raw.length < 3) return;

    const timer = window.setTimeout(() => {
      void lookupHandle({ data: { handle: raw } })
        .then((hit) => {
          if (active) {
            setFound(hit ? hit.name : null);
            setVerifiedHandle(hit ? raw : null);
            setLookupState(hit ? "found" : "missing");
          }
        })
        .catch(() => {
          if (active) {
            setFound(null);
            setVerifiedHandle(null);
            setLookupState("error");
          }
        });
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [handle]);

  return (
    <div className="mt-3 space-y-3">
      <section className="rounded-3xl border border-line bg-bg px-4 py-4">
        <p className="text-sm font-medium">Кому</p>
        <p className="mt-1 text-xs text-faint">Нужен юзернейм человека. Свой задаётся в профиле.</p>
        <input
          className="field mt-3"
          value={handle}
          placeholder="@username"
          aria-label="Юзернейм получателя"
          aria-describedby="gift-recipient-status"
          maxLength={21}
          onChange={(event) => setHandle(event.target.value.toLowerCase())}
        />
        <p id="gift-recipient-status" role="status" aria-live="polite" className="mt-1 min-h-5 text-xs text-muted">{lookupState === "checking" ? "Проверяем юзернейм…" : lookupState === "found" && found ? `Это ${found}` : lookupState === "missing" ? "Такого юзернейма нет" : lookupState === "error" ? "Не удалось проверить юзернейм. Попробуйте ещё раз." : ""}</p>
        <label className="mt-2 block text-xs text-faint">
          Записка, необязательно
          <input className="field mt-1" value={note} maxLength={80} onChange={(event) => setNote(event.target.value)} />
        </label>
      </section>
      {deskState === "loading" && gifts.length === 0 ? (
        <div role="status" className="grid gap-2 sm:grid-cols-2" aria-label="Загружаем подарки">
          {[0, 1, 2, 3].map((item) => <div key={item} className="h-36 animate-pulse rounded-3xl border border-line bg-subtle motion-reduce:animate-none" />)}
        </div>
      ) : null}
      {deskState === "error" ? (
        <div role="alert" className="rounded-2xl border border-line bg-elev p-4 text-sm">
          <p>Не удалось загрузить подарки. Проверьте соединение.</p>
          <button type="button" className="press mt-3 min-h-11 rounded-xl border border-line px-4" onClick={() => void load().catch(() => undefined)}>Повторить</button>
        </div>
      ) : null}
      {deskState === "ready" && gifts.length === 0 ? (
        <p role="status" className="rounded-2xl border border-line bg-elev px-4 py-6 text-center text-sm text-muted">Подарки пока недоступны.</p>
      ) : null}
      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {gifts.map((gift) => (
          <li key={gift.sku} className="catalog-card group flex min-w-0 flex-col rounded-3xl border border-line bg-elev p-3 transition-[border-color,box-shadow,transform] duration-200 hover:border-line-strong hover:shadow-[var(--shadow)] motion-reduce:transform-none">
            <div className="catalog-art-stage"><GiftArt sku={gift.sku} /><span className="catalog-rarity" data-tier={giftRarity(gift.price).tier}>{giftRarity(gift.price).label}</span></div>
            <p className="mt-3 text-base font-semibold leading-tight">{gift.title}</p>
            <p className="mt-1 text-xs text-muted">{gift.note}</p>
            <p className="mt-auto pt-3 text-sm font-semibold tabular-nums">
              {gift.price.toLocaleString("ru-RU")} вуб.<span className="mt-0.5 block text-xs font-normal text-faint">{fmtRubApprox(gift.price)}</span>
            </p>
            <button type="button" className="press mt-3 min-h-11 w-full rounded-2xl border border-line-strong px-3 text-sm font-medium transition-colors hover:bg-subtle" onClick={() => setPick(gift)}>
              Подарить
            </button>
          </li>
        ))}
      </ul>
      {inbox.length ? (
        <section className="rounded-3xl border border-line bg-bg px-4 py-4">
          <p className="text-xs tracking-[0.22em] text-faint">ВАМ ПОДАРИЛИ</p>
          <ul className="mt-2 space-y-2">
            {inbox.map((item) => (
              <li key={item.id} className="flex gap-3 rounded-2xl border border-line bg-elev p-3 text-sm">
                <GiftArt sku={item.sku} compact />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{item.title}</p>
                  <p className="break-words text-xs text-muted">{item.fromHandle ? `@${item.fromHandle}` : item.fromName}</p>
                  {item.note ? <p className="mt-1 break-words text-xs text-faint">{item.note}</p> : null}
                  <button type="button" disabled={busy} className="press mt-2 min-h-9 rounded-xl border border-line px-3 text-xs disabled:opacity-40" onClick={() => {
                    if (!window.confirm(`Продать «${item.title}» за ${item.resaleValue} вублей? Отменить продажу нельзя.`)) return;
                    setBusy(true);
                    void sellReceivedGift({ data: { id: item.id } })
                      .then(({ amount }) => { toast.success(`Продано за ${amount} вублей`); onDone(); return load(); })
                      .catch((err: unknown) => toast.error(err instanceof Error ? err.message : "Не удалось продать подарок"))
                      .finally(() => setBusy(false));
                  }}>Продать · {item.resaleValue.toLocaleString("ru-RU")} вуб.</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <PurchaseSheet
        open={Boolean(pick)}
        title={pick ? `Подарок «${pick.title}»` : "Подарок"}
        detail={found && verifiedHandle === handle.trim().replace(/^@/, "") ? `Получит ${found}. Спишется с вашей карты.` : "Укажите существующий юзернейм."}
        price={pick?.price ?? 0}
        balance={balance}
        busy={busy}
        onClose={() => { if (!sending.current) setPick(null); }}
        onTopup={(missing) => {
          if (sending.current) return;
          setPick(null);
          onNeed(missing);
        }}
        onConfirm={() => {
          if (!pick || sending.current) return;
          if (!verified) {
            toast.error("Сначала подтвердите почту");
            return;
          }
          if (!found || !verifiedHandle || verifiedHandle !== handle.trim().replace(/^@/, "")) {
            toast.error("Сначала найдите человека по юзернейму");
            return;
          }
          sending.current = true;
          setBusy(true);
          void sendGift({ data: { sku: pick.sku, handle: verifiedHandle, note, idempotencyKey: crypto.randomUUID() } })
            .then(() => {
              haptic("success");
              toast("Подарок отправлен");
              setPick(null);
              setNote("");
              onDone();
              return load();
            })
            .catch((err: unknown) => {
              haptic("error");
              toast.error(err instanceof Error ? err.message : "Не отправилось");
            })
            .finally(() => {
              sending.current = false;
              setBusy(false);
            });
        }}
      />
    </div>
  );
}

/** Inventory displayed in the actual profile sheet, not in settings. */
export function GiftCollectionCard() {
  const [items, setItems] = useState<GiftInboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const refresh = () => getGiftDesk().then((desk) => setItems(desk.inbox));
  useEffect(() => {
    void refresh().catch(() => toast.error("Не удалось загрузить подарки")).finally(() => setLoading(false));
  }, []);
  return (
    <section className="mt-4 rounded-3xl border border-line bg-elev p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-serif text-xl">Мои подарки</h3>
        <span className="rounded-full bg-subtle px-3 py-1 text-xs text-muted">{items.length}</span>
      </div>
      <p className="mt-1 text-xs text-muted">Подарки, которые вам отправили. Можно оставить на память или продать за вубли.</p>
      {loading ? <p className="mt-3 text-sm text-muted">Загружаем коллекцию…</p> : items.length === 0 ? <p className="mt-3 text-sm text-faint">Пока подарков нет.</p> : (
        <ul className="mt-3 grid grid-cols-2 gap-2">
          {items.map((item) => (
            <li key={item.id} className="flex min-w-0 flex-col items-center rounded-2xl border border-line bg-bg p-3 text-center">
              <GiftArt sku={item.sku} />
              <p className="mt-2 w-full truncate text-sm font-medium" title={item.title}>{item.title}</p>
              <p className="w-full truncate text-xs text-muted">{item.fromHandle ? `@${item.fromHandle}` : item.fromName}</p>
              <time dateTime={item.createdAt} className="mt-1 text-[11px] text-faint">{new Date(item.createdAt).toLocaleDateString("ru-RU")}</time>
              <button type="button" disabled={busyId !== null} className="press mt-3 min-h-9 w-full rounded-xl border border-line px-2 text-xs disabled:opacity-40"
                onClick={() => {
                  if (!window.confirm(`Продать «${item.title}» за ${item.resaleValue} вублей? Отменить нельзя.`)) return;
                  setBusyId(item.id);
                  void sellReceivedGift({ data: { id: item.id } })
                    .then(({ amount }) => { toast.success(`Продано за ${amount} вублей`); window.dispatchEvent(new Event("vv-wallet-refresh")); return refresh(); })
                    .catch((err: unknown) => toast.error(err instanceof Error ? err.message : "Продажа не удалась"))
                    .finally(() => setBusyId(null));
                }}>
                {busyId === item.id ? "Продаём…" : `Продать · ${item.resaleValue} вуб.`}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
