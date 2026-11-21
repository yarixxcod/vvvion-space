const MODEL_RE = /^[A-Za-z0-9._:/-]+$/;

const KEEP = new Set([
  "model",
  "messages",
  "tools",
  "tool_choice",
  "parallel_tool_calls",
  "temperature",
  "top_p",
  "max_tokens",
  "max_completion_tokens",
  "stop",
  "stream",
  "presence_penalty",
  "frequency_penalty",
  "seed",
  "response_format",
  "reasoning_effort",
]);

export type ChatBuild =
  | { ok: true; model: string; stream: boolean; payload: Record<string, unknown>; promptChars: number }
  | { ok: false; message: string };

function numberOr(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

function promptCharsOf(messages: unknown): number {
  if (!Array.isArray(messages)) return 0;
  return JSON.stringify(messages).length;
}

/** Белый список полей. Системный промпт каталога, память и агент сюда не добавляются. */
export function buildChatPayload(body: unknown, limits: { maxOutputTokens: number }): ChatBuild {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, message: "Body must be a JSON object." };
  }
  const raw = body as Record<string, unknown>;
  const model = typeof raw.model === "string" ? raw.model.trim() : "";
  if (!model || model.length > 120 || !MODEL_RE.test(model)) {
    return { ok: false, message: "model is missing or not a catalog id." };
  }
  if (!Array.isArray(raw.messages)) return { ok: false, message: "messages must be an array." };
  let max = Math.min(4096, limits.maxOutputTokens);
  const fromCompletion = numberOr(raw.max_completion_tokens);
  const fromTokens = numberOr(raw.max_tokens);
  if (fromCompletion !== undefined) max = fromCompletion;
  if (fromTokens !== undefined) max = fromTokens;
  if (!Number.isFinite(max) || max < 1) return { ok: false, message: "max_tokens must be a positive number." };
  max = Math.min(Math.floor(max), limits.maxOutputTokens);
  const stream = raw.stream === true;
  const payload: Record<string, unknown> = { model, messages: raw.messages, max_tokens: max, stream };
  if (stream) payload.stream_options = { include_usage: true };
  for (const key of KEEP) {
    if (key === "model" || key === "messages" || key === "max_tokens" || key === "max_completion_tokens" || key === "stream") continue;
    if (!(key in raw)) continue;
    payload[key] = raw[key];
  }
  if ("tools" in payload && payload.tools != null && !Array.isArray(payload.tools)) {
    return { ok: false, message: "tools must be an array." };
  }
  if ("temperature" in payload && numberOr(payload.temperature) === undefined) delete payload.temperature;
  if ("top_p" in payload && numberOr(payload.top_p) === undefined) delete payload.top_p;
  return { ok: true, model, stream, payload, promptChars: promptCharsOf(raw.messages) };
}

export function normalizeChatCompletion(raw: unknown, model: string): Record<string, unknown> {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const choices = Array.isArray(row.choices) ? row.choices : [];
  const usage = row.usage && typeof row.usage === "object" ? (row.usage as Record<string, unknown>) : {};
  const prompt = Number(usage.prompt_tokens ?? 0) || 0;
  const completion = Number(usage.completion_tokens ?? 0) || 0;
  return {
    id: typeof row.id === "string" && row.id ? row.id : `chatcmpl_${Math.random().toString(36).slice(2, 12)}`,
    object: "chat.completion",
    created: typeof row.created === "number" ? row.created : Math.floor(Date.now() / 1000),
    model,
    choices: choices.length
      ? choices
      : [{ index: 0, message: { role: "assistant", content: "" }, finish_reason: "stop" }],
    usage: {
      prompt_tokens: prompt,
      completion_tokens: completion,
      total_tokens: Number(usage.total_tokens ?? prompt + completion) || prompt + completion,
    },
  };
}

export function usageOf(raw: unknown, fallbackText: string, promptChars: number): { prompt: number; completion: number; estimated: boolean } {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const usage = row.usage && typeof row.usage === "object" ? (row.usage as Record<string, unknown>) : null;
  const prompt = Number(usage?.prompt_tokens ?? usage?.input_tokens);
  const completion = Number(usage?.completion_tokens ?? usage?.output_tokens);
  if (Number.isFinite(prompt) || Number.isFinite(completion)) {
    return {
      prompt: Number.isFinite(prompt) ? prompt : Math.ceil(promptChars / 4),
      completion: Number.isFinite(completion) ? completion : Math.ceil(fallbackText.length / 4),
      estimated: !Number.isFinite(prompt) || !Number.isFinite(completion),
    };
  }
  return { prompt: Math.ceil(promptChars / 4), completion: Math.ceil(fallbackText.length / 4), estimated: true };
}

export function textOfCompletion(raw: unknown): string {
  const row = raw && typeof raw === "object" ? (raw as { choices?: { message?: { content?: unknown } }[] }) : {};
  const content = row.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : "";
}
