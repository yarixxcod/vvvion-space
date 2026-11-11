import { stickerUrl } from "@/lib/stickers";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import { useCircleNest } from "@/lib/circle-history";
import { claimMergePayout, getMergePurse, type MergePurse } from "@/lib/social/merge";
import { MineGame } from "@/components/yaronetic/mine-game";
import { SnakeGame } from "@/components/yaronetic/snake-game";

type Chain = "bake" | "garden" | "craft";
type Item = { k: Chain; lv: number };
type Cell = null | { gen: true } | Item;
type Order = { id: string; ticket: string; k: Chain; lv: number; n: number; pay: number };
type Save = { cells: Cell[]; energy: number; energyAt: number; orders: Order[]; next: number };

const KEY = "vvvion.merge.v1";
const SIZE = 30;
const MAX_E = 24;
const REGEN = 3 * 60 * 1000;
const MAX_LV = 5;

const CHAINS: Record<Chain, { name: string; items: { name: string; code: string; emoji: string }[] }> = {
  bake: {
    name: "Пекарня",
    items: [
      { name: "Колос", code: "1f33e", emoji: "🌾" },
      { name: "Хлеб", code: "1f35e", emoji: "🍞" },
      { name: "Круассан", code: "1f950", emoji: "🥐" },
      { name: "Пончик", code: "1f369", emoji: "🍩" },
      { name: "Торт", code: "1f370", emoji: "🍰" },
    ],
  },
  garden: {
    name: "Сад",
    items: [
      { name: "Росток", code: "1f331", emoji: "🌱" },
      { name: "Цветок", code: "1f33c", emoji: "🌼" },
      { name: "Тюльпан", code: "1f337", emoji: "🌷" },
      { name: "Букет", code: "1f490", emoji: "💐" },
      { name: "Роза", code: "1f339", emoji: "🌹" },
    ],
  },
  craft: {
    name: "Мастерская",
    items: [
      { name: "Камень", code: "1faa8", emoji: "🪨" },
      { name: "Кирпич", code: "1f9f1", emoji: "🧱" },
      { name: "Амфора", code: "1f3fa", emoji: "🏺" },
      { name: "Молот", code: "1f528", emoji: "🔨" },
      { name: "Кубок", code: "1f3c6", emoji: "🏆" },
    ],
  },
};

const PATTERNS = [
  { lv: 2, n: 1, pay: 4 },
  { lv: 2, n: 2, pay: 6 },
  { lv: 3, n: 1, pay: 8 },
  { lv: 3, n: 2, pay: 10 },
  { lv: 4, n: 1, pay: 12 },
];

const FACES = ["1F9D1", "1F468", "1F469", "1F474", "1F475", "1F9D3"];

function apple(code: string) {
  return `https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.1.2/img/apple/64/${code}.png`;
}

function google(code: string) {
  return `https://cdn.jsdelivr.net/npm/emoji-datasource-google@15.1.2/img/google/64/${code}.png`;
}

function icon(code: string) {
  return `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/${code}.png`;
}

function ticket() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => (byte % 36).toString(36)).join("");
}

function makeOrder(n: number): Order {
  const pattern = PATTERNS[n % PATTERNS.length] ?? PATTERNS[0];
  const chains: Chain[] = ["bake", "garden", "craft"];
  return {
    id: `o${n}`,
    ticket: ticket(),
    k: chains[n % chains.length] ?? "bake",
    lv: pattern.lv,
    n: pattern.n,
    pay: pattern.pay,
  };
}

function fresh(): Save {
  const cells: Cell[] = Array.from({ length: SIZE }, () => null);
  cells[0] = { gen: true };
  const starters: Item[] = [
    { k: "bake", lv: 1 },
    { k: "bake", lv: 1 },
    { k: "garden", lv: 1 },
    { k: "garden", lv: 1 },
    { k: "craft", lv: 1 },
    { k: "craft", lv: 1 },
    { k: "bake", lv: 2 },
  ];
  starters.forEach((item, index) => {
    cells[index + 1] = item;
  });
  return { cells, energy: MAX_E, energyAt: Date.now(), orders: [makeOrder(1), makeOrder(2), makeOrder(3)], next: 4 };
}

