import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronLeft,
  Flame,
  Gem,
  Heart,
  Leaf,
  Moon,
  Music,
  RotateCw,
  Sparkles,
  Sun,
  Trophy,
} from "lucide-react";
import {
  moveTiles,
  newLights,
  shuffledPairs,
  spawnTile,
  tilesOver,
  toggleLights,
  type MoveDirection,
} from "@/lib/games/puzzles";
const SYMBOLS = [Gem, Heart, Leaf, Moon, Music, Sparkles, Sun, Flame];
function Shell({
  title,
  help,
  onBack,
  onRestart,
  children,
  score,
}: {
  title: string;
  help: string;
  onBack: () => void;
  onRestart: () => void;
  children: ReactNode;
  score: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 px-3 pt-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="К списку игр"
          className="press grid size-11 shrink-0 place-items-center rounded-2xl text-muted"
        >
          <ChevronLeft className="size-4" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="font-serif text-2xl">{title}</h2>
          <p className="text-xs text-muted">Тренировка · без выплат</p>
        </div>
        <button
          type="button"
          onClick={onRestart}
          className="press inline-flex min-h-11 items-center gap-1 rounded-xl border border-line px-3 text-xs"
        >
          <RotateCw className="size-3.5" />
          Новая
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-md">
          <p className="mb-3 text-sm leading-relaxed text-muted">{help}</p>
          <div className="mb-4 flex items-center justify-between rounded-2xl border border-line bg-subtle px-4 py-3 text-sm tabular-nums">
            {score}
          </div>
          {children}
          <p className="mt-4 text-center text-xs text-faint">
            Игра бесплатная. Баланс вублей не меняется. Рекорд хранится на этом устройстве.
          </p>
        </div>
      </div>
    </div>
  );
}
function Record({ name, score, lower = false }: { name: string; score: number; lower?: boolean }) {
  const [best, setBest] = useState(0);
  useEffect(() => {
    try {
      const n = Number(localStorage.getItem(`vvvion.game.${name}.best`));
      if (Number.isFinite(n) && n >= 0) setBest(n);
    } catch {}
  }, [name]);
  useEffect(() => {
    if (score > 0 && (!best || (lower ? score < best : score > best))) {
      setBest(score);
      try {
        localStorage.setItem(`vvvion.game.${name}.best`, String(score));
      } catch {}
    }
  }, [score, best, lower, name]);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      <Trophy className="size-3.5" />
      Рекорд {best || "—"}
    </span>
  );
}
const INITIAL = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
export function TilesGame({ onBack }: { onBack: () => void }) {
  const [game, setGame] = useState({ board: INITIAL, score: 0 });
  const touch = useRef<{ x: number; y: number } | null>(null);
  const move = useCallback(
    (direction: MoveDirection) =>
      setGame((current) => {
        const next = moveTiles(current.board, direction);
        return next.changed
          ? { board: spawnTile(next.board), score: current.score + next.score }
          : current;
      }),
    [],
  );
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        e.altKey ||
        e.ctrlKey ||
        e.metaKey ||
        /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement)?.tagName)
      )
        return;
      const d = (
        { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" } as const
      )[e.key as "ArrowUp"];
      if (d) {
        e.preventDefault();
        move(d);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [move]);
  const over = tilesOver(game.board),
    won = game.board.some((n) => n >= 2048);
  return (
    <Shell
      title="2048 · Орбита"
      help="Соединяйте одинаковые числа и соберите 2048. Свайп по полю, стрелки на клавиатуре или кнопки снизу."
      onBack={onBack}
      onRestart={() => setGame({ board: INITIAL.slice(), score: 0 })}
      score={
        <>
          <span>
            Очки <strong>{game.score}</strong>
          </span>
          <Record name="tiles" score={game.score} />
        </>
      }
    >
      <div
        data-game-board="tiles"
        className="puzzle-board grid grid-cols-4 gap-2 rounded-3xl border border-line bg-subtle p-2"
        style={{ touchAction: "none" }}
        onPointerDown={(e) => {
          touch.current = { x: e.clientX, y: e.clientY };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerUp={(e) => {
          const p = touch.current;
          touch.current = null;
          if (!p) return;
          const x = e.clientX - p.x,
            y = e.clientY - p.y;
          if (Math.max(Math.abs(x), Math.abs(y)) >= 18)
            move(Math.abs(x) > Math.abs(y) ? (x > 0 ? "right" : "left") : y > 0 ? "down" : "up");
        }}
        onPointerCancel={() => {
          touch.current = null;
        }}
        aria-label="Поле 2048"
      >
        {game.board.map((n, i) => (
          <div
            key={i}
            className="tile-number grid aspect-square min-w-0 place-items-center rounded-2xl font-semibold tabular-nums"
            data-level={n ? Math.min(11, Math.log2(n)) : 0}
            style={{ fontSize: n >= 1024 ? "clamp(16px,5vw,25px)" : "clamp(22px,7vw,34px)" }}
          >
            {n || ""}
          </div>
        ))}
      </div>
      <p className="mt-3 min-h-6 text-center text-sm" role="status">
        {over
          ? "Ходов больше нет. Попробуем ещё?"
          : won
            ? "2048 собрана! Можно продолжить игру."
            : ""}
      </p>
      <div className="mt-2 grid grid-cols-4 gap-2">
        {(
          [
            ["left", ArrowLeft, "Влево"],
            ["up", ArrowUp, "Вверх"],
            ["down", ArrowDown, "Вниз"],
            ["right", ArrowRight, "Вправо"],
          ] as const
        ).map(([d, Icon, label]) => (
          <button
            key={d}
            type="button"
            onClick={() => move(d)}
            disabled={over}
            aria-label={label}
            className="press grid min-h-12 place-items-center rounded-2xl border border-line bg-elev"
          >
            <Icon className="size-5" />
          </button>
        ))}
      </div>
    </Shell>
  );
}
export function MemoryGame({ onBack }: { onBack: () => void }) {
  const [cards, setCards] = useState(() => Array.from({ length: 16 }, (_, i) => i % 8));
  const [open, setOpen] = useState<number[]>([]);
  const [matched, setMatched] = useState<number[]>([]);
  const [moves, setMoves] = useState(0);
  const lock = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setCards(shuffledPairs());
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  const restart = () => {
    if (timer.current) clearTimeout(timer.current);
    lock.current = false;
    setCards(shuffledPairs());
    setOpen([]);
    setMatched([]);
    setMoves(0);
  };
  function pick(i: number) {
    if (lock.current || open.includes(i) || matched.includes(cards[i])) return;
    if (!open.length) {
      setOpen([i]);
      return;
    }
    const prev = open[0];
    setMoves((n) => n + 1);
    setOpen([prev, i]);
    if (cards[prev] === cards[i]) {
      setMatched((m) => [...m, cards[i]]);
      setOpen([]);
    } else {
      lock.current = true;
      timer.current = setTimeout(() => {
        setOpen([]);
        lock.current = false;
      }, 750);
    }
  }
  const won = matched.length === 8;
  return (
    <Shell
      title="Созвездия памяти"
      help="Найдите восемь пар символов. Открывайте по две карточки и запоминайте их расположение."
      onBack={onBack}
      onRestart={restart}
      score={
        <>
          <span>
            Пары {matched.length}/8 · Ходы {moves}
          </span>
          <Record name="memory" score={won ? moves : 0} lower />
        </>
      }
    >
      <div data-game-board="memory" className="grid grid-cols-4 gap-2">
        {cards.map((symbol, i) => {
          const face = open.includes(i) || matched.includes(symbol),
            Icon = SYMBOLS[symbol];
          return (
            <button
              key={i}
              type="button"
              onClick={() => pick(i)}
              disabled={matched.includes(symbol)}
              aria-label={`Карта ${i + 1}, ${face ? `символ ${symbol + 1}` : "закрыта"}`}
              aria-pressed={face}
              className={`memory-card press grid aspect-square min-w-0 place-items-center rounded-2xl border ${face ? "border-accent/50 bg-accent/10 text-fg" : "border-line bg-subtle text-muted"}`}
            >
              {face ? <Icon className="size-8" /> : <Sparkles className="size-5 opacity-40" />}
            </button>
          );
        })}
      </div>
      <p className="mt-4 text-center text-sm" role="status">
        {won ? `Все пары найдены за ${moves} ходов!` : ""}
      </p>
    </Shell>
  );
}
export function LightsGame({ onBack }: { onBack: () => void }) {
  const [board, setBoard] = useState(() => toggleLights(Array(25).fill(false), 12));
  const [moves, setMoves] = useState(0);
  useEffect(() => {
    setBoard(newLights());
  }, []);
  const won = !board.some(Boolean);
  return (
    <Shell
      title="Погаси звёзды"
      help="Погасите все огни. Нажатие переключает выбранную клетку и её соседей сверху, снизу, слева и справа. Каждое поле решаемо."
      onBack={onBack}
      onRestart={() => {
        setBoard(newLights());
        setMoves(0);
      }}
      score={
        <>
          <span>
            Ходы {moves} · Горит {board.filter(Boolean).length}
          </span>
          <Record name="lights" score={won ? moves : 0} lower />
        </>
      }
    >
      <div
        data-game-board="lights"
        className="grid grid-cols-5 gap-2 rounded-3xl border border-line bg-subtle p-3"
      >
        {board.map((on, i) => (
          <button
            key={i}
            type="button"
            aria-label={`Ряд ${Math.floor(i / 5) + 1}, клетка ${(i % 5) + 1}`}
            aria-pressed={on}
            disabled={won}
            className={`light-cell press grid aspect-square min-w-0 place-items-center rounded-xl border ${on ? "is-on" : "border-line bg-elev text-faint"}`}
            onClick={() => {
              setBoard((b) => toggleLights(b, i));
              setMoves((n) => n + 1);
            }}
          >
            <Sun className="size-5" />
          </button>
        ))}
      </div>
      <p className="mt-4 text-center text-sm" role="status">
        {won ? `Все звёзды погашены за ${moves} ходов!` : ""}
      </p>
    </Shell>
  );
}
