import { callChat, builtinTargets, loadCatalog } from "@/lib/ai/proxy.server";
import { failoverChat } from "@/lib/api/failover";
import { chatModelAllowed } from "@/lib/api/models.server";

export type UpstreamResult =
  | { ok: true; response: Response }
  | { ok: false; status: number; code: string; message: string };

/** Шлюз без системного промпта каталога: в апстрим уходит только тело клиента. */
export async function runUpstream(model: string, payload: Record<string, unknown>, signal: AbortSignal): Promise<UpstreamResult> {
  if (!(await chatModelAllowed(model))) {
    return { ok: false, status: 404, code: "model_not_found", message: "That model is not available." };
  }
  const catalog = await loadCatalog(model);
  const targets = builtinTargets(catalog);
  if (targets instanceof Response) {
    return { ok: false, status: 502, code: "upstream_error", message: "This model is not available." };
  }
  const result = await failoverChat(targets, payload, callChat, signal);
  if (!result.ok) {
    const status = result.status === 429 ? 429 : result.status === 504 ? 504 : 502;
    const code = status === 429 ? "rate_limit_exceeded" : status === 504 ? "upstream_timeout" : "upstream_error";
    return { ok: false, status, code, message: result.message };
  }
  return { ok: true, response: result.response };
}