function isItem(cell: Cell): cell is Item {
  return Boolean(cell && !("gen" in cell));
}

function revive(raw: unknown): Save {
  if (!raw || typeof raw !== "object") return fresh();
  const data = raw as Partial<Save>;
  if (!Array.isArray(data.cells) || data.cells.length !== SIZE) return fresh();
  return {
    cells: data.cells,
    energy: typeof data.energy === "number" ? data.energy : MAX_E,
    energyAt: typeof data.energyAt === "number" ? data.energyAt : Date.now(),
    orders: Array.isArray(data.orders) && data.orders.length === 3 ? data.orders : [makeOrder(1), makeOrder(2), makeOrder(3)],
    next: typeof data.next === "number" ? data.next : 4,
  };
}

function withEnergy(save: Save, now = Date.now()): Save {
  if (save.energy >= MAX_E) return { ...save, energy: MAX_E, energyAt: now };
  const gain = Math.floor((now - save.energyAt) / REGEN);
  if (gain <= 0) return save;
  const energy = Math.min(MAX_E, save.energy + gain);
  return { ...save, energy, energyAt: energy >= MAX_E ? now : save.energyAt + gain * REGEN };
}

function readSave(): Save {
  try {
    return withEnergy(revive(JSON.parse(localStorage.getItem(KEY) || "")));
  } catch {
    return fresh();
  }
}

function glyph(item: Item) {
  return CHAINS[item.k].items[item.lv - 1] ?? CHAINS[item.k].items[0];
}

function have(cells: Cell[], order: Order) {
  return cells.filter((cell) => isItem(cell) && cell.k === order.k && cell.lv === order.lv).length;
}

function customer(id: string) {
  let hash = 0;
  for (const char of id) hash = (hash + char.charCodeAt(0)) % FACES.length;
  return FACES[hash] ?? FACES[0];
}

const WASH: Record<Chain, string> = {
  bake: "color-mix(in oklab, #e2a15a 22%, var(--bg))",
  garden: "color-mix(in oklab, #6aaa6a 22%, var(--bg))",
  craft: "color-mix(in oklab, #8aa0b8 24%, var(--bg))",
};

function pickChain(orders: Order[]): Chain {
  const chains: Chain[] = ["bake", "garden", "craft"];
  if (orders.length && Math.random() < 0.7) {
    const order = orders[Math.floor(Math.random() * orders.length)];
    if (order) return order.k;
  }
  return chains[Math.floor(Math.random() * chains.length)] ?? "bake";
}

