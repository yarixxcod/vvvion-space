import { probeChatResponse, providerSlotWait, type ChatTarget } from "../ai/provider-router.ts";
import { publicUpstream } from "./errors.ts";

export type SendChat = (
  url: string,
  headers: Headers,
  body: Record<string, unknown>,
  signal: AbortSignal,
  secret: string,
) => Promise<{ failed: boolean; response: Response }>;

export type FailoverResult =
  | { ok: true; response: Response; secret: string }
  | { ok: false; status: number; message: string };

/** Тот же порядок, что в чате: слот за слотом, инструменты клиента не переписываются. Молчащий провайдер не съедает остальных. */
export async function failoverChat(
  targets: ChatTarget[],
  payload: Record<string, unknown>,
  send: SendChat,
  signal: AbortSignal,
  timeoutMs = 25_000,
): Promise<FailoverResult> {
  if (signal.aborted) return { ok: false, status: 504, message: "The model timed out." };
  const started = Date.now();
  const long = payload.tools != null || (Array.isArray(payload.messages) && payload.messages.some((message) => {
    if (!message || typeof message !== "object") return false;
    const row = message as { role?: unknown; tool_calls?: unknown };
    return row.role === "tool" || row.tool_calls != null;
  }));
  let lastStatus = 502;
  let lastMessage = "The model returned an error.";
  for (let index = 0; index < targets.length; index += 1) {
    if (signal.aborted) return { ok: false, status: 504, message: "The model timed out." };
    const target = targets[index];
    const waitMs = providerSlotWait({
      timeoutMs,
      long,
      ahead: targets.length - index,
      elapsedMs: Date.now() - started,
    });
    if (waitMs <= 0) break;
    const slot = new AbortController();
    const timer = setTimeout(() => slot.abort(), waitMs);
    const combined = AbortSignal.any([signal, slot.signal]);
    const body = { ...payload, model: target.model || payload.model };
    try {
      const result = await send(target.url, target.headers, body, combined, target.secret);
      if (result.failed) {
        lastStatus = result.response.status || 502;
        const text = await result.response.clone().text().catch(() => "");
        lastMessage = publicUpstream(lastStatus, text, target.secret);
        continue;
      }
      try {
        const response = await probeChatResponse(result.response, combined);
        return { ok: true, response, secret: target.secret };
      } catch {
        lastStatus = 502;
        lastMessage = "The model returned an error.";
      }
    } catch {
      if (signal.aborted) return { ok: false, status: 504, message: "The model timed out." };
      lastStatus = slot.signal.aborted ? 504 : 502;
      lastMessage = slot.signal.aborted ? "The model timed out." : "The model returned an error.";
    } finally {
      clearTimeout(timer);
    }
  }
  const status = lastStatus === 429 ? 429 : lastStatus === 504 || lastStatus === 408 ? 504 : 502;
  return { ok: false, status, message: lastMessage };
}