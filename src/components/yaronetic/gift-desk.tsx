import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PurchaseSheet } from "@/components/yaronetic/purchase-sheet";
import { fmtRubApprox } from "@/lib/pay/format";
import { getGiftDesk, sendGift, type GiftInboxItem, type GiftItem } from "@/lib/social/gifts";
import { lookupHandle } from "@/lib/social/handles";
import { haptic } from "@/lib/haptic";

export function GiftDesk({ balance, verified, onDone, onNeed }: { balance: number; verified: boolean; onDone: () => void; onNeed: (missing: number) => void }) {
  const [gifts, setGifts] = useState<GiftItem[]>([]);
  const [inbox, setInbox] = useState<GiftInboxItem[]>([]);
  const [handle, setHandle] = useState("");
  const [note, setNote] = useState("");
  const [found, setFound] = useState<string | null>(null);
  const [pick, setPick] = useState<GiftItem | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const desk = await getGiftDesk();
    setGifts(desk.gifts);
    setInbox(desk.inbox);
  }

  useEffect(() => {
    void load().catch(() => undefined);
  }, []);

  useEffect(() => {
    const raw = handle.trim().replace(/^@/, "");
    let active = true;

    // Never leave a previous recipient selected while a new handle is checked.
    setFound(null);
    if (raw.length < 3) return;

    const timer = window.setTimeout(() => {
      void lookupHandle({ data: { handle: raw } })
        .then((hit) => {
          if (active) setFound(hit ? hit.name : null);
        })
        .catch(() => {
          if (active) setFound(null);
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
          maxLength={21}
          onChange={(event) => setHandle(event.target.value.toLowerCase())}
        />
        <p className="mt-1 min-h-5 text-xs text-muted">{found ? `Это ${found}` : handle.trim().length >= 3 ? "Такого юзернейма нет" : ""}</p>
        <label className="mt-2 block text-xs text-faint">
          Записка, необязательно
          <input className="field mt-1" value={note} maxLength={80} onChange={(event) => setNote(event.target.value)} />
        </label>
      </section>
      <ul className="grid gap-2 sm:grid-cols-2">
        {gifts.map((gift) => (
          <li key={gift.sku} className="rounded-3xl border border-line bg-elev px-4 py-4">
            <p className="font-serif text-2xl tracking-tight">{gift.title}</p>
            <p className="mt-1 text-sm text-muted">{gift.note}</p>
            <p className="mt-3 font-serif text-xl tabular-nums">
              {gift.price.toLocaleString("ru-RU")} вуб. · {fmtRubApprox(gift.price)}
            </p>
            <button type="button" className="press mt-3 min-h-11 rounded-xl border border-line-strong px-3 text-sm" onClick={() => setPick(gift)}>
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
              <li key={item.id} className="text-sm">
                <span className="font-medium">{item.title}</span>
                <span className="text-muted"> · {item.fromHandle ? `@${item.fromHandle}` : item.fromName}</span>
                {item.note ? <span className="mt-0.5 block text-xs text-faint">{item.note}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <PurchaseSheet
        open={Boolean(pick)}
        title={pick ? `Подарок «${pick.title}»` : "Подарок"}
        detail={found ? `Получит ${found}. Спишется с вашей карты.` : "Укажите существующий юзернейм."}
        price={pick?.price ?? 0}
        balance={balance}
        busy={busy}
        onClose={() => setPick(null)}
        onTopup={(missing) => {
          setPick(null);
          onNeed(missing);
        }}
        onConfirm={() => {
          if (!pick || busy) return;
          if (!verified) {
            toast.error("Сначала подтвердите почту");
            return;
          }
          if (!found) {
            toast.error("Сначала найдите человека по юзернейму");
            return;
          }
          setBusy(true);
          void sendGift({ data: { sku: pick.sku, handle, note, idempotencyKey: crypto.randomUUID() } })
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
            .finally(() => setBusy(false));
        }}
      />
    </div>
  );
}
