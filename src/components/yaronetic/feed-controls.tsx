import { useState } from "react";
import { Search, SlidersHorizontal, Plus, X } from "lucide-react";
import { EMPTY_FEED_QUERY, type FeedQuery } from "@/lib/social/feed-query";
export function FeedControls({
  value,
  onChange,
  onWrite,
  loading = false,
}: {
  value: FeedQuery;
  onChange: (value: FeedQuery) => void;
  onWrite: () => void;
  loading?: boolean;
}) {
  const [filters, setFilters] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const change = (patch: Partial<FeedQuery>) => onChange({ ...value, ...patch, offset: 0 });
  const active = Boolean(value.after || value.before || value.minLikes || value.likedOnly);
  function dates(a: string, b: string) {
    setFrom(a);
    setTo(b);
    const start = a ? new Date(a + "T00:00:00") : null;
    const end = b ? new Date(b + "T00:00:00") : null;
    if (end) end.setDate(end.getDate() + 1);
    if (start && end && start >= end) return;
    change({ after: start?.toISOString() || "", before: end?.toISOString() || "" });
  }
  return (
    <div className="feed-controls mx-auto w-full max-w-3xl space-y-2 p-3 sm:px-5">
      <div className="flex min-w-0 items-center gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl border border-line bg-elev px-3">
          <Search className="size-4 shrink-0 text-muted" />
          <input
            type="search"
            aria-label="Поиск по ленте"
            placeholder="Поиск или #тег"
            value={value.query}
            onChange={(e) => change({ query: e.target.value })}
            className="h-11 w-full min-w-0 bg-transparent text-base outline-none placeholder:text-faint"
          />
        </label>
        <button
          id="feed-write"
          type="button"
          onClick={onWrite}
          className="press inline-flex h-11 shrink-0 items-center gap-2 rounded-2xl bg-accent px-3 font-medium text-accent-fg sm:px-4"
          aria-label="Написать пост"
        >
          <Plus className="size-5" />
          <span className="hidden sm:inline">Написать пост</span>
        </button>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto" aria-label="Сортировка ленты">
          {(
            [
              ["newest", "Новые"],
              ["likes", "Популярные"],
              ["replies", "Обсуждаемые"],
            ] as const
          ).map(([sort, label]) => (
            <button
              type="button"
              key={sort}
              aria-pressed={value.sort === sort}
              onClick={() => change({ sort })}
              className={`press min-h-10 shrink-0 rounded-full px-3 text-xs sm:text-sm ${value.sort === sort ? "bg-subtle text-fg" : "text-muted"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setFilters(!filters)}
          aria-expanded={filters}
          aria-controls="feed-filter-panel"
          aria-label="Фильтры ленты"
          className={`press inline-flex min-h-11 shrink-0 items-center gap-1 rounded-xl px-2 text-sm ${active ? "text-accent" : "text-muted"}`}
        >
          <SlidersHorizontal className="size-4" />
          {active ? <span className="size-1.5 rounded-full bg-accent" /> : null}
        </button>
      </div>
      {filters ? (
        <div id="feed-filter-panel" className="rounded-2xl border border-line bg-elev p-3">
          <div className="grid min-w-0 grid-cols-2 gap-3">
            <label className="min-w-0 text-xs text-muted">
              С даты
              <input
                aria-label="С даты"
                type="date"
                value={from}
                max={to || undefined}
                onChange={(e) => dates(e.target.value, to)}
                className="field mt-1 block min-w-0 w-full max-w-full text-sm"
              />
            </label>
            <label className="min-w-0 text-xs text-muted">
              По дату
              <input
                aria-label="По дату"
                type="date"
                value={to}
                min={from || undefined}
                onChange={(e) => dates(from, e.target.value)}
                className="field mt-1 block min-w-0 w-full max-w-full text-sm"
              />
            </label>
            <label className="text-xs text-muted">
              Минимум лайков
              <select
                aria-label="Минимум лайков"
                value={value.minLikes}
                onChange={(e) => change({ minLikes: Number(e.target.value) })}
                className="field mt-1 text-sm"
              >
                {[0, 1, 5, 10, 25, 100].map((n) => (
                  <option key={n} value={n}>
                    {n === 0 ? "Без ограничений" : n + "+"}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-muted">
              Порядок
              <select
                aria-label="Порядок записей"
                value={value.sort}
                onChange={(e) => change({ sort: e.target.value as FeedQuery["sort"] })}
                className="field mt-1 text-sm"
              >
                <option value="newest">Сначала новые</option>
                <option value="oldest">Сначала старые</option>
                <option value="likes">Больше лайков</option>
                <option value="replies">Больше ответов</option>
              </select>
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={value.likedOnly}
                onChange={(e) => change({ likedOnly: e.target.checked })}
              />
              Мне понравилось
            </label>
            <button
              type="button"
              onClick={() => {
                setFrom("");
                setTo("");
                onChange({ ...EMPTY_FEED_QUERY });
              }}
              className="press inline-flex min-h-11 items-center gap-1 px-2 text-xs text-muted"
            >
              <X className="size-3.5" />
              Сбросить всё
            </button>
          </div>
        </div>
      ) : null}
      {loading ? (
        <p role="status" className="text-xs text-muted">
          Обновляем ленту…
        </p>
      ) : null}
    </div>
  );
}
