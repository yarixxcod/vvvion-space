import { getSql } from "@/lib/db";
export type ProviderUsageTag = {
  model: string;
  id: string;
  slot: number;
  host: string;
  upstream: string;
  source: string;
};
const tags = new WeakMap<Headers, ProviderUsageTag>();
export function tagProvider(headers: Headers, tag: ProviderUsageTag) {
  tags.set(headers, tag);
}
/** Count each actual HTTP attempt, including parameter retries. HTTP 2xx is not a complete-answer guarantee. */
export async function measuredProviderFetch(
  headers: Headers,
  send: () => Promise<Response>,
): Promise<Response> {
  const tag = tags.get(headers);
  if (!tag) return send(); // User-owned custom endpoints are outside the shared catalog.
  const started = Date.now();
  let ok = false;
  try {
    const response = await send();
    ok = response.ok;
    return response;
  } finally {
    const elapsed = Math.max(0, Math.min(300_000, Date.now() - started));
    try {
      const sql = await getSql();
      await sql`insert into provider_usage_hourly (bucket,model_name,provider_id,slot,provider_host,upstream_model,source,requests,accepted,errors,elapsed_ms)
        values (date_trunc('hour',now()),${tag.model},${tag.id},${tag.slot},${tag.host},${tag.upstream},${tag.source},1,${ok ? 1 : 0},${ok ? 0 : 1},${elapsed})
        on conflict (bucket,model_name,provider_id,provider_host,upstream_model,source)
        do update set requests=provider_usage_hourly.requests+1,accepted=provider_usage_hourly.accepted+excluded.accepted,
          errors=provider_usage_hourly.errors+excluded.errors,elapsed_ms=provider_usage_hourly.elapsed_ms+excluded.elapsed_ms,slot=excluded.slot`;
    } catch {
      /* Analytics failure must not interrupt an answer. */
    }
  }
}
