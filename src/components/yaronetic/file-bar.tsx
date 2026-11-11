import { ArrowDown, ArrowUp } from "lucide-react";
import type { SortDir, SortKey } from "@/lib/files/order";
import { cn } from "@/lib/utils";

const KEYS: { key: SortKey; label: string }[] = [
  { key: "date", label: "Дата" },
  { key: "size", label: "Размер" },
  { key: "ext", label: "Тип" },
  { key: "name", label: "Имя" },
];

function dirLabel(key: SortKey, dir: SortDir): string {
  if (key === "date") return dir === "desc" ? "Сначала новые" : "Сначала старые";
  if (key === "size") return dir === "desc" ? "Сначала большие" : "Сначала маленькие";
  return dir === "asc" ? "А — Я" : "Я — А";
}

export function FileBar({
  query,
  sort,
  dir,
  onQuery,
  onSort,
  onDir,
}: {
  query: string;
  sort: SortKey;
  dir: SortDir;
  onQuery: (value: string) => void;
  onSort: (value: SortKey) => void;
  onDir: () => void;
}) {
  return (
    <div className="mt-3">
      <input
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        placeholder="Найти файл"
        className="field h-10 w-full rounded-xl text-sm"
        aria-label="Найти файл"
      />
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {KEYS.map((item) => (
          <button
            key={item.key}
            type="button"
            aria-pressed={sort === item.key}
            className={cn("press h-8 rounded-full px-3 text-xs", sort === item.key ? "bg-accent text-accent-fg" : "border border-line text-muted")}
            onClick={() => onSort(item.key)}
          >
            {item.label}
          </button>
        ))}
        <button type="button" className="press inline-flex h-8 items-center gap-1 rounded-full border border-line px-3 text-xs text-muted" onClick={onDir}>
          {dir === "asc" ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />}
          {dirLabel(sort, dir)}
        </button>
      </div>
    </div>
  );
}
