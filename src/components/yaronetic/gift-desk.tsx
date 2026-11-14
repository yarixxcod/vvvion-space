import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { PurchaseSheet } from "@/components/yaronetic/purchase-sheet";
import { fmtRubApprox } from "@/lib/pay/format";
import { getGiftDesk, sellReceivedGift, sendGift, type GiftInboxItem, type GiftItem } from "@/lib/social/gifts";
import { lookupHandle } from "@/lib/social/handles";
import { haptic } from "@/lib/haptic";

const GIFT_ART: Record<string, { glyph: string; from: string; to: string }> = {
  rose: { glyph: "🌹", from: "#7533a5", to: "#1b1438" },
  coffee: { glyph: "☕", from: "#8c5b45", to: "#241628" },
  chocolate: { glyph: "🍫", from: "#90546d", to: "#241326" },
  star: { glyph: "🌟", from: "#a47b32", to: "#21152e" },
  heart: { glyph: "💜", from: "#9b52c9", to: "#261344" },
  teddy: { glyph: "🧸", from: "#aa7796", to: "#2c1c38" },
  bouquet: { glyph: "💐", from: "#b458aa", to: "#291735" },
  butterfly: { glyph: "🦋", from: "#5779cf", to: "#1b1744" },
  moon: { glyph: "🌙", from: "#6378c5", to: "#10182e" },
  crystal: { glyph: "🔮", from: "#7463d6", to: "#20143c" },
  planet: { glyph: "🪐", from: "#6964b8", to: "#17163a" },
  rocket: { glyph: "🚀", from: "#7254c9", to: "#19143a" },
  ring: { glyph: "💍", from: "#a67bc9", to: "#24183b" },
  cat: { glyph: "🐈", from: "#7b5fc0", to: "#20152e" },
  music: { glyph: "🎼", from: "#8c5ca8", to: "#21162f" },
  trophy: { glyph: "🏆", from: "#a98b42", to: "#251b28" },
  crown: { glyph: "👑", from: "#a17b3e", to: "#25182f" },
  diamond: { glyph: "💎", from: "#5d93c6", to: "#151e40" },
  phoenix: { glyph: "🔥", from: "#b54c81", to: "#2c132c" },
  galaxy: { glyph: "🌌", from: "#7457b8", to: "#10152e" },
  comet: { glyph: "☄️", from: "#9366bc", to: "#171535" },
  castle: { glyph: "🏰", from: "#7c76bb", to: "#191735" },
  dragon: { glyph: "🐉", from: "#9e578d", to: "#25132e" },
  universe: { glyph: "✨", from: "#6c63d5", to: "#12112e" },
};

function GiftArt({ sku, compact = false }: { sku: string; compact?: boolean }) {
  const art = GIFT_ART[sku.replace(/^gift:/, "")] ?? { glyph: "🎁", from: "#6951a1", to: "#1c1734" };
  return (
    <span aria-hidden="true" className={`relative grid shrink-0 place-items-center overflow-hidden rounded-2xl border border-white/10 shadow-inner ${compact ? "size-12 text-2xl" : "size-20 text-4xl"}`}
      style={{ background: `radial-gradient(circle at 30% 22%, ${art.from}, ${art.to} 76%)` }}>
      <span className="absolute left-2 top-1 text-xs text-white/60">✦</span>
      <span className="drop-shadow-[0_5px_9px_rgba(0,0,0,.35)]">{art.glyph}</span>
      <span className="absolute bottom-1 right-2 text-xs text-white/40">✧</span>
    </span>
  );
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
      <ul className="grid gap-3 sm:grid-cols-2">
        {gifts.map((gift) => (
          <li key={gift.sku} className="group flex min-h-52 flex-col rounded-3xl border border-line bg-elev px-4 py-4 transition-[border-color,box-shadow,transform] duration-200 hover:border-line-strong hover:shadow-[var(--shadow)] motion-reduce:transform-none">
            <div className="mb-3 flex items-center justify-between gap-3"><GiftArt sku={gift.sku} /><span className="text-[11px] font-medium tracking-widest text-faint uppercase">VVVION</span></div>
            <p className="font-serif text-2xl tracking-tight">{gift.title}</p>
            <p className="mt-1 text-sm text-muted">{gift.note}</p>
            <p className="mt-auto pt-4 font-serif text-xl tabular-nums">
              {gift.price.toLocaleString("ru-RU")} вуб. · {fmtRubApprox(gift.price)}
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
