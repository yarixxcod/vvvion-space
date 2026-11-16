import {
  sourceSite,
  rankSources,
  searchQuery,
  needsFreshness,
  type WebSource,
} from "./search-rank.ts";
import type { SearchEngine } from "./search-engine";
import type { SearchAttempt, SearchProvider, SearchSummary } from "./search-types";
export type SearchResult = { sources: WebSource[]; summary: SearchSummary };
export class SearchFailure extends Error {
  readonly status: SearchAttempt["status"];
  constructor(status: SearchAttempt["status"]) {
    super(status);
    this.status = status;
  }
}
type FetchEngine = (
  engine: SearchProvider,
  query: string,
  signal: AbortSignal,
) => Promise<WebSource[]>;

/** Bounded hedging, quality-based completion and a small cache of public search results. */
export function createSearchService(
  fetchEngine: FetchEngine,
  options: {
    budgetMs?: number;
    hedgeMs?: number;
    tinyfishReady?: () => boolean;
    now?: () => number;
  } = {},
) {
  const cache = new Map<string, { expires: number; result: SearchResult }>();
  const now = options.now ?? Date.now;
  return async (
    rawQuery: string,
    requested: SearchEngine = "duck",
    parent?: AbortSignal,
  ): Promise<SearchResult> => {
    parent?.throwIfAborted();
    const query = searchQuery(rawQuery);
    const key = `${requested}:${query}`;
    const hit = cache.get(key);
    if (hit && hit.expires > now())
      return {
        sources: hit.result.sources.map((x) => ({ ...x })),
        summary: {
          ...hit.result.summary,
          cached: true,
          attempts: hit.result.summary.attempts.map((x) => ({ ...x })),
        },
      };
    const start = now();
    const attempts: SearchAttempt[] = [];
    let sources: WebSource[] = [];
    const controller = new AbortController();
    let qualityStop = false;
    const budget = setTimeout(() => controller.abort(), options.budgetMs ?? 12000);
    const signal = parent ? AbortSignal.any([parent, controller.signal]) : controller.signal;
    let strongResolve: () => void = () => {};
    const strong = new Promise<void>((resolve) => {
      strongResolve = resolve;
    });
    const enough = () =>
      sources.length >= 4 &&
      new Set(sources.map((source) => sourceSite(source.url))).size >= 2 &&
      sources.filter((source) => source.snippet.length >= 40).length >= 3;
    async function attempt(engine: SearchProvider) {
      const began = now();
      if (engine === "tinyfish" && !options.tinyfishReady?.()) {
        attempts.push({ engine, status: "unavailable", count: 0, ms: 0 });
        return;
      }
      try {
        signal.throwIfAborted();
        const raw = await fetchEngine(engine, query, signal);
        const ranked = rankSources(
          query,
          raw.map((item) => ({ ...item, engine })),
          6,
        );
        sources = rankSources(query, [...sources, ...ranked], 6);
        attempts.push({
          engine,
          status: ranked.length ? "ok" : "empty",
          count: ranked.length,
          ms: now() - began,
        });
        if (enough()) strongResolve();
      } catch (error) {
        attempts.push({
          engine,
          status: qualityStop
            ? "skipped"
            : signal.aborted
              ? "timeout"
              : error instanceof SearchFailure
                ? error.status
                : "error",
          count: 0,
          ms: now() - began,
        });
      }
    }
    try {
      if (query.length >= 2) {
        const primary = attempt(requested);
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          primary,
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, options.hedgeMs ?? 800);
          }),
        ]);
        if (timer) clearTimeout(timer);
        if (!enough()) {
          const backups = (["tinyfish", "freeserp", "duck"] as SearchEngine[]).filter(
            (engine) => engine !== requested,
          );
          const jobs = [primary, ...backups.map((engine) => attempt(engine))];
          await Promise.race([Promise.allSettled(jobs), strong]);
          if (enough() && !signal.aborted) {
            qualityStop = true;
            controller.abort();
          }
          await Promise.allSettled(jobs);
        }
        // Encyclopedic material is a labelled last resort, never evidence for prices/news/current facts.
        if (
          !sources.length &&
          !signal.aborted &&
          !needsFreshness(query) &&
          now() - start < (options.budgetMs ?? 12000) - 1500 &&
          /кто так|что так|истори|биограф|философ|what is|who is/i.test(query)
        )
          await attempt("wikipedia");
      }
      parent?.throwIfAborted();
      const summary: SearchSummary = {
        query,
        requested,
        used: [
          ...new Set(sources.map((x) => x.engine).filter((x): x is SearchProvider => Boolean(x))),
        ],
        status: sources.length
          ? "found"
          : attempts.some((x) => x.status === "empty") || query.length < 2
            ? "empty"
            : "unavailable",
        durationMs: now() - start,
        checkedAt: new Date(now()).toISOString(),
        attempts,
      };
      const result = { sources, summary };
      if (sources.length) {
        if (cache.size >= 128) cache.delete(cache.keys().next().value!);
        cache.set(key, { expires: now() + (needsFreshness(query) ? 15000 : 45000), result });
      }
      return result;
    } finally {
      clearTimeout(budget);
      controller.abort();
    }
  };
}
