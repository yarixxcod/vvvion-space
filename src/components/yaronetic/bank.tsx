import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowDownLeft, ArrowUpRight, Banknote, Copy, Link2 } from "lucide-react";
import { toast } from "sonner";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { PageLoader } from "@/components/yaronetic/page-loader";
import { PersonFace } from "@/components/yaronetic/person-face";
import { TopupSheet } from "@/components/yaronetic/topup-sheet";
import { fmtRubApprox, fmtVub } from "@/lib/pay/format";
import { useTx } from "@/lib/lang";
import { findCardOwner, getBank, repayLoan, settleLoan, takeLoan, transferWoobli, type BankCard, type BankPerson, type BankSnapshot } from "@/lib/social/bank";
import { wholeVubles, repayHint, transferHint } from "@/lib/social/amount";
import { claimDaily } from "@/lib/social/checkin";
import { HumanCheck } from "@/components/yaronetic/human-check";
import { listFriends, type Person } from "@/lib/social/messenger";
import { haptic } from "@/lib/haptic";
import { loadError } from "@/lib/load-error";

function waitLabel(ts: number) {
  const left = ts - Date.now();
  if (left <= 0) return "уже можно";
  const hours = Math.floor(left / 3_600_000);
  const minutes = Math.floor((left % 3_600_000) / 60_000);
  if (hours > 0) return `через ${hours} ч ${minutes} мин`;
  return `через ${Math.max(1, minutes)} мин`;
}

