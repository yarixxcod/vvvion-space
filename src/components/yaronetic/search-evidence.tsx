import { useEffect, useState } from "react";
import {
  ChevronDown,
  ExternalLink,
  Globe2,
  LoaderCircle,
  Search,
  TriangleAlert,
} from "lucide-react";
import type { Source } from "@/lib/ai/types";
import type { SearchSummary } from "@/lib/ai/search-types";
import { httpUrl } from "@/lib/ai/search-rank";

const labels = {
  duck: "DuckDuckGo",
  tinyfish: "TinyFish",
  freeserp: "FreeSERP",
  wikipedia: "Wikipedia",
};
export function SearchEvidence({
  sources = [],
  summary,
  pending,
  failed,
}: {
  sources?: Source[];
  summary?: SearchSummary;
  pending: boolean;
  failed?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const loading = pending && !summary && !sources.length;
  useEffect(() => {
    if (!loading) return;
    setSeconds(0);
    const start = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [loading]);
  const safe = sources.flatMap((source) => {
    const url = httpUrl(source.url);
    return url ? [{ ...source, url }] : [];
  });
  const fallback = summary && safe.length > 0 && !summary.used.includes(summary.requested);
  const title = loading
    ? "Поиск и подготовка ответа…"
    : safe.length
      ? `Источники · ${safe.length}`
      : summary?.status === "unavailable"
        ? "Поиск временно недоступен"
        : summary
          ? "Подходящих источников не найдено"
          : failed
            ? "Поиск прерван"
            : "Источники не получены";
  return (
    <section
      aria-label="Поиск в интернете"
      className="my-3 min-w-0 overflow-hidden rounded-2xl border border-line bg-subtle/60"
    >
      <button
        type="button"
        aria-expanded={open}
        disabled={!safe.length && !summary}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-12 w-full min-w-0 items-center gap-3 px-3 py-2.5 text-left disabled:opacity-100 hover:bg-elev"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-elev text-fg">
          {loading ? (
            <LoaderCircle className="size-4 motion-safe:animate-spin" />
          ) : safe.length ? (
            <Globe2 className="size-4" />
          ) : (
            <TriangleAlert className="size-4 text-muted" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span role="status" className="block text-sm font-medium text-fg">
            {title}
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted">
            {loading
              ? "Источники появятся здесь"
              : summary?.used.length
                ? summary.used.map((engine) => labels[engine]).join(" · ") +
                  (fallback ? " · резерв" : "")
                : safe.length
                ? "Источники в ответе"
                : "Ответ не подтверждён веб-источниками"}
          </span>
        </span>
        {loading ? (
          <span className="text-xs tabular-nums text-faint">{seconds} с</span>
        ) : summary ? (
          <span className="shrink-0 text-xs tabular-nums text-faint">
            {summary.cached ? "кэш" : `${(summary.durationMs / 1000).toFixed(1)} с`}
          </span>
        ) : null}
        {safe.length || summary ? (
          <ChevronDown
            className={`size-4 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}
          />
        ) : null}
      </button>
      {!open && safe.length > 0 ? (
        <div
          className="flex min-w-0 gap-2 overflow-hidden px-3 pb-3"
          aria-label="Домены источников"
        >
          {safe.slice(0, 3).map((source, index) => (
            <a
              key={source.url}
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-9 min-w-0 items-center gap-1.5 rounded-lg border border-line bg-elev px-2 text-xs text-muted hover:text-fg"
            >
              <span className="text-fg">{index + 1}</span>
              <span className="truncate">{new URL(source.url).hostname.replace(/^www\./, "")}</span>
            </a>
          ))}
        </div>
      ) : null}
      {open ? (
        <div className="border-t border-line p-3">
          {summary?.query ? (
            <p className="mb-3 flex items-start gap-2 break-words text-xs text-muted">
              <Search className="mt-0.5 size-3 shrink-0" />
              <span className="min-w-0">{summary.query}</span>
            </p>
          ) : null}
          {summary?.requested === "tinyfish" &&
          summary.attempts.some(
            (attempt) => attempt.engine === "tinyfish" && attempt.status === "unavailable",
          ) ? (
            <p className="mb-3 text-xs text-muted">
              TinyFish не подключён. Поиск использует доступные резервные движки.
            </p>
          ) : null}
          <div className="grid min-w-0 gap-2 sm:grid-cols-2">
            {safe.map((source, index) => (
              <a
                key={source.url}
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group min-w-0 rounded-xl border border-line bg-elev p-3 transition-colors hover:border-faint focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <span className="flex min-w-0 items-center gap-2 text-xs text-muted">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-subtle text-fg">
                    {index + 1}
                  </span>
                  <span className="truncate">
                    {new URL(source.url).hostname.replace(/^www\./, "")}
                  </span>
                  <ExternalLink className="ml-auto size-3 shrink-0" />
                </span>
                <span className="mt-2 line-clamp-2 block text-sm font-medium text-fg">
                  {source.title}
                </span>
                {source.snippet ? (
                  <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-muted">
                    {source.snippet}
                  </span>
                ) : null}
                {source.publishedAt && Number.isFinite(Date.parse(source.publishedAt)) ? (
                  <time className="mt-2 block text-xs text-faint" dateTime={source.publishedAt}>
                    {new Date(source.publishedAt).toLocaleDateString("ru-RU")}
                  </time>
                ) : null}
              </a>
            ))}
          </div>
          {!safe.length ? (
            <p className="text-xs leading-relaxed text-muted">
              Попробуйте уточнить название, место или дату. Для актуальных фактов потребуется
              повторная проверка.
            </p>
          ) : (
            <p className="mt-3 text-xs text-faint">
              Поиск по заголовкам и фрагментам страниц. Откройте источник для проверки деталей.
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}
