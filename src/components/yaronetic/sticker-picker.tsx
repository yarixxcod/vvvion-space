import { useState } from "react";
import { Search, X } from "lucide-react";
import {
  STICKER_PACKS,
  isKnownSticker,
  stickerLabel,
  stickerUrl,
  type StickerPackId,
} from "@/lib/stickers";
export function StickerImage({
  code,
  className = "size-32",
}: {
  code: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <span
      role="img"
      aria-label={stickerLabel(code)}
      className={`${className} inline-grid place-items-center rounded-2xl border border-line bg-subtle p-2 text-center text-xs text-fg`}
    >
      {stickerLabel(code)}
    </span>
  ) : (
    <img
      src={stickerUrl(code)}
      alt={stickerLabel(code)}
      loading="lazy"
      decoding="async"
      className={`${className} object-contain`}
      onError={() => setFailed(true)}
    />
  );
}
export function StickerPicker({
  onPick,
  onClose,
  disabled = false,
  ai = false,
}: {
  onPick: (code: string) => void;
  onClose?: () => void;
  disabled?: boolean;
  ai?: boolean;
}) {
  const [pack, setPack] = useState<StickerPackId | "recent">("cosmo");
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<string[]>(() => {
    try {
      const v = JSON.parse(localStorage.getItem("vvvion.stickers.recent") || "[]");
      return Array.isArray(v)
        ? v.filter((c) => typeof c === "string" && isKnownSticker(c)).slice(0, 20)
        : [];
    } catch {
      return [];
    }
  });
  const [replies, setReplies] = useState(() => {
    try {
      return localStorage.getItem("vvvion.stickers.replies") !== "0";
    } catch {
      return true;
    }
  });
  const codes = query.trim()
    ? STICKER_PACKS.flatMap((p) => [...p.codes]).filter((c) =>
        stickerLabel(c).toLocaleLowerCase("ru").includes(query.trim().toLocaleLowerCase("ru")),
      )
    : pack === "recent"
      ? recent
      : STICKER_PACKS.find((p) => p.id === pack)?.codes || [];
  return (
    <section
      className="sticker-picker rounded-2xl border border-line bg-elev p-2 text-fg"
      aria-label="Выбор стикера"
    >
      <div className="flex items-center gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-subtle px-3">
          <Search className="size-4 shrink-0 text-muted" />
          <input
            aria-label="Найти стикер"
            placeholder="Кот, кофе, любовь…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-11 min-w-0 w-full bg-transparent text-sm outline-none"
          />
        </label>
        {onClose ? (
          <button
            type="button"
            className="press grid size-11 shrink-0 place-items-center rounded-xl"
            aria-label="Закрыть стикеры"
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>
      <div className="mt-2 flex gap-1 overflow-x-auto" role="group" aria-label="Наборы стикеров">
        {[{ id: "recent", label: "Недавние" }, ...STICKER_PACKS].map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={pack === p.id && !query}
            className={`press min-h-11 shrink-0 rounded-full px-3 text-xs ${pack === p.id && !query ? "bg-accent text-accent-fg" : "text-muted"}`}
            onClick={() => {
              setPack(p.id as StickerPackId | "recent");
              setQuery("");
            }}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="mt-1 grid max-h-52 grid-cols-[repeat(auto-fill,minmax(72px,1fr))] gap-1 overflow-y-auto overscroll-contain">
        {codes.map((code) => (
          <button
            key={code}
            type="button"
            disabled={disabled}
            aria-label={`Отправить стикер: ${stickerLabel(code)}`}
            title={stickerLabel(code)}
            className="press grid aspect-square min-w-0 place-items-center rounded-xl hover:bg-subtle disabled:opacity-40"
            onClick={() => {
              const next = [code, ...recent.filter((c) => c !== code)].slice(0, 20);
              setRecent(next);
              try {
                localStorage.setItem("vvvion.stickers.recent", JSON.stringify(next));
              } catch {
                /* private mode */
              }
              onPick(code);
            }}
          >
            <StickerImage code={code} className="size-16 max-w-full" />
          </button>
        ))}
      </div>
      {!codes.length ? (
        <p role="status" className="p-4 text-center text-sm text-muted">
          {query ? "Стикеры не найдены" : "Здесь появятся отправленные стикеры"}
        </p>
      ) : null}
      {ai ? (
        <label className="mt-2 flex min-h-11 items-center gap-2 border-t border-line pt-2 text-xs">
          <input
            type="checkbox"
            checked={replies}
            onChange={(e) => {
              setReplies(e.target.checked);
              try {
                localStorage.setItem("vvvion.stickers.replies", e.target.checked ? "1" : "0");
              } catch {
                /* private mode */
              }
            }}
          />
          Стикеры в ответах ИИ, когда уместно
        </label>
      ) : null}
      <p className="mt-1 px-1 text-[10px] text-faint">
        Космокот · VVVion. Классика · OpenMoji, CC BY-SA 4.0.
      </p>
    </section>
  );
}
