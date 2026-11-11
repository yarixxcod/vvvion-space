import { useEffect, useRef, useState } from "react";
import { ChevronLeft, Flag } from "lucide-react";
import { toast } from "sonner";
import { claimArcade, getArcadePurse, type MergePurse } from "@/lib/social/merge";
import { blankField, layMines, mineWon, revealMine, toggleFlag, type MineCell } from "@/lib/games/mine";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptic";

const W = 9;
const MINES = 10;

function code(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `m${[...bytes].map((byte) => (byte % 36).toString(36)).join("")}`.slice(0, 16);
}

export function MineGame({ onBack }: { onBack: () => void }) {
  const [cells, setCells] = useState<MineCell[]>(() => blankField(W * W));
  const [armed, setArmed] = useState(false);
  const [flagMode, setFlagMode] = useState(false);
  const [boom, setBoom] = useState(false);
  const [purse, setPurse] = useState<MergePurse | null>(null);
  const [ticket, setTicket] = useState(code);
  const hold = useRef(0);
  const held = useRef(false);
  const origin = useRef({ x: 0, y: 0 });

  function clearHold() {
    window.clearTimeout(hold.current);
    hold.current = 0;
  }

  const won = armed && !boom && mineWon(cells);
  const left = cells.filter((cell) => cell.mine && !cell.flag).length;

  useEffect(() => {
    void getArcadePurse({ data: { game: "mine" } })
      .then(setPurse)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!won) return;
    let dead = false;
    void claimArcade({ data: { game: "mine", amount: 8, ticket } })
      .then((next) => {
        if (dead) return;
        setPurse(next);
        if (next.credited) toast("+8 вублей");
      })
      .catch((err: unknown) => {
        if (!dead) toast.error(err instanceof Error ? err.message : "Выплата не прошла");
      });
    return () => {
      dead = true;
    };
  }, [won, ticket]);

  function restart() {
    setCells(blankField(W * W));
    setArmed(false);
    setBoom(false);
    setFlagMode(false);
    setTicket(code());
  }

  function open(index: number) {
    if (boom || won) return;
    const field = armed ? cells : layMines(cells, index, MINES, W);
    const next = revealMine(field, index, W);
    if (!armed) setArmed(true);
    if (next.boom) setBoom(true);
    setCells(next.cells);
  }

  function flag(index: number) {
    if (boom || won) return;
    setCells((current) => toggleFlag(current, index));
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-3 pt-3">
        <button type="button" className="press inline-flex size-10 items-center justify-center rounded-2xl text-muted" aria-label="К списку игр" onClick={onBack}>
          <ChevronLeft className="size-4" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="font-serif text-2xl tracking-tight">Сапёр</h2>
          <p className="text-xs text-faint">
            Мин {left}
            {purse ? ` · сегодня ${purse.today} из ${purse.cap}` : ""}
            {purse ? ` · на карте ${purse.balance}` : ""}
          </p>
        </div>
        <button type="button" className="press h-10 rounded-xl border border-line px-3 text-sm" onClick={restart}>
          Заново
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="mx-auto grid w-full max-w-sm grid-cols-9 gap-1">
          {cells.map((cell, index) => (
            <button
              key={index}
              type="button"
              aria-label={cell.flag ? "Флажок" : cell.open ? String(cell.n || "пусто") : "Клетка"}
              className={cn(
                "press grid aspect-square place-items-center rounded-lg text-sm font-medium tabular-nums",
                cell.open ? "bg-bg text-fg" : "bg-subtle",
                cell.open && cell.mine && "bg-danger text-white",
                cell.n === 1 && "text-accent",
                cell.n === 2 && "text-fg",
                cell.n === 3 && "text-danger",
              )}
              onContextMenu={(event) => {
                event.preventDefault();
                flag(index);
              }}
              onPointerDown={(event) => {
                held.current = false;
                origin.current = { x: event.clientX, y: event.clientY };
                clearHold();
                hold.current = window.setTimeout(() => {
                  hold.current = 0;
                  held.current = true;
                  flag(index);
                  haptic("heavy");
                }, 380);
              }}
              onPointerMove={(event) => {
                if (!hold.current) return;
                const dx = event.clientX - origin.current.x;
                const dy = event.clientY - origin.current.y;
                if (dx * dx + dy * dy > 100) clearHold();
              }}
              onPointerUp={clearHold}
              onPointerCancel={clearHold}
              onPointerLeave={clearHold}
              onClick={() => {
                if (held.current) {
                  held.current = false;
                  return;
                }
                if (flagMode || cell.flag) flag(index);
                else open(index);
              }}
            >
              {cell.flag && !cell.open ? <Flag className="size-3.5" /> : null}
              {cell.open && cell.mine ? "•" : null}
              {cell.open && !cell.mine && cell.n ? cell.n : null}
            </button>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-center gap-2">
          <button
            type="button"
            aria-pressed={flagMode}
            className={cn("press inline-flex h-11 items-center gap-1.5 rounded-2xl border px-3 text-sm", flagMode ? "border-accent bg-accent text-accent-fg" : "border-line")}
            onClick={() => setFlagMode((value) => !value)}
          >
            <Flag className="size-4" />
            Флажок
          </button>
        </div>
        {boom ? <p className="mt-3 text-center text-sm text-muted">Мина. Поле можно начать заново.</p> : null}
        {won ? <p className="mt-3 text-center text-sm">Поле чистое. На карту — 8 вублей, если дневной предел ещё открыт.</p> : null}
        <p className="mt-3 text-center text-xs text-faint">Первый ход безопасный. Удержание ставит флажок. За чистое поле — 8 вублей.</p>
      </div>
    </div>
  );
}
