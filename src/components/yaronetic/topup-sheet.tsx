import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { pushBackLayer } from "@/lib/app-back";
import { appHas } from "@/lib/app-bridge";
import { fmtVub } from "@/lib/pay/format";
import { haptic } from "@/lib/haptic";

type Packages = {
  minRub: number;
  maxRub: number;
  tiers: { id: string; fromRub: number; vubPerRub: number; label: string | null; bonusPct: number }[];
  presets: { rub: number; vubli: number; bonusPct: number; label: string | null; popular?: boolean }[];
};

type Quote = {
  rub: number;
  vubliTotal: number;
  vubliPurchased: number;
  vubliBonus: number;
  bonusPct: number;
  label: string | null;
};

type Phase = "choose" | "creating" | "invoice" | "paid" | "expired" | "error";

type Invoice = {
  id: string;
  status: string;
  rub: number;
  vubli?: { total: number; purchased: number; bonus: number };
  urls?: { bot?: string | null; miniApp?: string | null; web?: string | null };
  balance?: number;
};

function openPay(url: string) {
  if (!url.startsWith("https://")) return;
  if (appHas("openExternal")) {
    try {
      const opened = window.VvvionApp?.openExternal?.(url);
      if (opened !== false) return;
    } catch {
      /* the page stays put and we fall through */
    }
  }
  window.location.assign(url);
}

