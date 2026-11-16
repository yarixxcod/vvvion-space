import type { SearchEngine } from "./search-engine";
export type SearchProvider = SearchEngine | "wikipedia";
export type SearchAttempt = {
  engine: SearchProvider;
  status: "ok" | "empty" | "unavailable" | "blocked" | "timeout" | "error" | "skipped";
  count: number;
  ms: number;
};
export type SearchSummary = {
  query: string;
  requested: SearchEngine;
  used: SearchProvider[];
  status: "found" | "empty" | "unavailable";
  durationMs: number;
  checkedAt: string;
  cached?: boolean;
  attempts: SearchAttempt[];
};

/** Also validates cloud-loaded metadata, rather than trusting arbitrary saved message JSON. */
export function cleanSearchSummary(value: unknown): SearchSummary | undefined {
  if (!value || typeof value !== "object") return;
  const row = value as Partial<SearchSummary>;
  const engines = ["duck", "tinyfish", "freeserp", "wikipedia"];
  if (
    !engines.slice(0, 3).includes(row.requested ?? "") ||
    !["found", "empty", "unavailable"].includes(row.status ?? "")
  )
    return;
  return {
    query: typeof row.query === "string" ? row.query.slice(0, 260) : "",
    requested: row.requested!,
    used: Array.isArray(row.used) ? row.used.filter((x) => engines.includes(x)).slice(0, 4) : [],
    status: row.status!,
    durationMs:
      typeof row.durationMs === "number" && Number.isFinite(row.durationMs)
        ? Math.max(0, Math.min(row.durationMs, 60000))
        : 0,
    checkedAt:
      typeof row.checkedAt === "string" && Number.isFinite(Date.parse(row.checkedAt))
        ? row.checkedAt
        : "",
    cached: row.cached === true,
    attempts: Array.isArray(row.attempts)
      ? row.attempts.slice(0, 4).flatMap((attempt) => {
          if (
            !attempt ||
            !engines.includes(attempt.engine) ||
            !["ok", "empty", "unavailable", "blocked", "timeout", "error", "skipped"].includes(
              attempt.status,
            )
          )
            return [];
          return [
            {
              engine: attempt.engine,
              status: attempt.status,
              count: Number.isFinite(attempt.count) ? Math.max(0, Math.min(attempt.count, 100)) : 0,
              ms: Number.isFinite(attempt.ms) ? Math.max(0, Math.min(attempt.ms, 60000)) : 0,
            },
          ];
        })
      : [],
  };
}
