export type StreamUsage = { prompt: number; completion: number; estimated: boolean; text: string };

/** Дописывает ping, подменяет имя модели и гарантирует data: [DONE]. */
export function decorateOpenAiSse(
  upstream: ReadableStream<Uint8Array>,
  opts: {
    model: string;
    pingMs?: number;
    signal?: AbortSignal;
    promptChars?: number;
    onDone?: (usage: StreamUsage) => void;
  },
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let text = "";
  let prompt = 0;
  let completion = 0;
  let sawUsage = false;
  let sawDone = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  const rewrite = (line: string): string => {
    const trimmed = line.replace(/\r$/, "");
    if (!trimmed.startsWith("data:")) return trimmed;
    const data = trimmed.slice(5).trim();
    if (data === "[DONE]") {
      sawDone = true;
      return "data: [DONE]";
    }
    if (!data) return trimmed;
    try {
      const json = JSON.parse(data) as Record<string, unknown>;
      if (json && typeof json === "object") {
        if (typeof json.model === "string") json.model = opts.model;
        const usage = json.usage;
        if (usage && typeof usage === "object") {
          const box = usage as Record<string, unknown>;
          const p = Number(box.prompt_tokens ?? box.input_tokens);
          const c = Number(box.completion_tokens ?? box.output_tokens);
          if (Number.isFinite(p)) prompt = p;
          if (Number.isFinite(c)) completion = c;
          if (Number.isFinite(p) || Number.isFinite(c)) sawUsage = true;
        }
        const choice = Array.isArray(json.choices) ? (json.choices[0] as { delta?: { content?: unknown }; message?: { content?: unknown } }) : undefined;
        const piece = choice?.delta?.content ?? choice?.message?.content;
        if (typeof piece === "string") text += piece;
        return `data: ${JSON.stringify(json)}`;
      }
    } catch {
      /* оставляем строку как есть */
    }
    return trimmed;
  };

  return new ReadableStream({
    async start(controller) {
      reader = upstream.getReader();
      const pingMs = opts.pingMs ?? 10_000;
      const timer = pingMs > 0
        ? setInterval(() => {
            try { controller.enqueue(encoder.encode(": ping\n\n")); } catch { /* клиент ушёл */ }
          }, pingMs)
        : null;
      const onAbort = () => { void reader?.cancel().catch(() => undefined); };
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      try {
        while (true) {
          if (opts.signal?.aborted) break;
          const step = await reader.read();
          if (step.done) break;
          buffer += decoder.decode(step.value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          const rewritten = lines.map(rewrite).join("\n");
          if (lines.length) controller.enqueue(encoder.encode(`${rewritten}\n`));
        }
        if (buffer.trim()) controller.enqueue(encoder.encode(`${rewrite(buffer)}\n`));
        if (!sawDone) controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        opts.onDone?.({
          prompt: sawUsage ? prompt : Math.ceil((opts.promptChars || 0) / 4),
          completion: sawUsage ? completion : Math.ceil(text.length / 4),
          estimated: !sawUsage,
          text,
        });
      } catch {
        if (!sawDone) {
          const error = { error: { message: "The model returned an error.", type: "api_error", param: null, code: "upstream_error" } };
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(error)}\n\n`));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          } catch { /* клиент ушёл */ }
        }
      } finally {
        if (timer) clearInterval(timer);
        opts.signal?.removeEventListener("abort", onAbort);
        try { controller.close(); } catch { /* уже закрыт */ }
      }
    },
    cancel() {
      void reader?.cancel().catch(() => undefined);
    },
  });
}
