import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCircleNest } from "@/lib/circle-history";
import { PageLoader } from "@/components/yaronetic/page-loader";
import { refreshFaceMarks } from "@/components/yaronetic/person-face";
import { PurchaseSheet } from "@/components/yaronetic/purchase-sheet";
import { TopupSheet } from "@/components/yaronetic/topup-sheet";
import { VerifyMailButton } from "@/components/yaronetic/verify-mail";
import { getBank, type BankSnapshot } from "@/lib/social/bank";
import { getPersonaShop, type PersonaShop } from "@/lib/social/personas";
import { getPremium, type PremiumState } from "@/lib/social/premium";
import { getMegaOffer, type MegaOffer } from "@/lib/social/mega";
import { getVpnShowcase, type VpnShowcase } from "@/lib/social/vpn";
import { fmtRubApprox, fmtVub } from "@/lib/pay/format";
import { GiftDesk } from "@/components/yaronetic/gift-desk";
import { getShopShelf } from "@/lib/social/prices";
import { useTx } from "@/lib/lang";
import { haptic } from "@/lib/haptic";
import { loadError } from "@/lib/load-error";

const SECTIONS = [
  ["main", "Главное"],
  ["subs", "Подписки"],
  ["ai", "ИИ"],
  ["storage", "Хранилище"],
  ["look", "Оформление"],
  ["gifts", "Подарки"],
] as const;

type Section = (typeof SECTIONS)[number][0];

type Intent = { sku: string; title: string; price: number; detail: string };