function hint(rub: number, tiers: Packages["tiers"]): string | null {
  const next = tiers.find((tier) => tier.fromRub > rub);
  if (!next) return null;
  const more = next.fromRub - rub;
  const rate = next.vubPerRub.toLocaleString("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `Ещё ${more.toLocaleString("ru-RU")} ₽ до курса ${rate}`;
}

export function TopupSheet({
  open,
  onClose,
  returnTo,
  needVub,
  existingId,
  onPaid,
}: {
  open: boolean;
  onClose: () => void;
  returnTo: "shop" | "bank";
  needVub?: number;
  existingId?: string | null;
  onPaid?: (balance?: number) => void;
}) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [phase, setPhase] = useState<Phase>("choose");
  const [packages, setPackages] = useState<Packages | null>(null);
  const [rub, setRub] = useState(300);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [note, setNote] = useState("");
  const [verify, setVerify] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const paidRef = useRef(onPaid);
  paidRef.current = onPaid;

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

  useEffect(() => {
    if (!open) return;
    let dead = false;
    void fetch("/api/vubli/packages")
      .then((res) => res.json())
      .then((body: Packages) => {
        if (!dead) setPackages(body);
      })
      .catch(() => undefined);
    return () => {
      dead = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (existingId) return;
    const query = needVub && needVub > 0 ? `needVub=${Math.ceil(needVub)}` : `rub=${rub}`;
    const timer = window.setTimeout(() => {
      void fetch(`/api/vubli/quote?${query}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((body: Quote | null) => {
          if (!body) return;
          setQuote(body);
          if (needVub && needVub > 0) setRub(body.rub);
        })
        .catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [open, rub, needVub, existingId]);

  useEffect(() => {
    if (!open || !existingId) return;
    setPhase("invoice");
    setInvoice({ id: existingId, status: "pending", rub: 0 });
  }, [open, existingId]);

  useEffect(() => {
    if (!open || phase !== "invoice" || !invoice?.id) return;
    let dead = false;
    async function poll() {
      try {
        const res = await fetch(`/api/vubli/topup/${invoice?.id}`);
        if (!res.ok) return;
        const body = (await res.json()) as Invoice;
        if (dead) return;
        setInvoice(body);
        if (body.status === "paid") {
          setPhase("paid");
          haptic("success");
          paidRef.current?.(body.balance);
        } else if (body.status === "expired" || body.status === "canceled" || body.status === "failed") {
          setPhase("expired");
        }
      } catch {
        /* the next tick retries */
      }
    }
    void poll();
    const timer = window.setInterval(() => void poll(), 3000);
    const wake = () => void poll();
    window.addEventListener("focus", wake);
    window.addEventListener("pageshow", wake);
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("vvvion-app-resume", wake);
    return () => {
      dead = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", wake);
      window.removeEventListener("pageshow", wake);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("vvvion-app-resume", wake);
    };
  }, [open, phase, invoice?.id]);

  async function create() {
    if (phase === "creating") return;
    setPhase("creating");
    setNote("");
    setVerify(false);
    try {
      const res = await fetch("/api/vubli/topup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rub, returnTo, idempotencyKey: crypto.randomUUID() }),
      });
      const body = (await res.json().catch(() => ({}))) as Invoice & { code?: string };
      if (body.code === "topup_disabled" || res.status === 503) {
        setPhase("error");
        setNote("Пополнение ещё не включено на сервере.");
        return;
      }
      if (body.code === "email_not_verified" || res.status === 403) {
        setPhase("choose");
        setVerify(true);
        setNote("Сначала подтвердите почту.");
        return;
      }
      if (!res.ok || !body.id) {
        setPhase("error");
        setNote(body.code === "daily_cap" ? "Дневной предел пополнения исчерпан." : body.code === "rate_limited" ? "Слишком много счетов. Подождите немного." : "Счёт не создался. Попробуйте ещё раз.");
        return;
      }
      setInvoice(body);
      setPhase("invoice");
    } catch {
      setPhase("error");
      setNote("Сеть не ответила. Счёт мог не создаться.");
    }
  }

  if (!open || !node) return null;
  const statusText = phase === "paid" ? "Готово" : phase === "expired" ? "Счёт закрыт" : phase === "invoice" ? "Ждём оплату" : note;
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end bg-black/50 sm:items-center sm:justify-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="topup-title"
        className="max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl border border-line bg-elev px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:max-w-md sm:rounded-3xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="topup-title" className="font-serif text-2xl tracking-tight">Пополнить вубли</h2>
        <p className="mt-1 text-sm text-muted">Вубли — внутренняя единица сервиса. На деньги не меняются и не возвращаются. Оплата в крипте через CryptoBot, счёт в рублях.</p>
        <p className="sr-only" aria-live="polite">{statusText}</p>

        {phase === "choose" || phase === "creating" || phase === "error" ? (
          <div className="mt-4">
            <div className="grid grid-cols-4 gap-2">
              {(packages?.presets ?? []).map((preset) => (
                <button
                  key={preset.rub}
                  type="button"
                  className={`press min-h-11 rounded-2xl border px-1 text-sm tabular-nums ${rub === preset.rub ? "border-line-strong bg-subtle" : "border-line bg-bg"}`}
                  onClick={() => setRub(preset.rub)}
                >
                  {preset.rub}
                </button>
              ))}
            </div>
            <label className="mt-3 block text-xs text-faint" htmlFor="topup-rub">Своя сумма, ₽</label>
            <input
              id="topup-rub"
              inputMode="numeric"
              value={String(rub)}
              onChange={(event) => {
                const next = Number(event.target.value.replace(/\D/g, "").slice(0, 6));
                if (Number.isInteger(next)) setRub(next);
              }}
              className="mt-1 min-h-11 w-full rounded-2xl border border-line bg-bg px-3 text-base tabular-nums"
            />
            <p className="mt-3 font-serif text-3xl tabular-nums">{quote ? fmtVub(quote.vubliTotal) : "…"}</p>
            <p className="text-sm text-faint">{quote?.label || (quote ? "курс без наценки" : "")}</p>
            {packages && rub > 0 ? <p className="mt-1 text-xs text-muted">{hint(rub, packages.tiers)}</p> : null}
            {note ? <p className="mt-2 text-sm text-danger">{note}</p> : null}
            {verify ? <p className="mt-1 text-sm text-muted">Кнопка «Подтвердить почту» есть на карточке товара.</p> : null}
            <button type="button" disabled={phase === "creating"} className="press mt-4 min-h-11 w-full rounded-2xl bg-accent text-sm font-medium text-accent-fg disabled:opacity-40" onClick={() => void create()}>
              {phase === "creating" ? "Выставляем счёт…" : "Выставить счёт"}
            </button>
          </div>
        ) : null}

        {phase === "invoice" && invoice ? (
          <div className="mt-4">
            <p className="text-sm text-muted">Счёт {invoice.rub ? `${invoice.rub} ₽` : "создан"}. Вубли появятся после оплаты, не после возврата на сайт.</p>
            {invoice.urls?.bot ? (
              <button type="button" className="press mt-4 min-h-11 w-full rounded-2xl bg-accent text-sm font-medium text-accent-fg" onClick={() => openPay(invoice.urls?.bot || "")}>
                Открыть CryptoBot
              </button>
            ) : (
              <p className="mt-3 text-sm text-muted">Ждём статус счёта…</p>
            )}
            {invoice.urls?.web ? (
              <button type="button" className="press mt-2 min-h-11 w-full rounded-2xl border border-line-strong text-sm" onClick={() => openPay(invoice.urls?.web || "")}>
                Оплатить в браузере
              </button>
            ) : null}
          </div>
        ) : null}

        {phase === "paid" ? (
          <p className="mt-4 font-serif text-3xl">Готово</p>
        ) : null}
        {phase === "expired" ? <p className="mt-4 text-sm text-muted">Счёт закрыт. Баланс не менялся. Можно выставить новый.</p> : null}

        <button type="button" className="press mt-3 min-h-11 w-full rounded-2xl text-sm text-muted" onClick={onClose}>
          Закрыть
        </button>
      </div>
    </div>,
    node,
  );
}