export function Games() {
  const [open, setOpen] = useState<"stall" | "snake" | "mine" | null>(null);
  useCircleNest(open !== null, () => setOpen(null));
  useEffect(() => {
    if (!open) return;
    window.dispatchEvent(new CustomEvent("vv-circle-nested", { detail: true }));
    return () => {
      window.dispatchEvent(new CustomEvent("vv-circle-nested", { detail: false }));
    };
  }, [open]);
  if (open === "stall") return <Table onBack={() => setOpen(null)} />;
  if (open === "snake") return <SnakeGame onBack={() => setOpen(null)} />;
  if (open === "mine") return <MineGame onBack={() => setOpen(null)} />;
  return (
    <div className="h-full overflow-y-auto p-4">
      <h2 className="font-serif text-3xl tracking-tight">Игры</h2>
      <p className="mt-1 text-sm text-muted">Три короткие. У каждой свой дневной предел.</p>
      <div className="mt-4 space-y-3">
        <button type="button" className="press w-full overflow-hidden rounded-3xl border border-line bg-elev text-left" onClick={() => setOpen("stall")}>
          <span className="flex h-28 items-center justify-center gap-3 bg-[color-mix(in_oklab,var(--accent)_16%,var(--bg))]">
            {["1f35e", "1f490", "1f3fa", "1f3c6"].map((code) => (
              <img key={code} src={google(code)} alt="" className="size-14" />
            ))}
          </span>
          <span className="block px-4 py-3">
            <span className="block font-serif text-2xl tracking-tight">Прилавок</span>
            <span className="mt-1 block text-sm text-muted">Одинаковые вещи складываются в заказ. Не больше 60 в сутки.</span>
          </span>
        </button>
        <button type="button" className="press w-full overflow-hidden rounded-3xl border border-line bg-elev text-left" onClick={() => setOpen("snake")}>
          <span className="flex h-28 items-center justify-center gap-1 bg-subtle">
            <span className="size-8 rounded-xl bg-accent/50" />
            <span className="size-8 rounded-xl bg-accent/70" />
            <span className="size-8 rounded-xl bg-accent" />
            <span className="ml-3 size-6 rounded-full bg-danger" />
          </span>
          <span className="block px-4 py-3">
            <span className="block font-serif text-2xl tracking-tight">Змейка</span>
            <span className="mt-1 block text-sm text-muted">Три яблока — 2 вубля. Не больше 36 в сутки.</span>
          </span>
        </button>
        <button type="button" className="press w-full overflow-hidden rounded-3xl border border-line bg-elev text-left" onClick={() => setOpen("mine")}>
          <span className="grid h-28 grid-cols-4 gap-1 bg-subtle p-6">
            {["", "1", "", "•", "2", "", "", "1", "", "", "2", "", "", "1", "", ""].map((mark, index) => (
              <span key={index} className={mark === "•" ? "rounded-md bg-danger" : "grid place-items-center rounded-md bg-bg text-xs text-muted"}>
                {mark === "•" ? "" : mark}
              </span>
            ))}
          </span>
          <span className="block px-4 py-3">
            <span className="block font-serif text-2xl tracking-tight">Сапёр</span>
            <span className="mt-1 block text-sm text-muted">Чистое поле — 8 вублей. Не больше 40 в сутки.</span>
          </span>
        </button>
      </div>
    </div>
  );
}