function when(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function grouped(pan: string) {
  return pan.replace(/(\d{4})(?=\d)/g, "$1 ");
}

function CardSkin({ id, shift, back }: { id: string; shift: number; back?: boolean }) {
  return (
    <svg viewBox="0 0 340 214" className="absolute inset-0 h-full w-full" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2a2236" />
          <stop offset="0.48" stopColor="#141218" />
          <stop offset="1" stopColor="#3a314c" />
        </linearGradient>
        <radialGradient id={`${id}-glow`} cx="0.9" cy="0.05" r="0.85">
          <stop offset="0" stopColor="#c4b5e8" stopOpacity="0.5" />
          <stop offset="1" stopColor="#c4b5e8" stopOpacity="0" />
        </radialGradient>
        <pattern id={`${id}-lines`} width="7" height="7" patternUnits="userSpaceOnUse">
          <path d="M0 7 L7 0" stroke="#f6f1e8" strokeOpacity="0.045" />
        </pattern>
      </defs>
      <rect width="340" height="214" rx="22" fill={`url(#${id}-bg)`} />
      <rect width="340" height="214" rx="22" fill={`url(#${id}-glow)`} />
      <rect width="340" height="214" rx="22" fill={`url(#${id}-lines)`} />
      <circle cx={268 + (shift % 18)} cy="28" r="78" fill="#c4b5e8" opacity="0.13" />
      <circle cx="18" cy="200" r="54" fill="#e6d3b0" opacity="0.08" />
      <path
        d={`M-8 ${148 + (shift % 12)}c70-46 130-8 190-28s80-6 160 18`}
        fill="none"
        stroke="#f6f1e8"
        strokeOpacity="0.18"
        strokeWidth="1.2"
      />
      <path
        d={`M-8 ${162 + (shift % 8)}c80-30 140 8 200-8s90 4 160 22`}
        fill="none"
        stroke="#c4b5e8"
        strokeOpacity="0.28"
        strokeWidth="1"
      />
      <g transform="translate(286,34)" fill="none" stroke="#f6f1e8" strokeOpacity="0.75" strokeWidth="1.6" strokeLinecap="round" style={back ? { display: "none" } : undefined}>
        <path d="M2 10a8 8 0 0 1 8-8" />
        <path d="M2 10a12 12 0 0 1 12-12" />
        <path d="M2 10a16 16 0 0 1 16-16" />
      </g>
      <g transform="translate(28,74)" style={back ? { display: "none" } : undefined}>
        <rect width="44" height="32" rx="6" fill="#e8d7b4" />
        <path d="M0 11h44M0 21h44M15 0v32M29 0v32" stroke="#b89b6a" strokeWidth="1" />
      </g>
    </svg>
  );
}

function WoobliCard({ card }: { card: BankCard }) {
  const id = useId().replace(/:/g, "");
  const [flipped, setFlipped] = useState(false);
  const shift = Number(card.pan.slice(-2)) || 8;
  return (
    <div className="[perspective:1400px]">
      <button
        type="button"
        data-no-swipe
        className="mx-auto block w-full max-w-[26rem] text-left"
        aria-pressed={flipped}
        aria-label={flipped ? "Показать лицевую сторону карты" : "Показать код на обороте"}
        onPointerDown={(event) => {
          event.currentTarget.dataset.x = String(event.clientX);
        }}
        onPointerUp={(event) => {
          const start = Number(event.currentTarget.dataset.x || event.clientX);
          if (Math.abs(event.clientX - start) >= 40) {
            event.currentTarget.dataset.swipe = "1";
            setFlipped((value) => !value);
            haptic("selection");
          }
        }}
        onClick={(event) => {
          if (event.currentTarget.dataset.swipe === "1") {
            event.currentTarget.dataset.swipe = "";
            return;
          }
          setFlipped((value) => !value);
          haptic("selection");
        }}
      >
        <div
          className="relative aspect-[1.586/1] w-full transition-transform duration-700 [transform-style:preserve-3d]"
          style={{ transform: flipped ? "rotateY(180deg)" : undefined }}
        >
          <div className="absolute inset-0 overflow-hidden rounded-[1.35rem] shadow-[0_22px_40px_-28px_rgba(0,0,0,0.85)] [backface-visibility:hidden]">
            <CardSkin id={id} shift={shift} />
            <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-5 text-[#f6f1e8]">
              <div className="flex items-baseline gap-2">
                <span className="font-serif text-3xl leading-none italic">В</span>
                <span className="text-xs tracking-[0.32em] text-[#f6f1e8]/70">VVVION</span>
              </div>
              <div>
                <p className="font-mono text-[0.95rem] tracking-[0.14em] sm:text-lg sm:tracking-[0.18em]">{grouped(card.pan)}</p>
                <div className="mt-3 flex items-end justify-between gap-3 text-xs tracking-[0.14em] uppercase">
                  <span className="min-w-0 truncate">{card.holder}</span>
                  <span className="shrink-0 tabular-nums">{card.exp}</span>
                </div>
              </div>
            </div>
          </div>
          <div className="absolute inset-0 overflow-hidden rounded-[1.35rem] shadow-[0_22px_40px_-28px_rgba(0,0,0,0.85)] [transform:rotateY(180deg)] [backface-visibility:hidden]">
            <CardSkin id={`${id}b`} shift={shift + 7} back />
            <div className="absolute inset-x-0 top-[18%] h-11 bg-black/80" />
            <div className="absolute inset-x-5 top-[48%] flex items-center gap-3">
              <div className="h-9 flex-1 rounded-md bg-[#efe6d6]/90" />
              <div className="grid h-9 min-w-14 place-items-center rounded-md bg-white px-2 font-mono text-sm tracking-[0.2em] text-[#1b1526]">
                {card.cvv}
              </div>
            </div>
            <p className="absolute inset-x-5 bottom-4 text-xs tracking-[0.18em] text-[#f6f1e8]/60 uppercase">
              Игрушечная карта · вубли
            </p>
          </div>
        </div>
      </button>
    </div>
  );
}

export function Bank() {
  const tx = useTx();
  const navigate = useNavigate();
  const search = useSearch({ from: "/" });
  const [bank, setBank] = useState<BankSnapshot | null>(null);
  const [span, setSpan] = useState<5 | 30>(5);
  const [error, setError] = useState<string | null>(null);
  const [rail, setRail] = useState<"card" | "friend">("friend");
  const [friends, setFriends] = useState<Person[] | null>(null);
  const [friendQuery, setFriendQuery] = useState("");
  const [pan, setPan] = useState("");
  const [picked, setPicked] = useState<BankPerson | null>(null);
  const [amount, setAmount] = useState("100");
  const [proof, setProof] = useState("");
  const [resetKey, setResetKey] = useState(0);
  const [note, setNote] = useState("");
  const [payback, setPayback] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [desk, setDesk] = useState<"pay" | "loan" | null>(null);
  const [origin, setOrigin] = useState("");
  const [topupOpen, setTopupOpen] = useState(false);
  const [history, setHistory] = useState<{ id: string; status: string; rub: number; vubliTotal: number; createdAt: string }[]>([]);

  async function load(next = span) {
    const row = await getBank({ data: { days: next } });
    setBank(row);
    setError(null);
    return row;
  }

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    let dead = false;
    void fetch("/api/vubli/topups")
      .then((res) => (res.ok ? res.json() : { items: [] }))
      .then((body: { items?: { id: string; status: string; rub: number; vubliTotal: number; createdAt: string }[] }) => {
        if (!dead) setHistory(body.items ?? []);
      })
      .catch(() => undefined);
    return () => {
      dead = true;
    };
  }, [bank?.balance]);

  useEffect(() => {
    let cancelled = false;
    void getBank({ data: { days: span } })
      .then((next) => {
        if (!cancelled) setBank(next);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Банк сейчас закрыт");
      });
    return () => {
      cancelled = true;
    };
  }, [span]);

  useEffect(() => {
    if (desk !== "pay" || rail !== "friend") return;
    let cancelled = false;
    void listFriends()
      .then((rows) => {
        if (!cancelled) setFriends(rows);
      })
      .catch(() => {
        if (!cancelled) setFriends([]);
      });
    return () => {
      cancelled = true;
    };
  }, [desk, rail]);

  useEffect(() => {
    if (rail !== "card") return;
    const digits = pan.replace(/\D/g, "");
    if (digits.length !== 16) {
      setPicked(null);
      return;
    }
    let cancelled = false;
    void findCardOwner({ data: digits })
      .then((person) => {
        if (!cancelled) setPicked(person);
      })
      .catch(() => {
        if (!cancelled) setPicked(null);
      });
    return () => {
      cancelled = true;
    };
  }, [pan, rail]);

  async function send() {
    if (!picked || busy || lock.current || !bank) return;
    if (transferHint(amount, bank.balance) !== "ok") return;
    const sum = wholeVubles(amount.trim());
    if (sum == null) return;
    lock.current = true;
    if (!window.confirm(`Перевести ${sum} вублей для ${picked.name}?`)) {
      lock.current = false;
      return;
    }
    setBusy(true);
    try {
      await transferWoobli({ data: { toId: picked.id, amount: sum, note } });
      await load(span);
      setNote("");
      setPan("");
      setFriendQuery("");
      setPicked(null);
      toast("Перевод прошёл");
      haptic("success");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Перевод не прошёл");
      haptic("error");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function borrow(amount: number) {
    if (busy || lock.current) return;
    lock.current = true;
    if (!window.confirm(`Взять ${amount} вублей на 7 дней? Сумму нужно вернуть. Если срок выйдет, она спишется с карты целиком, даже в минус.`)) {
      lock.current = false;
      return;
    }
    setBusy(true);
    try {
      await takeLoan({ data: { amount } });
      await load(span);
      setDesk("loan");
      toast("Кредит на карте. Верните его за 7 дней.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Кредит не открылся");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function repayPart() {
    if (busy || lock.current || !bank?.loan) return;
    if (repayHint(payback, bank.balance, bank.loan.left) !== "ok") return;
    const sum = wholeVubles(payback.trim());
    if (sum == null) return;
    lock.current = true;
    setBusy(true);
    try {
      await repayLoan({ data: { amount: sum } });
      await load(span);
      setPayback("");
      toast("Часть кредита возвращена");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Возврат не прошёл");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function repayAllMinus() {
    if (busy || lock.current || !bank?.loan) return;
    lock.current = true;
    if (!window.confirm(`Списать ${bank.loan.left} вублей с карты целиком? Если вублей не хватит, баланс уйдёт в минус.`)) {
      lock.current = false;
      return;
    }
    setBusy(true);
    try {
      await settleLoan();
      await load(span);
      setPayback("");
      toast("Кредит закрыт");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Списание не прошло");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!bank || !origin) return;
    try {
      await navigator.clipboard.writeText(`${origin}/r/${bank.referralCode}`);
      toast("Ссылка скопирована");
    } catch {
      toast.error("Не удалось скопировать");
    }
  }

  async function copyPan() {
    if (!bank) return;
    try {
      await navigator.clipboard.writeText(grouped(bank.card.pan));
      toast("Номер скопирован");
    } catch {
      toast.error("Не удалось скопировать");
    }
  }

  if (error) {
    return (
      <div className="p-4">
        <p className="text-sm text-danger">{loadError(error, "Банк сейчас закрыт")}</p>
        <button type="button" className="press mt-3 h-10 rounded-xl border border-line px-3 text-sm" onClick={() => void load().catch((err) => setError(err instanceof Error ? err.message : "Банк сейчас закрыт"))}>
          Повторить
        </button>
      </div>
    );
  }

  if (!bank) return <PageLoader />;

  return (
    <div className="h-full overflow-y-auto px-3 pt-3 pb-6">
      <section className="rounded-[1.7rem] border border-line bg-elev px-4 pt-4 pb-16">
        <p className="text-xs tracking-[0.22em] text-faint uppercase">Вубли</p>
        <p className="mt-1 font-serif text-5xl leading-none tabular-nums">{bank.balance.toLocaleString("ru-RU")}</p>
        <p className="mt-2 text-xs text-muted">
          Карта ··· {bank.card.pan.slice(-4)}
          {bank.nextGrantAt <= Date.now() ? "" : ` · ещё 100 ${waitLabel(bank.nextGrantAt)}`}
          {bank.balance < 0 ? " · баланс ниже нуля, траты закрыты" : ""}
        </p>
        {bank.nextGrantAt <= Date.now() ? (
          <div className="mt-3 space-y-2">
            <HumanCheck resetKey={resetKey} onPayload={setProof} />
            <button
              type="button"
              disabled={busy}
              className="press h-10 rounded-xl bg-accent px-3 text-sm font-medium text-accent-fg disabled:opacity-40"
              onClick={() => {
                if (!proof) {
                  toast.error("Подтвердите, что вы не робот.");
                  return;
                }
                setBusy(true);
                void claimDaily({ data: { proof } })
                  .then(async (result) => {
                    setProof("");
                    setResetKey((value) => value + 1);
                    await load(span);
                    toast(result.status === "opened" ? "Карта открыта" : result.status === "granted" ? "100 вублей на карте" : "Дневные 100 уже забраны");
                    haptic(result.status === "granted" || result.status === "opened" ? "success" : "warning");
                  })
                  .catch((err: unknown) => {
                    setProof("");
                    setResetKey((value) => value + 1);
                    toast.error(err instanceof Error ? err.message : "Не получилось забрать");
                    haptic("error");
                  })
                  .finally(() => setBusy(false));
              }}
            >
              Забрать 100
            </button>
          </div>
        ) : null}
        <button type="button" className="press mt-3 min-h-11 rounded-xl border border-line-strong bg-transparent px-3 text-sm" onClick={() => setTopupOpen(true)}>
          Пополнить вубли
        </button>
        <p className="mt-1 text-xs text-faint">{fmtVub(bank.balance)} · {fmtRubApprox(bank.balance)}</p>
      </section>

      <div className="relative z-10 mt-4 px-1">
        <WoobliCard card={bank.card} />
        <p className="mt-2 text-center text-sm text-muted">Нажмите карту — код на обороте</p>
      </div>

      {history.length ? (
        <section className="mt-4 rounded-3xl border border-line bg-bg px-4 py-4">
          <p className="text-xs tracking-[0.22em] text-faint">История пополнений</p>
          <ul className="mt-2 space-y-2 text-sm">
            {history.map((item) => (
              <li key={item.id} className="flex items-baseline justify-between gap-3">
                <span>{item.rub.toLocaleString("ru-RU")} ₽ · {item.status === "paid" ? "оплачен" : item.status === "pending" ? "ждёт" : item.status}</span>
                <span className="tabular-nums text-faint">{item.status === "paid" ? `+${item.vubliTotal}` : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <TopupSheet
        open={topupOpen || (search.place === "bank" && Boolean(search.topup))}
        existingId={search.place === "bank" ? search.topup : null}
        returnTo="bank"
        onClose={() => {
          setTopupOpen(false);
          if (search.topup) void navigate({ to: "/", search: (prev) => ({ ...prev, topup: undefined }), replace: true });
        }}
        onPaid={() => void load(span)}
      />

      <div className="mt-4 flex justify-center gap-6">
        <RoundButton label="Перевести" pressed={desk === "pay"} onClick={() => setDesk((value) => (value === "pay" ? null : "pay"))}>
          <ArrowUpRight className="size-5" />
        </RoundButton>
        <RoundButton label="Кредит" pressed={desk === "loan"} onClick={() => setDesk((value) => (value === "loan" ? null : "loan"))}>
          <Banknote className="size-4" />
        </RoundButton>
        <RoundButton label="Номер" onClick={() => void copyPan()}>
          <Copy className="size-4" />
        </RoundButton>
      </div>

      {desk === "pay" ? (
        <section className="mt-4 rounded-3xl border border-line bg-bg p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">Перевод</h3>
            <div className="flex rounded-xl bg-subtle p-0.5 text-xs">
              <button
                type="button"
                className={rail === "friend" ? "press h-8 rounded-lg bg-elev px-2.5" : "press h-8 rounded-lg px-2.5 text-muted"}
                onClick={() => {
                  setRail("friend");
                  setPicked(null);
                  setPan("");
                }}
              >
                Другу
              </button>
              <button
                type="button"
                className={rail === "card" ? "press h-8 rounded-lg bg-elev px-2.5" : "press h-8 rounded-lg px-2.5 text-muted"}
                onClick={() => {
                  setRail("card");
                  setPicked(null);
                }}
              >
                По карте
              </button>
            </div>
          </div>
          {rail === "friend" ? (
            <div className="mt-2">
              <input
                className="field"
                value={friendQuery}
                placeholder="Имя друга"
                onChange={(event) => setFriendQuery(event.target.value)}
              />
              <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                {(friends ?? [])
                  .filter((person) => person.name.toLocaleLowerCase("ru").includes(friendQuery.trim().toLocaleLowerCase("ru")))
                  .map((person) => (
                    <li key={person.id}>
                      <button
                        type="button"
                        className={picked?.id === person.id ? "press flex w-full items-center gap-2 rounded-xl bg-subtle px-2 py-1.5 text-left" : "press flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left hover:bg-subtle"}
                        onClick={() => setPicked({ id: person.id, name: person.name, image: person.image })}
                      >
                        <PersonFace name={person.name} image={person.image} size={28} userId={person.id} />
                        <span className="truncate text-sm">{person.name}</span>
                      </button>
                    </li>
                  ))}
              </ul>
              {friends && friends.length === 0 ? <p className="mt-2 text-xs text-faint">Друзей пока нет. Добавьте человека в сообщениях.</p> : null}
              {friends === null ? <PageLoader compact /> : null}
            </div>
          ) : (
            <label className="mt-2 block text-xs text-faint">
              Номер карты
              <input
                className="field mt-1 font-mono tabular-nums tracking-wide"
                inputMode="numeric"
                value={pan.replace(/\D/g, "").replace(/(\d{4})(?=\d)/g, "$1 ").trim()}
                placeholder="7770 0000 0000 0000"
                onChange={(event) => setPan(event.target.value.replace(/\D/g, "").slice(0, 16))}
              />
            </label>
          )}
          {picked ? (
            <p className="mt-2 flex items-center gap-2 text-sm">
              <PersonFace name={picked.name} image={picked.image} size={24} userId={picked.id} />
              Получатель: {picked.name}
            </p>
          ) : rail === "card" && pan.replace(/\D/g, "").length === 16 ? (
            <p className="mt-2 text-xs text-faint">Такой карты нет</p>
          ) : null}
          <div className="mt-2 grid grid-cols-[7rem_1fr] gap-2">
            <label className="block text-xs text-faint">
              Сумма
              <input
                className="field mt-1 tabular-nums"
                inputMode="numeric"
                value={amount}
                maxLength={6}
                onChange={(event) => setAmount(event.target.value.slice(0, 12))}
              />
            </label>
            <label className="block text-xs text-faint">
              Заметка
              <input className="field mt-1" value={note} maxLength={80} placeholder="Необязательно" onChange={(event) => setNote(event.target.value)} />
            </label>
          </div>
          {transferHint(amount, bank.balance) === "funds" ? <p className="mt-1 text-xs text-danger">Недостаточно средств</p> : transferHint(amount, bank.balance) === "empty" ? <p className="mt-1 text-xs text-danger">Введите сумму</p> : null}
          <button type="button" className="press mt-3 h-10 rounded-xl bg-accent px-3 text-sm font-medium text-accent-fg disabled:opacity-40" disabled={busy || !picked || transferHint(amount, bank.balance) !== "ok"} onClick={() => void send()}>
            Перевести
          </button>
        </section>
      ) : null}

      {desk === "loan" ? (
        <section className="mt-4 rounded-3xl border border-line bg-bg p-3">
          <h3 className="text-sm font-medium">Кредит</h3>
          <p className="mt-1 text-[13px] text-muted">500, 1000 или 2000 на 7 дней. Частями или целиком.</p>
          {bank.loan ? (
            <div className="mt-3">
              <p className="font-serif text-3xl tabular-nums">{bank.loan.left}</p>
              <p className="mt-1 text-xs text-muted">
                Осталось из {bank.loan.principal}. Срок до {new Date(bank.loan.dueAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}.
              </p>
              <div className="mt-3 flex gap-2">
                <input
                  className="field tabular-nums"
                  inputMode="numeric"
                  value={payback}
                  placeholder="Часть"
                  onChange={(event) => setPayback(event.target.value.slice(0, 12))}
                />
                <button type="button" disabled={busy || repayHint(payback, bank.balance, bank.loan.left) !== "ok"} className="press h-11 shrink-0 rounded-xl border border-line px-3 text-sm disabled:opacity-40" onClick={() => void repayPart()}>
                  Вернуть часть
                </button>
              </div>
              {repayHint(payback, bank.balance, bank.loan.left) === "funds" ? <p className="mt-1 text-xs text-danger">Недостаточно средств</p> : repayHint(payback, bank.balance, bank.loan.left) === "debt" ? <p className="mt-1 text-xs text-danger">Сумма больше остатка</p> : repayHint(payback, bank.balance, bank.loan.left) === "empty" ? <p className="mt-1 text-xs text-danger">Введите сумму</p> : null}
              <button type="button" disabled={busy} className="press mt-2 h-10 w-full rounded-xl bg-accent text-sm font-medium text-accent-fg disabled:opacity-40" onClick={() => void repayAllMinus()}>
                Списать целиком
              </button>
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              {[500, 1000, 2000].map((amount) => (
                <button key={amount} type="button" disabled={busy || bank.balance < 0} className="press h-10 rounded-xl border border-line px-3 text-sm disabled:opacity-40" onClick={() => void borrow(amount)}>
                  {amount}
                </button>
              ))}
            </div>
          )}
        </section>
      ) : null}

      <section className="mt-5 rounded-3xl border border-line bg-bg p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium">Приглашения</h3>
            <p className="mt-1 text-[13px] text-muted">1000 вублей вам за каждого нового участника по ссылке.</p>
          </div>
          <button type="button" className="press inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border border-line px-3 text-sm" onClick={() => void copyLink()}>
            <Link2 className="size-3.5" />
            Ссылка
          </button>
        </div>
        {origin && bank.referralCode ? (
          <p className="mt-2 truncate rounded-xl bg-elev px-3 py-2 text-xs text-muted">{`${origin}/r/${bank.referralCode}`}</p>
        ) : null}
        {bank.invited.length === 0 ? (
          <p className="mt-2 text-xs text-faint">Пока никого. Новый человек должен зайти по ссылке и создать аккаунт.</p>
        ) : (
          <ul className="mt-2">
            {bank.invited.map((person) => (
              <li key={person.id} className="flex items-center gap-2 border-t border-line py-2 first:border-t-0">
                <PersonFace name={person.name} image={person.image} size={28} userId={person.id} />
                <span className="min-w-0 flex-1 truncate text-sm">{person.name}</span>
                <span className="shrink-0 text-xs text-faint">{when(person.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-5">
        <div className="flex items-center justify-between gap-2 px-1">
          <h3 className="text-sm font-medium">{tx({ ru: "Операции", en: "Activity", kk: "Операциялар" })}</h3>
          <div className="flex gap-1">
            <button type="button" className={span === 5 ? "press h-8 rounded-xl bg-subtle px-2.5 text-xs" : "press h-8 rounded-xl px-2.5 text-xs text-muted"} onClick={() => setSpan(5)}>
              {tx({ ru: "5 дней", en: "5 days", kk: "5 күн" })}
            </button>
            <button type="button" className={span === 30 ? "press h-8 rounded-xl bg-subtle px-2.5 text-xs" : "press h-8 rounded-xl px-2.5 text-xs text-muted"} onClick={() => setSpan(30)}>
              {tx({ ru: "30 дней", en: "30 days", kk: "30 күн" })}
            </button>
          </div>
        </div>
        {bank.history.length === 0 ? (
          <p className="mt-2 px-1 text-xs text-faint">{tx({ ru: "За этот срок переводов нет.", en: "No transfers in this window.", kk: "Осы мерзімде аударым жоқ." })}</p>
        ) : (
          <ul className="mt-2 overflow-hidden rounded-3xl border border-line bg-bg">
            {bank.history.map((row) => (
              <li key={row.id} className="flex items-center gap-3 border-b border-line px-3 py-3 last:border-b-0">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-subtle text-muted" aria-hidden="true">
                  {row.direction === "in" ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">
                    {row.note === "Прилавок"
                      ? "Прилавок"
                      : row.note === "Premium"
                        ? "Premium"
                        : row.note === "VPN"
                          ? "VPN"
                          : row.note === "Кредит"
                            ? "Кредит"
                            : row.note === "Возврат кредита"
                              ? "Возврат кредита"
                              : row.note === "Кредит в минус"
                                ? "Кредит в минус"
                                : row.note === "Достижение"
                                  ? "Достижение"
                                  : row.note === "Змейка"
                                    ? "Змейка"
                                    : row.note === "Сапёр"
                                      ? "Сапёр"
                                      : row.note === "Мегадиск"
                                        ? "Мегадиск"
                                      : row.direction === "in"
                                  ? `От ${row.name}`
                                  : `Для ${row.name}`}
                  </p>
                  <p className="truncate text-xs text-faint">{row.note || when(row.createdAt)}</p>
                </div>
                <p className={row.direction === "in" ? "shrink-0 font-serif text-lg tabular-nums" : "shrink-0 font-serif text-lg text-muted tabular-nums"}>
                  {row.direction === "in" ? "+" : "−"}
                  {row.amount}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function RoundButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className="press flex w-16 flex-col items-center gap-2 text-xs text-muted" aria-pressed={pressed} onClick={onClick}>
      <span className={pressed ? "grid size-12 place-items-center rounded-full bg-accent text-accent-fg" : "grid size-12 place-items-center rounded-full border border-line bg-elev text-fg"}>
        {children}
      </span>
      {label}
    </button>
  );
}
