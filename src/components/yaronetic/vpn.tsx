import { useEffect, useState } from "react";
import { ChevronLeft, Copy } from "lucide-react";
import { encode } from "uqr";
import { toast } from "sonner";
import { LoaderMark } from "@/components/yaronetic/page-loader";
import { VerifyMailButton } from "@/components/yaronetic/verify-mail";
import { buyVpn, getVpnShowcase, type VpnShowcase } from "@/lib/social/vpn";
import { useTx } from "@/lib/lang";

function trafficLabel(bytes: number) {
  const gb = bytes / (1024 * 1024 * 1024);
  if (!Number.isFinite(gb) || gb <= 0) return "";
  return `${Math.round(gb)} ГБ`;
}

function untilLabel(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

function Qr({ value }: { value: string }) {
  const qr = encode(value);
  const cells: { x: number; y: number }[] = [];
  for (let y = 0; y < qr.size; y++) {
    const row = qr.data[y];
    if (!row) continue;
    for (let x = 0; x < qr.size; x++) if (row[x]) cells.push({ x, y });
  }
  return (
    <svg viewBox={`0 0 ${qr.size} ${qr.size}`} className="size-48 rounded-2xl bg-white p-2" role="img" aria-label="QR-код подписки">
      <rect width={qr.size} height={qr.size} fill="#fff" />
      {cells.map((cell) => (
        <rect key={`${cell.x}-${cell.y}`} x={cell.x} y={cell.y} width="1" height="1" fill="#1c1b19" />
      ))}
    </svg>
  );
}

export function VpnService({ onBack }: { onBack: () => void }) {
  const tx = useTx();
  const [row, setRow] = useState<VpnShowcase | null>(null);
  const [busy, setBusy] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
    void getVpnShowcase()
      .then(setRow)
      .catch((err: unknown) => toast.error(err instanceof Error ? err.message : "VPN сейчас не открылся"));
  }, []);

  const url = row?.token && origin ? `${origin}/api/vpn/${row.token}` : "";

  async function buy() {
    if (busy || !row) return;
    if (!row.verified) {
      toast.error("Сначала подтвердите почту в профиле");
      return;
    }
    if (!window.confirm(`Потратить ${row.price} вублей? Ссылка будет действовать ${row.days} дней. Если подписка уже есть, срок прибавится.`)) return;
    setBusy(true);
    try {
      setRow(await buyVpn());
      toast("Подписка открыта");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Покупка не прошла");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast("Ссылка скопирована");
    } catch {
      toast.error("Не удалось скопировать");
    }
  }

  const buyLabel = !row
    ? ""
    : !row.verified
      ? tx({ ru: "Сначала подтвердите почту", en: "Confirm your email first", kk: "Алдымен поштаны растаңыз" })
      : tx({
          ru: `${row.active ? "Продлить" : "Купить"} за ${row.price}`,
          en: `${row.active ? "Extend" : "Buy"} for ${row.price}`,
          kk: `${row.active ? "Ұзарту" : "Сатып алу"} · ${row.price}`,
        });

  return (
    <div className="h-full overflow-y-auto px-4 py-4">
      <button type="button" className="press inline-flex items-center gap-1 text-sm text-muted" onClick={onBack}>
        <ChevronLeft className="size-4" />
        {tx({ ru: "Сервисы", en: "Services", kk: "Сервистер" })}
      </button>
      <h3 className="mt-3 font-serif text-3xl tracking-tight">VVVION VPN</h3>
      <p className="mt-1 text-sm text-muted">Happ, Incy, Karing</p>

      <dl className="mt-4 divide-y divide-line overflow-hidden rounded-3xl border border-line bg-elev text-sm">
        <Fact term={tx({ ru: "Срок", en: "Term", kk: "Мерзім" })} value={row?.active ? tx({ ru: `до ${untilLabel(row.until)}`, en: `until ${untilLabel(row.until)}`, kk: `${untilLabel(row.until)} дейін` }) : tx({ ru: "30 дней", en: "30 days", kk: "30 күн" })} />
        <Fact term={tx({ ru: "Цена", en: "Price", kk: "Баға" })} value={row ? tx({ ru: `${row.price} вуб.`, en: `${row.price} vubles`, kk: `${row.price} вуб.` }) : tx({ ru: "2000 вуб.", en: "2000 vubles", kk: "2000 вуб." })} />
        <Fact term={tx({ ru: "Трафик в программе", en: "Traffic in the app", kk: "Бағдарламадағы трафик" })} value={row ? trafficLabel(row.trafficBytes) || tx({ ru: "без лимита", en: "no cap", kk: "шексіз" }) : "100 ГБ"} />
        <Fact term={tx({ ru: "Имя подписки", en: "Subscription name", kk: "Жазылым аты" })} value="VVVION" />
        <Fact term={tx({ ru: "Обновление", en: "Refresh", kk: "Жаңарту" })} value={tx({ ru: "примерно раз в час", en: "about once an hour", kk: "шамамен сағатына бір рет" })} />
        <Fact term={tx({ ru: "Клиенты", en: "Apps", kk: "Қолданбалар" })} value="Happ, Incy, Karing" />
      </dl>

      <section className="mt-4">
        <h4 className="text-sm font-medium">{tx({ ru: "Локации", en: "Places", kk: "Орындар" })}</h4>
        {row && row.locations.length > 0 ? (
          <ol className="mt-2 space-y-1">
            {row.locations.map((name, index) => (
              <li key={name} className="flex items-center gap-3 rounded-2xl border border-line bg-bg px-3 py-2 text-sm">
                <span className="w-5 shrink-0 tabular-nums text-faint">{index + 1}</span>
                {name}
              </li>
            ))}
          </ol>
        ) : row ? (
          <p className="mt-2 text-sm text-faint">{tx({ ru: "Локаций пока нет.", en: "No places yet.", kk: "Орын әзірге жоқ." })}</p>
        ) : (
          <LoaderMark className="vv-loader-sm mt-3" />
        )}
      </section>

      {row && !row.verified ? (
        <div className="mt-4">
          <p className="mb-2 text-sm text-muted">{row.price} вуб.</p>
          <VerifyMailButton onVerified={() => void getVpnShowcase().then(setRow).catch(() => undefined)} />
        </div>
      ) : (
        <button type="button" disabled={busy || !row} className="press mt-4 h-11 w-full rounded-2xl bg-accent text-sm font-medium text-accent-fg disabled:opacity-40" onClick={() => void buy()}>
          {!row ? <LoaderMark className="vv-loader-sm" /> : buyLabel}
        </button>
      )}

      {url ? (
        <section className="mt-4 rounded-3xl border border-line bg-bg p-4">
          <p className="text-sm font-medium">Ссылка подписки</p>
          <p className="mt-2 break-all rounded-2xl bg-elev px-3 py-2 font-mono text-xs text-muted">{url}</p>
          <button type="button" className="press mt-3 inline-flex h-10 items-center gap-1.5 rounded-xl border border-line px-3 text-sm" onClick={() => void copy()}>
            <Copy className="size-3.5" />
            Скопировать
          </button>
          <div className="mt-4 flex justify-center">
            <Qr value={url} />
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Fact({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-3 py-2.5">
      <dt className="text-faint">{term}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