function Table({ onBack }: { onBack: () => void }) {
  const [save, setSave] = useState<Save>(fresh);
  const [ready, setReady] = useState(false);
  const [purse, setPurse] = useState<MergePurse | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [burst, setBurst] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const drag = useRef<number | null>(null);
  const point = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const skipClick = useRef(false);

  useEffect(() => {
    setSave(readSave());
    setReady(true);
    void getMergePurse()
      .then(setPurse)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(KEY, JSON.stringify(save));
  }, [ready, save]);

  useEffect(() => {
    const timer = window.setInterval(() => setSave((current) => withEnergy(current)), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  function commit(next: Save) {
    setSave(withEnergy(next));
  }

  function spawn() {
    const now = withEnergy(save);
    if (now.energy < 1) {
      const wait = Math.max(1, Math.ceil((REGEN - (Date.now() - now.energyAt)) / 60_000));
      toast(`Мешок пуст. Новая вещь через ${wait} мин.`);
      commit(now);
      return;
    }
    const hole = now.cells.findIndex((cell) => cell === null);
    if (hole < 0) {
      toast("На столе нет места");
      return;
    }
    const k = pickChain(now.orders);
    const cells = now.cells.slice();
    cells[hole] = { k, lv: 1 };
    const energy = now.energy - 1;
    commit({ ...now, cells, energy, energyAt: now.energy >= MAX_E ? Date.now() : now.energyAt });
  }

  function place(from: number, target: number) {
    if (from === target) return;
    const source = save.cells[from];
    const dest = save.cells[target];
    if (!isItem(source) || (dest && "gen" in dest)) return;
    const cells = save.cells.slice();
    if (dest === null) {
      cells[target] = source;
      cells[from] = null;
      commit({ ...save, cells });
      return;
    }
    if (!isItem(dest)) return;
    if (source.k === dest.k && source.lv === dest.lv && source.lv < MAX_LV) {
      cells[target] = { k: source.k, lv: source.lv + 1 };
      cells[from] = null;
      commit({ ...save, cells });
      setBurst(target);
      window.setTimeout(() => setBurst((current) => (current === target ? null : current)), 460);
      return;
    }
    cells[target] = source;
    cells[from] = dest;
    commit({ ...save, cells });
  }

  function cellAt(x: number, y: number): number | null {
    const node = document.elementFromPoint(x, y);
    const raw = node instanceof Element ? node.closest("[data-cell]")?.getAttribute("data-cell") : null;
    if (raw == null) return null;
    const next = Number(raw);
    return Number.isInteger(next) ? next : null;
  }

  function tap(index: number, cell: Cell) {
    if (cell && "gen" in cell) {
      spawn();
      return;
    }
    if (!isItem(cell)) {
      if (picked != null) place(picked, index);
      setPicked(null);
      return;
    }
    if (picked == null) {
      setPicked(index);
      return;
    }
    if (picked === index) {
      setPicked(null);
      return;
    }
    place(picked, index);
    setPicked(null);
  }

  function restore(taken: { index: number; cell: Item }[]) {
    setSave((current) => {
      const cells = current.cells.slice();
      for (const hit of taken) {
        if (cells[hit.index] == null) cells[hit.index] = hit.cell;
      }
      return { ...current, cells };
    });
  }

  async function deliver(order: Order) {
    if (busy) return;
    const hits = save.cells
      .map((cell, index) => ({ cell, index }))
      .filter((row): row is { cell: Item; index: number } => isItem(row.cell) && row.cell.k === order.k && row.cell.lv === order.lv)
      .slice(0, order.n);
    if (hits.length < order.n) return;
    const taken = hits.map((hit) => ({ index: hit.index, cell: hit.cell }));
    const cells = save.cells.slice();
    for (const hit of taken) cells[hit.index] = null;
    commit({ ...save, cells });
    setPicked(null);
    setBusy(true);
    try {
      const next = await claimMergePayout({ data: { amount: order.pay, ticket: order.ticket } });
      setPurse(next);
      if (!next.credited) {
        restore(taken);
        toast("Этот заказ уже сдан");
        return;
      }
      setSave((current) => ({
        ...current,
        orders: current.orders.map((item) => (item.id === order.id ? makeOrder(current.next) : item)),
        next: current.next + 1,
      }));
      toast(`+${order.pay} вублей`);
    } catch (err) {
      restore(taken);
      toast.error(err instanceof Error ? err.message : "Выплата не прошла");
    } finally {
      setBusy(false);
    }
  }

  const waitMin = save.energy >= MAX_E ? 0 : Math.max(1, Math.ceil((REGEN - (Date.now() - save.energyAt)) / 60_000));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-3 pt-3">
        <button type="button" className="press inline-flex size-10 items-center justify-center rounded-2xl text-muted" aria-label="К списку игр" onClick={onBack}>
          <ChevronLeft className="size-4" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="font-serif text-2xl tracking-tight">Прилавок</h2>
          <p className="text-xs text-faint">
            Энергия {save.energy}/{MAX_E}
            {waitMin ? ` · ещё через ${waitMin} мин` : ""}
            {purse ? ` · сегодня ${purse.today} из ${purse.cap}` : ""}
            {purse ? ` · на карте ${purse.balance}` : ""}
          </p>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-subtle">
            <div className="h-full bg-accent" style={{ width: `${(save.energy / MAX_E) * 100}%` }} />
          </div>
        </div>
      </div>
      <div className="mt-2 flex gap-2 overflow-x-auto px-3 pb-1">
        {save.orders.map((order) => {
          const item = glyph({ k: order.k, lv: order.lv });
          const readyCount = have(save.cells, order);
          const ok = readyCount >= order.n && !busy && (purse ? purse.today + order.pay <= purse.cap : true);
          return (
            <div key={order.id} className="w-48 shrink-0 rounded-2xl border border-line bg-elev p-2">
              <div className="flex items-center gap-2">
                <Piece src={stickerUrl(customer(order.id))} emoji="🙂" label="Покупатель" />
                <Piece src={apple(item.code)} emoji={item.emoji} label={item.name} />
                <div className="min-w-0">
                  <p className="truncate text-sm">{item.name}</p>
                  <p className="text-xs text-faint">
                    {readyCount}/{order.n} · {order.pay} вублей
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={!ok}
                className="press mt-2 h-9 w-full rounded-xl bg-accent text-sm font-medium text-accent-fg disabled:opacity-40"
                onClick={() => void deliver(order)}
              >
                Сдать
              </button>
            </div>
          );
        })}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        <div className="mx-auto grid max-w-md grid-cols-5 gap-1.5" style={{ touchAction: "none" }}>
          {save.cells.map((cell, index) => {
            const item = isItem(cell) ? glyph(cell) : null;
            return (
              <button
                key={index}
                type="button"
                data-cell={index}
                aria-label={cell && "gen" in cell ? "Мешок, взять вещь" : item ? `${item.name}, уровень ${isItem(cell) ? cell.lv : 1}` : "Пустая клетка"}
                className={`relative grid aspect-square place-items-center rounded-2xl border bg-bg ${over === index || picked === index ? "border-accent" : "border-line"} ${burst === index ? "merge-pop" : ""}`}
                style={{ background: isItem(cell) ? WASH[cell.k] : undefined }}
                onClick={() => {
                  if (skipClick.current) {
                    skipClick.current = false;
                    return;
                  }
                  tap(index, cell);
                }}
                onPointerDown={(event) => {
                  if (!isItem(cell)) return;
                  point.current = { x: event.clientX, y: event.clientY, moved: false };
                  drag.current = index;
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                  const start = point.current;
                  if (!start || drag.current == null) return;
                  if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) start.moved = true;
                  if (!start.moved) return;
                  setOver(cellAt(event.clientX, event.clientY));
                }}
                onPointerUp={(event) => {
                  const start = point.current;
                  const from = drag.current;
                  point.current = null;
                  drag.current = null;
                  setOver(null);
                  if (!start) return;
                  skipClick.current = true;
                  if (start.moved && from != null) {
                    const next = cellAt(event.clientX, event.clientY);
                    place(from, next == null ? from : next);
                    setPicked(null);
                    return;
                  }
                  tap(index, cell);
                }}
                onPointerCancel={() => {
                  point.current = null;
                  drag.current = null;
                  setOver(null);
                }}
              >
                {cell && "gen" in cell ? <Piece src={icon("1f392")} emoji="🎒" label="Мешок" /> : null}
                {item && isItem(cell) ? (
                  <>
                    <Piece src={apple(item.code)} emoji={item.emoji} label={item.name} />
                    <span className="absolute right-1 bottom-0.5 text-xs tabular-nums text-faint">{cell.lv}</span>
                  </>
                ) : null}
              </button>
            );
          })}
        </div>
        <p className="mx-auto mt-3 max-w-md text-xs leading-relaxed text-faint">
          Нажмите мешок, чтобы достать вещь. Нажмите две одинаковые по очереди или перетащите одну на другую — получится следующая. Сдайте заказ покупателю. В сутки прилавок платит не больше 60 вублей.
        </p>
        <button
          type="button"
          className="press mx-auto mt-3 block h-10 rounded-xl px-3 text-xs text-muted"
          onClick={() => {
            if (!window.confirm("Собрать стол заново? Вубли, которые уже пришли, останутся.")) return;
            const next = fresh();
            setSave(next);
            localStorage.setItem(KEY, JSON.stringify(next));
          }}
        >
          Собрать стол заново
        </button>
      </div>
    </div>
  );
}

function Piece({ src, emoji, label }: { src: string; emoji: string; label: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className="text-2xl leading-none" aria-hidden="true">
        {emoji}
      </span>
    );
  }
  return <img src={src} alt={label} className="size-9" draggable={false} onError={() => setFailed(true)} />;
}
