import { useEffect, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import { claimArcade, getArcadePurse, type MergePurse } from "@/lib/social/merge";
import { freshSnake, tickSnake, type Dir, type SnakeState } from "@/lib/games/snake";
import { cn } from "@/lib/utils";

const KEYS: Record<string, Dir> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

function code(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `s${[...bytes].map((byte) => (byte % 36).toString(36)).join("")}`.slice(0, 16);
}

export function SnakeGame({ onBack }: { onBack: () => void }) {
  const [state, setState] = useState<SnakeState>(() => freshSnake());
  const [started, setStarted] = useState(false);
  const [purse, setPurse] = useState<MergePurse | null>(null);
  const queued = useRef<Dir | null>(null);
  const tickets = useRef<Record<number, string>>({});
  const point = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    void getArcadePurse({ data: { game: "snake" } })
      .then(setPurse)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const dir = KEYS[event.key];
      if (!dir) return;
      event.preventDefault();
      queued.current = dir;
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!started || state.dead) return;
    const timer = window.setInterval(() => {
      setState((current) => {
        if (current.dead) return current;
        const dir = queued.current ?? current.dir;
        queued.current = null;
        return tickSnake(current, dir);
      });
    }, 150);
    return () => window.clearInterval(timer);
  }, [started, state.dead]);

  useEffect(() => {
    if (!state.apples || state.apples % 3 !== 0) return;
    const mark = state.apples;
    const ticket = (tickets.current[mark] ??= code());
    let dead = false;
    void claimArcade({ data: { game: "snake", amount: 2, ticket } })
      .then((next) => {
        if (dead) return;
        setPurse(next);
        if (next.credited) toast("+2 вубля");
      })
      .catch((err: unknown) => {
        if (!dead) toast.error(err instanceof Error ? err.message : "Выплата не прошла");
      });
    return () => {
      dead = true;
    };
  }, [state.apples]);

  function aim(dir: Dir) {
    queued.current = dir;
  }

  function swipe(x: number, y: number) {
    const from = point.current;
    point.current = null;
    if (!from) return;
    const dx = x - from.x;
    const dy = y - from.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    aim(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up");
  }

  const occupied = new Map(state.body.map((cell, index) => [`${cell.x},${cell.y}`, index]));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-3 pt-3">
        <button type="button" className="press inline-flex size-10 items-center justify-center rounded-2xl text-muted" aria-label="К списку игр" onClick={onBack}>
          <ChevronLeft className="size-4" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="font-serif text-2xl tracking-tight">Змейка</h2>
          <p className="text-xs text-faint">
            Яблок {state.apples}
            {purse ? ` · сегодня ${purse.today} из ${purse.cap}` : ""}
            {purse ? ` · на карте ${purse.balance}` : ""}
          </p>
        </div>
        <button
          type="button"
          className="press h-10 rounded-xl border border-line px-3 text-sm"
          onClick={() => {
            tickets.current = {};
            queued.current = null;
            setStarted(false);
            setState(freshSnake());
          }}
        >
          Заново
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div
          className="mx-auto grid aspect-square w-full max-w-sm gap-px rounded-3xl bg-subtle p-2"
          style={{ gridTemplateColumns: `repeat(${state.w}, minmax(0, 1fr))` }}
          onPointerDown={(event) => {
            point.current = { x: event.clientX, y: event.clientY };
          }}
          onPointerUp={(event) => swipe(event.clientX, event.clientY)}
          onPointerCancel={() => {
            point.current = null;
          }}
        >
          {Array.from({ length: state.w * state.h }, (_, index) => {
            const x = index % state.w;
            const y = Math.floor(index / state.w);
            const at = occupied.get(`${x},${y}`);
            const apple = state.apple.x === x && state.apple.y === y;
            return (
              <span
                key={index}
                className={cn(
                  "aspect-square rounded-[3px]",
                  at === 0 && "bg-accent",
                  at !== undefined && at > 0 && "bg-accent/70",
                  apple && "bg-danger",
                  at === undefined && !apple && "bg-bg/70",
                )}
              />
            );
          })}
        </div>
        {!started ? (
          <button type="button" className="press mx-auto mt-3 block h-11 rounded-2xl bg-accent px-4 text-sm font-medium text-accent-fg" onClick={() => { queued.current = null; setState(freshSnake()); setStarted(true); }}>
            Нажмите, чтобы начать
          </button>
        ) : null}
        {started && state.dead ? <p className="mt-3 text-center text-sm text-muted">Стена или хвост. Можно начать заново.</p> : null}
        <p className="mt-3 text-center text-xs text-faint">Каждые три яблока — 2 вубля. Стрелки, свайп или кнопки.</p>
        <div className="mx-auto mt-3 grid w-44 grid-cols-3 gap-1">
          <span />
          <Pad label="Вверх" onClick={() => aim("up")}>↑</Pad>
          <span />
          <Pad label="Влево" onClick={() => aim("left")}>←</Pad>
          <span />
          <Pad label="Вправо" onClick={() => aim("right")}>→</Pad>
          <span />
          <Pad label="Вниз" onClick={() => aim("down")}>↓</Pad>
        </div>
      </div>
    </div>
  );
}

function Pad({ label, onClick, children }: { label: string; onClick: () => void; children: string }) {
  return (
    <button type="button" aria-label={label} className="press grid h-12 place-items-center rounded-2xl border border-line bg-elev text-lg" onClick={onClick}>
      {children}
    </button>
  );
}