function untilLabel(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

function isSection(value: string | undefined): value is Section {
  return SECTIONS.some((item) => item[0] === value);
}

export function Shop() {
  const tx = useTx();
  const navigate = useNavigate();
  const search = useSearch({ from: "/" });
  const [bank, setBank] = useState<BankSnapshot | null>(null);
  const [premium, setPremium] = useState<PremiumState | null>(null);
  const [vpn, setVpn] = useState<VpnShowcase | null>(null);
  const [mega, setMega] = useState<MegaOffer | null>(null);
  const [shop, setShop] = useState<PersonaShop | null>(null);
  const [people, setPeople] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [intent, setIntent] = useState<Intent | null>(null);
  const [topup, setTopup] = useState(false);
  const [needVub, setNeedVub] = useState<number | undefined>(undefined);
  const [shelf, setShelf] = useState({ boost: 1000, disk: 1000 });
  const keys = useRef(new Map<string, string>());
  const section: Section = isSection(search.s) ? search.s : "main";
  useCircleNest(people, () => setPeople(false));
  useEffect(() => {
    if (!people) return;
    window.dispatchEvent(new CustomEvent("vv-circle-nested", { detail: true }));
    return () => {
      window.dispatchEvent(new CustomEvent("vv-circle-nested", { detail: false }));
    };
  }, [people]);

  async function load() {
    const [nextBank, nextPremium, nextShop, nextVpn, nextMega, nextShelf] = await Promise.all([
      getBank(),
      getPremium(),
      getPersonaShop(),
      getVpnShowcase(),
      getMegaOffer(),
      getShopShelf(),
    ]);
    setBank(nextBank);
    setPremium(nextPremium);
    setShop(nextShop);
    setVpn(nextVpn);
    setMega(nextMega);
    setShelf(nextShelf);
    setError(null);
  }

  useEffect(() => {
    void load().catch((err: unknown) => setError(loadError(err instanceof Error ? err.message : "", "Магазин сейчас закрыт")));
  }, []);

  function pick(next: Section) {
    void navigate({
      to: "/",
      search: (prev) => ({ ...prev, place: "shop", s: next === "main" ? undefined : next }),
      replace: true,
    });
  }

  function ask(next: Intent, verified = true) {
    if (!verified) return;
    setIntent(next);
  }

  async function confirm() {
    if (!intent || busy) return;
    let key = keys.current.get(intent.sku);
    if (!key) {
      key = crypto.randomUUID();
      keys.current.set(intent.sku, key);
    }
    setBusy(true);
    try {
      const res = await fetch("/api/shop/purchase", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sku: intent.sku, idempotencyKey: key }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string; balance?: number };
      if (!res.ok) throw new Error(body.message || "Покупка не прошла");
      keys.current.delete(intent.sku);
      await load();
      if (intent.sku === "premium") refreshFaceMarks();
      haptic("success");
      toast("Покупка оформлена");
      setIntent(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Покупка не прошла");
      haptic("error");
    } finally {
      setBusy(false);
    }
  }

  function refill(short?: number) {
    setNeedVub(short);
    setTopup(true);
    setIntent(null);
  }

  if (error) {
    return (
      <div className="p-4">
        <p className="text-sm text-danger">{error}</p>
        <button type="button" className="press mt-3 min-h-11 rounded-xl border border-line px-3 text-sm" onClick={() => void load().catch((err) => setError(loadError(err instanceof Error ? err.message : "", "Магазин сейчас закрыт")))}>
          Повторить
        </button>
      </div>
    );
  }

  if (!bank || !premium) return <PageLoader />;

  const sheets = (
    <>
      <PurchaseSheet
        open={Boolean(intent)}
        title={intent?.title ?? ""}
        price={intent?.price ?? 0}
        balance={bank.balance}
        detail={intent?.detail ?? ""}
        busy={busy}
        onClose={() => setIntent(null)}
        onConfirm={() => void confirm()}
        onTopup={(short) => refill(short)}
      />
      <TopupSheet
        open={topup || (search.place === "shop" && Boolean(search.topup))}
        existingId={search.place === "shop" ? search.topup : null}
        returnTo="shop"
        needVub={needVub}
        onClose={() => {
          setTopup(false);
          setNeedVub(undefined);
          if (search.topup) {
            void navigate({ to: "/", search: (prev) => ({ ...prev, topup: undefined }), replace: true });
          }
        }}
        onPaid={() => void load()}
      />
    </>
  );

  if (people) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="px-4 pt-3">
          <h2 className="font-serif text-2xl tracking-tight">Персонажи</h2>
          <p className="text-xs text-faint">Пока действует Premium, все уже доступны. Покупка оставляет персонажа и после.</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {shop ? (
            <ul className="mx-auto grid w-full max-w-[960px] grid-cols-2 gap-2 md:grid-cols-3">
              {shop.items.map((item) => (
                <li key={item.id} className="rounded-3xl border border-line bg-elev p-3">
                  <img src={item.face} alt="" className="size-16 rounded-2xl bg-subtle" />
                  <p className="mt-2 text-sm font-medium">{item.name}</p>
                  <p className="mt-0.5 text-xs text-faint">{item.role}</p>
                  <p className="mt-2 font-serif text-lg tabular-nums">{fmtVub(item.price)}</p>
                  <p className="text-xs text-faint">{fmtRubApprox(item.price)}</p>
                  {item.owned ? (
                    <p className="mt-2 text-xs text-muted">Куплен</p>
                  ) : item.viaPremium ? (
                    <p className="mt-2 text-xs text-muted">В подписке</p>
                  ) : (
                    <button
                      type="button"
                      className="press mt-2 min-h-11 w-full rounded-xl border border-line-strong bg-transparent text-sm"
                      onClick={() => ask({ sku: `persona:${item.id}`, title: item.name, price: item.price, detail: "Персонаж останется и после подписки." })}
                    >
                      Купить
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <PageLoader compact />
          )}
        </div>
        {sheets}
      </div>
    );
  }

  const show = (name: Section) => section === "main" || section === name;
  const owned = [
    premium.active ? `Premium до ${untilLabel(premium.until)}` : "",
    vpn?.active ? `VPN до ${untilLabel(vpn.until)}` : "",
    mega?.active ? `Мегадиск до ${untilLabel(mega.until)}` : "",
    ...(shop?.items.filter((item) => item.owned).map((item) => item.name) ?? []),
  ].filter(Boolean);

  return (
    <div className="h-full overflow-y-auto px-3 pt-3 pb-6">
      <div className="mx-auto w-full max-w-[960px]">
        <div className="sticky top-0 z-10 -mx-3 mb-3 flex items-center justify-between gap-2 border-b border-line bg-bg/95 px-3 py-2">
          <button type="button" className="min-h-11 rounded-full border border-line px-3 text-left text-sm tabular-nums" onClick={() => refill()}>
            {fmtVub(bank.balance)} · {fmtRubApprox(bank.balance)}
          </button>
          <button type="button" className="press min-h-11 rounded-full bg-accent px-4 text-sm font-medium text-accent-fg" onClick={() => refill()}>
            Пополнить
          </button>
        </div>
        <p className="text-xs tracking-[0.22em] text-faint uppercase">{tx({ ru: "Магазин", en: "Shop", kk: "Дүкен" })}</p>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {SECTIONS.map(([id, label]) => (
            <button key={id} type="button" className={`press min-h-11 shrink-0 rounded-full border px-3 text-sm ${section === id ? "border-line-strong bg-elev" : "border-line bg-transparent text-muted"}`} onClick={() => pick(id)}>
              {label}
            </button>
          ))}
        </div>

        {show("main") && owned.length ? (
          <section className="mt-4 rounded-3xl border border-line bg-bg px-4 py-4">
            <p className="text-xs tracking-[0.22em] text-faint">Ваши покупки</p>
            <ul className="mt-2 space-y-1 text-sm">
              {owned.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {show("subs") ? (
          <section className="mt-4 overflow-hidden rounded-3xl border border-line bg-elev">
            <div className="bg-[color-mix(in_oklab,#6e5ad6_22%,var(--elev))] px-4 py-4">
              <p className="text-xs tracking-[0.22em] text-muted">VVVION PREMIUM</p>
              <h3 className="mt-1 font-serif text-3xl tracking-tight">{premium.active ? "Действует" : `${premium.days} дней`}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                {premium.active
                  ? `До ${untilLabel(premium.until)}. Продление добавит ещё ${premium.days} дней.`
                  : "Двойной дневной лимит, если он задан. Плюс 500 МБ на диске, пока подписка жива. Все персонажи без отдельной покупки. Сиреневая окантовка аватарки."}
              </p>
              <p className="mt-3 font-serif text-2xl tabular-nums">{fmtVub(premium.price)}</p>
              <p className="text-xs text-muted">{fmtRubApprox(premium.price)}</p>
            </div>
            <div className="px-4 py-4">
              {premium.verified ? (
                <button type="button" className="press min-h-11 w-full rounded-2xl bg-accent text-sm font-medium text-accent-fg" onClick={() => ask({ sku: "premium", title: "Premium", price: premium.price, detail: `Подписка продлится на ${premium.days} дней.` })}>
                  {premium.active ? "Продлить" : "Открыть"}
                </button>
              ) : (
                <VerifyMailButton onVerified={() => void load()} />
              )}
            </div>
          </section>
        ) : null}

        {show("subs") ? (
          <Goods
            kicker="VPN"
            title={`Ссылка на ${vpn?.days ?? 30} дней`}
            body={vpn?.active ? `Действует до ${untilLabel(vpn.until)}. Продление не меняет ссылку.` : "Сама ссылка и QR остаются в сервисе VPN."}
            price={vpn?.price ?? 2000}
            action={
              vpn?.verified === false ? (
                <VerifyMailButton onVerified={() => void load()} />
              ) : (
                <button type="button" className="press min-h-11 rounded-xl border border-line-strong bg-transparent px-3 text-sm" onClick={() => ask({ sku: "vpn", title: "VPN", price: vpn?.price ?? 2000, detail: `Ссылка VPN будет действовать ${vpn?.days ?? 30} дней.` })}>
                  {vpn?.active ? "Продлить" : "Купить"}
                </button>
              )
            }
          />
        ) : null}

        {show("storage") ? (
          <Goods
            kicker="МЕГАДИСК"
            title={`2 ГБ на ${mega?.days ?? 30} дней`}
            body={mega?.active ? `Действует до ${untilLabel(mega.until)}. Продление не стирает файлы.` : "Скачивание можно оставить в кэше браузера. Диск живёт отдельно от картинок чата."}
            price={mega?.price ?? 1500}
            action={
              mega?.verified === false ? (
                <VerifyMailButton onVerified={() => void load()} />
              ) : (
                <button type="button" className="press min-h-11 rounded-xl border border-line-strong bg-transparent px-3 text-sm" onClick={() => ask({ sku: "mega", title: "Мегадиск", price: mega?.price ?? 1500, detail: `Мегадиск на ${mega?.days ?? 30} дней, 2 ГБ.` })}>
                  {mega?.active ? "Продлить" : "Купить"}
                </button>
              )
            }
          />
        ) : null}

        {show("ai") ? (
          <Goods
            kicker="ИИ"
            title="Сутки подлиннее"
            body="Плюс 100 запросов к дневному лимиту на 24 часа, если лимит задан. Оплата сверх лимита поштучно выключена."
            price={shelf.boost}
            action={
              <button type="button" className="press min-h-11 rounded-xl border border-line-strong bg-transparent px-3 text-sm" onClick={() => ask({ sku: "boost", title: "Сутки подлиннее", price: shelf.boost, detail: "К дневному лимиту запросов добавится 100 на сутки." })}>
                Купить
              </button>
            }
          />
        ) : null}

        {show("storage") ? (
          <Goods
            kicker="ДИСК"
            title="Место на диске"
            body="Плюс 100 МБ навсегда. Подписка отдельно даёт 500 МБ, пока действует."
            price={shelf.disk}
            action={
              <button type="button" className="press min-h-11 rounded-xl border border-line-strong bg-transparent px-3 text-sm" onClick={() => ask({ sku: "disk", title: "Место на диске", price: shelf.disk, detail: "На диске станет на 100 МБ больше." })}>
                Купить
              </button>
            }
          />
        ) : null}

        {show("look") ? (
          <button type="button" className="press mt-3 flex w-full items-center gap-3 rounded-3xl border border-line bg-bg px-3 py-3 text-left" onClick={() => setPeople(true)}>
            <span className="flex -space-x-2" aria-hidden="true">
              {(shop?.items ?? []).slice(0, 4).map((item) => (
                <img key={item.id} src={item.face} alt="" className="size-10 rounded-full border-2 border-bg bg-subtle" />
              ))}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">Персонажи</span>
              <span className="mt-0.5 block text-xs text-faint">{shop ? `${shop.items.length} собеседников` : "Загрузка"}</span>
            </span>
          </button>
        ) : null}

        {section === "gifts" && bank ? (
          <GiftDesk
            balance={bank.balance}
            verified={Boolean(premium?.verified)}
            onDone={() => void load()}
            onNeed={(missing) => {
              setNeedVub(missing);
              setTopup(true);
            }}
          />
        ) : null}
      </div>
      {sheets}
    </div>
  );
}

function Goods({ kicker, title, body, price, action }: { kicker: string; title: string; body: string; price: number; action: ReactNode }) {
  return (
    <section className="mt-3 rounded-3xl border border-line bg-bg px-4 py-4">
      <p className="text-xs tracking-[0.22em] text-faint">{kicker}</p>
      <h3 className="mt-1 font-serif text-2xl tracking-tight">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
      <p className="mt-3 font-serif text-xl tabular-nums">{fmtVub(price)}</p>
      <p className="text-xs text-faint">{fmtRubApprox(price)}</p>
      <div className="mt-3">{action}</div>
    </section>
  );
}
