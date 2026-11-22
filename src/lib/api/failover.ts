import { probeChatResponse, type ChatTarget } from "../ai/provider-router.ts";
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

/** Резервный провайдер только до первого пригодного ответа. Инструменты не переписываются. */
export async function failoverChat(
  targets: ChatTarget[],
  payload: Record<string, unknown>,
  send: SendChat,
  signal: AbortSignal,
): Promise<FailoverResult> {
  if (signal.aborted) return { ok: false, status: 504, message: "The model timed out." };
  let lastStatus = 502;
  let lastMessage = "The model returned an error.";
  for (const target of targets) {
    if (signal.aborted) return { ok: false, status: 504, message: "The model timed out." };
    const body = { ...payload, model: target.model || payload.model };
    try {
      const result = await send(target.url, target.headers, body, signal, target.secret);
      if (result.failed) {
        lastStatus = result.response.status || 502;
        const text = await result.response.clone().text().catch(() => "");
        lastMessage = publicUpstream(lastStatus, text, target.secret);
        continue;
      }
      try {
        const response = await probeChatResponse(result.response, signal);
        return { ok: true, response, secret: target.secret };
      } catch {
        lastStatus = 502;
        lastMessage = "The model returned an error.";
      }
    } catch {
      if (signal.aborted) return { ok: false, status: 504, message: "The model timed out." };
      lastStatus = 502;
      lastMessage = "The model returned an error.";
    }
  }
  const status = lastStatus === 429 ? 429 : lastStatus === 504 || lastStatus === 408 ? 504 : 502;
  return { ok: false, status, message: lastMessage };
}
