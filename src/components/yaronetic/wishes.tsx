import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

type Tip = { kicker: string; title: string; text: string };

const FALLBACK: Tip[] = [
  { kicker: "Утро", title: "Одно своё дело", text: "Пусть сегодня получится хотя бы одно дело, которое выбрали вы сами." },
  { kicker: "Пауза", title: "Сначала выдох", text: "Перед следующим вопросом остановитесь на вдох." },
  { kicker: "Вечер", title: "День можно закрыть", text: "Оставьте одну строку на завтра и отложите остальное." },
];

export function WishCarousel({ embedded = false }: { embedded?: boolean }) {
  const [tips, setTips] = useState<Tip[]>(FALLBACK);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    let dead = false;
    void fetch("/api/tips")
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as { items?: Tip[] };
        const next = (data.items ?? []).filter((item) => item?.title && item?.text);
        if (!dead && next.length) setTips(next.slice(0, 5));
      })
      .catch(() => undefined);
    return () => {
      dead = true;
    };
  }, []);

  const item = tips[Math.min(index, tips.length - 1)] ?? FALLBACK[0];

  function go(step: number) {
    setIndex((current) => (current + step + tips.length) % tips.length);
  }

  return (
    <div className={embedded ? "border-t border-line px-4 py-3.5" : "mt-8"} aria-label="Пожелания и советы">
      <div className="flex items-center gap-2">
        <p className="min-w-0 truncate text-xs tracking-wide text-faint uppercase">{item.kicker}</p>
        <p className="ml-auto shrink-0 text-xs tabular-nums text-faint">
          {Math.min(index, tips.length - 1) + 1}/{tips.length}
        </p>
        <div className="flex shrink-0">
          <button type="button" className="press inline-flex size-9 items-center justify-center rounded-xl text-faint" aria-label="Предыдущий совет" onClick={() => go(-1)}>
            <ChevronLeft className="size-5" />
          </button>
          <button type="button" className="press inline-flex size-9 items-center justify-center rounded-xl text-faint" aria-label="Следующий совет" onClick={() => go(1)}>
            <ChevronRight className="size-5" />
          </button>
        </div>
      </div>
      <p className="mt-1.5 text-base font-medium leading-snug">{item.title}</p>
      <p className="mt-1 text-sm leading-relaxed text-muted">{item.text}</p>
    </div>
  );
}
