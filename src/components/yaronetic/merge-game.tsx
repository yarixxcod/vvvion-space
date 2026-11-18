import { stickerUrl } from "@/lib/stickers";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import { useCircleNest } from "@/lib/circle-history";
import { claimMergePayout, getMergePurse, type MergePurse } from "@/lib/social/merge";
import { TilesGame, MemoryGame, LightsGame } from "@/components/yaronetic/puzzle-games";
import { GAME_RULES } from "@/lib/games/payout";
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

const CHAINS: Record<
  Chain,
  { name: string; items: { name: string; code: string; emoji: string }[] }
> = {
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
  return {
    cells,
    energy: MAX_E,
    energyAt: Date.now(),
    orders: [makeOrder(1), makeOrder(2), makeOrder(3)],
    next: 4,
  };
}

function isItem(cell: Cell): cell is Item {
  return Boolean(cell && !("gen" in cell));
}

function revive(raw: unknown): Save {
  if (!raw || typeof raw !== "object") return fresh();
  const data = raw as Partial<Save>;
  if (!Array.isArray(data.cells) || data.cells.length !== SIZE) return fresh();
  const cells = data.cells.map((cell): Cell => {
    if (!cell || typeof cell !== "object") return null;
    if ("gen" in cell) return null;
    return ["bake", "garden", "craft"].includes(cell.k) &&
      Number.isInteger(cell.lv) &&
      cell.lv >= 1 &&
      cell.lv <= MAX_LV
      ? { k: cell.k, lv: cell.lv }
      : null;
  });
  cells[0] = { gen: true };
  const validOrders =
    Array.isArray(data.orders) &&
    data.orders.length === 3 &&
    data.orders.every(
      (order) =>
        order &&
        typeof order.id === "string" &&
        typeof order.ticket === "string" &&
        /^[a-z0-9]{8,16}$/.test(order.ticket) &&
        ["bake", "garden", "craft"].includes(order.k) &&
        PATTERNS.some((p) => p.lv === order.lv && p.n === order.n && p.pay === order.pay),
    );
  return {
    cells,
    energy:
      typeof data.energy === "number" && Number.isFinite(data.energy)
        ? Math.max(0, Math.min(MAX_E, Math.floor(data.energy)))
        : MAX_E,
    energyAt:
      typeof data.energyAt === "number" && Number.isFinite(data.energyAt)
        ? Math.min(Date.now(), Math.max(0, data.energyAt))
        : Date.now(),
    orders: validOrders ? data.orders! : [makeOrder(1), makeOrder(2), makeOrder(3)],
    next:
      typeof data.next === "number" && Number.isSafeInteger(data.next) && data.next >= 4
        ? data.next
        : 4,
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
  const [open, setOpen] = useState<
    "stall" | "snake" | "mine" | "tiles" | "memory" | "lights" | null
  >(null);
  const [filter, setFilter] = useState<"all" | "paid" | "puzzle">("all");
  useCircleNest(open !== null, () => setOpen(null));
  useEffect(() => {
    if (!open) return;
    window.dispatchEvent(new CustomEvent("vv-circle-nested", { detail: true }));
    return () => {
      window.dispatchEvent(new CustomEvent("vv-circle-nested", { detail: false }));
    };
  }, [open]);
  if (open === "tiles") return <TilesGame onBack={() => setOpen(null)} />;
  if (open === "memory") return <MemoryGame onBack={() => setOpen(null)} />;
  if (open === "lights") return <LightsGame onBack={() => setOpen(null)} />;
  if (open === "stall") return <Table onBack={() => setOpen(null)} />;
  if (open === "snake") return <SnakeGame onBack={() => setOpen(null)} />;
  if (open === "mine") return <MineGame onBack={() => setOpen(null)} />;
  const games = [
    {
      id: "stall",
      title: "Прилавок",
      description: "Соединяйте предметы и собирайте заказы",
      tag: "Слияние",
      paid: true,
      rule: GAME_RULES.stall,
    },
    {
      id: "snake",
      title: "Змейка",
      description: "Собирайте яблоки, избегайте хвоста",
      tag: "Аркада",
      paid: true,
      rule: GAME_RULES.snake,
    },
    {
      id: "mine",
      title: "Сапёр",
      description: "Откройте поле без единой мины",
      tag: "Логика",
      paid: true,
      rule: GAME_RULES.mine,
    },
    {
      id: "tiles",
      title: "2048 · Орбита",
      description: "Соединяйте числа и покорите 2048",
      tag: "Новое",
      paid: false,
    },
    {
      id: "memory",
      title: "Созвездия",
      description: "Находите пары и тренируйте память",
      tag: "Новое",
      paid: false,
    },
    {
      id: "lights",
      title: "Погаси звёзды",
      description: "Одна клетка меняет всё вокруг",
      tag: "Новое",
      paid: false,
    },
  ] as const;
  const visible = games.filter((g) => filter === "all" || (filter === "paid" ? g.paid : !g.paid));
  return (
    <div className="h-full overflow-y-auto px-4 py-4" data-games-catalog>
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[.18em] text-muted">
            VVVion Arcade
          </p>
          <h2 className="mt-1 font-serif text-3xl tracking-tight">Небольшой перерыв</h2>
          <p className="mt-1 text-sm text-muted">Шесть игр. Без ставок и покупок ходов.</p>
        </div>
        <span className="mb-1 rounded-full border border-line px-2 py-1 text-xs text-muted">
          6 игр
        </span>
      </div>
      <div className="my-4 flex gap-2 overflow-x-auto pb-1" aria-label="Категории игр">
        {(
          [
            ["all", "Все игры"],
            ["paid", "С наградами"],
            ["puzzle", "Головоломки"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
            className={
              filter === id
                ? "press min-h-11 shrink-0 rounded-full bg-accent px-3 text-xs font-medium text-accent-fg"
                : "press min-h-11 shrink-0 rounded-full border border-line px-3 text-xs text-muted"
            }
          >
            {label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 min-[650px]:grid-cols-3">
        {visible.map((game) => (
          <button
            key={game.id}
            type="button"
            data-game-id={game.id}
            onClick={() => setOpen(game.id)}
            className="game-tile press group flex min-w-0 flex-col overflow-hidden rounded-3xl border border-line bg-elev text-left"
          >
            <span className="relative block aspect-[5/4] w-full overflow-hidden bg-[#21172f]">
              <img
                src={`/games/${game.id}-v2.webp`}
                alt=""
                width="512"
                height="512"
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105 motion-reduce:transform-none"
              />
              <span className="absolute top-2 left-2 rounded-full bg-[#171021d9] px-2 py-1 text-[9px] font-medium text-[#f1e8ff]">
                {game.tag}
              </span>
            </span>
            <span className="flex flex-1 flex-col px-3 py-3">
              <span className="block text-sm font-semibold leading-snug">{game.title}</span>
              <span className="mt-1 block min-h-8 text-[11px] leading-relaxed text-muted">
                {game.description}
              </span>
              <span
                className={
                  game.paid
                    ? "mt-3 block text-[10px] font-medium text-fg"
                    : "mt-3 block text-[10px] font-medium text-muted"
                }
              >
                {game.paid ? `До ${game.rule.cap} вуб. / 24 ч` : "Личный рекорд · без выплат"}
              </span>
            </span>
          </button>
        ))}
      </div>
      <div className="mt-4 rounded-2xl border border-line bg-subtle p-4">
        <p className="text-xs font-medium">Как работают награды</p>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Прилавок — до 60, змейка — до 36, сапёр — до 40 вублей за последние 24 часа. У каждой игры
          свой предел. После его достижения можно играть дальше. Новые головоломки тренируют навыки
          и не меняют баланс.
        </p>
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
    try {
      localStorage.setItem(KEY, JSON.stringify(save));
    } catch {
      /* gameplay continues when storage is full */
    }
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
    const raw =
      node instanceof Element ? node.closest("[data-cell]")?.getAttribute("data-cell") : null;
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
      .filter(
        (row): row is { cell: Item; index: number } =>
          isItem(row.cell) && row.cell.k === order.k && row.cell.lv === order.lv,
      )
      .slice(0, order.n);
    if (hits.length < order.n) return;
    const taken = hits.map((hit) => ({ index: hit.index, cell: hit.cell }));
    const cells = save.cells.slice();
    for (const hit of taken) cells[hit.index] = null;
    commit({ ...save, cells });
    setPicked(null);
    setBusy(true);
    try {
      if (purse && purse.today + order.pay > purse.cap) {
        setSave((current) => ({
          ...current,
          orders: current.orders.map((item) =>
            item.id === order.id ? makeOrder(current.next) : item,
          ),
          next: current.next + 1,
        }));
        toast("Заказ готов. Лимит наград исчерпан — играем без начисления.");
        return;
      }
      const next = await claimMergePayout({ data: { amount: order.pay, ticket: order.ticket } });
      setPurse(next);
      if (!next.credited && next.receipt !== "duplicate") {
        restore(taken);
        toast("Этот заказ уже сдан");
        return;
      }
      setSave((current) => ({
        ...current,
        orders: current.orders.map((item) =>
          item.id === order.id ? makeOrder(current.next) : item,
        ),
        next: current.next + 1,
      }));
      toast(next.receipt === "duplicate" ? "Заказ уже учтён" : `+${order.pay} вублей`);
    } catch (err) {
      restore(taken);
      toast.error(err instanceof Error ? err.message : "Выплата не прошла");
      void getMergePurse()
        .then(setPurse)
        .catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  const waitMin =
    save.energy >= MAX_E
      ? 0
      : Math.max(1, Math.ceil((REGEN - (Date.now() - save.energyAt)) / 60_000));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-3 pt-3">
        <button
          type="button"
          className="press inline-flex size-10 items-center justify-center rounded-2xl text-muted"
          aria-label="К списку игр"
          onClick={onBack}
        >
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
            <div
              className="h-full bg-accent"
              style={{ width: `${(save.energy / MAX_E) * 100}%` }}
            />
          </div>
        </div>
      </div>
      <div className="mt-2 flex gap-2 overflow-x-auto px-3 pb-1">
        {save.orders.map((order) => {
          const item = glyph({ k: order.k, lv: order.lv });
          const readyCount = have(save.cells, order);
          const ok = readyCount >= order.n && !busy;
          return (
            <div
              key={order.id}
              className="w-48 shrink-0 rounded-2xl border border-line bg-elev p-2"
            >
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
                aria-label={
                  cell && "gen" in cell
                    ? "Мешок, взять вещь"
                    : item
                      ? `${item.name}, уровень ${isItem(cell) ? cell.lv : 1}`
                      : "Пустая клетка"
                }
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
                  if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8)
                    start.moved = true;
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
                {cell && "gen" in cell ? (
                  <Piece src={icon("1f392")} emoji="🎒" label="Мешок" />
                ) : null}
                {item && isItem(cell) ? (
                  <>
                    <Piece src={apple(item.code)} emoji={item.emoji} label={item.name} />
                    <span className="absolute right-1 bottom-0.5 text-xs tabular-nums text-faint">
                      {cell.lv}
                    </span>
                  </>
                ) : null}
              </button>
            );
          })}
        </div>
        <p className="mx-auto mt-3 max-w-md text-xs leading-relaxed text-faint">
          Нажмите мешок, чтобы достать вещь. Нажмите две одинаковые по очереди или перетащите одну
          на другую — получится следующая. Сдайте заказ покупателю. В сутки прилавок платит не
          больше 60 вублей.
        </p>
        <button
          type="button"
          className="press mx-auto mt-3 block h-10 rounded-xl px-3 text-xs text-muted"
          onClick={() => {
            if (!window.confirm("Собрать стол заново? Вубли, которые уже пришли, останутся."))
              return;
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
  return (
    <img
      src={src}
      alt={label}
      className="size-9"
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}
