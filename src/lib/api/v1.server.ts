import { extractError } from "@/lib/ai/proxy.server";
import { AnthropicEncoder, anthropicPing, anthropicRequestToChat, chatCompletionToAnthropic, estimateInputTokens } from "@/lib/api/anthropic-convert";
import { readApiBody } from "@/lib/api/body";
import { guardRequest, type GuardOk } from "@/lib/api/guard.server";
import { apiError, apiJson } from "@/lib/api/http";
import { generateApiImage } from "@/lib/api/images.server";
import { listApiModels } from "@/lib/api/models.server";
import { parseModelsQuery, renderModelsError, renderModelsPage, sliceByCursor, wantsModelsHtml } from "@/lib/api/models-page";
import { buildChatPayload, normalizeChatCompletion, textOfCompletion, usageOf } from "@/lib/api/openai-wire";
import { ResponsesEncoder, chatCompletionToResponse, responsesRequestToChat } from "@/lib/api/responses-convert";
import { decorateOpenAiSse } from "@/lib/api/sse";
import { runUpstream } from "@/lib/api/upstream.server";

function clock(request: Request, ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const onAbort = () => controller.abort();
  if (request.signal.aborted) controller.abort();
  else request.signal.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    stop: () => {
      clearTimeout(timer);
      request.signal.removeEventListener("abort", onAbort);
    },
    abort: () => controller.abort(),
  };
}

async function fail(gate: GuardOk, status: number, code: string, message?: string, model = ""): Promise<Response> {
  await gate.finish({ status, model });
  return apiError(gate.dialect, status, code, gate.requestId, message, gate.headers);
}

export async function v1Models(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const query = parseModelsQuery(url.searchParams);
  if (
    wantsModelsHtml({
      accept: request.headers.get("accept"),
      authorization: request.headers.get("authorization"),
      apiKey: request.headers.get("x-api-key"),
    })
  ) {
    try {
      const models = await listApiModels();
      return new Response(renderModelsPage(models, query.page, query.type), {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "public, max-age=30",
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
        },
      });
    } catch (error) {
      console.error("[api] models", error instanceof Error ? error.name : "failed");
      return new Response(renderModelsError(), {
        status: 502,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    }
  }
  const gate = await guardRequest(request, "models");
  if (!gate.ok) return gate.response;
  try {
    const models = await listApiModels();
    await gate.finish({ status: 200 });
    if (request.headers.get("anthropic-version")) {
      const chats = sliceByCursor(
        models.filter((model) => model.type === "chat"),
        query.limit,
        query.after,
      );
      return apiJson(200, {
        data: chats.data.map((model) => ({
          type: "model",
          id: model.id,
          display_name: model.displayName,
          created_at: new Date(model.created * 1000).toISOString(),
        })),
        has_more: chats.hasMore,
        first_id: chats.data[0]?.id ?? null,
        last_id: chats.data.at(-1)?.id ?? null,
      }, gate.requestId, gate.headers);
    }
    const page = sliceByCursor(models, query.limit, query.after);
    return apiJson(200, {
      object: "list",
      data: page.data.map((model) => ({ id: model.id, object: "model", created: model.created, owned_by: "vvvion", type: model.type })),
      has_more: page.hasMore,
    }, gate.requestId, gate.headers);
  } catch (error) {
    console.error("[api] models", error instanceof Error ? error.name : "failed");
    return fail(gate, 502, "upstream_error");
  }
}

type Built = { model: string; stream: boolean; payload: Record<string, unknown>; promptChars: number };

async function complete(request: Request, gate: GuardOk, built: Built, present: "openai" | "anthropic" | "responses", customTools: string[] = []): Promise<Response> {
  const timer = clock(request, built.stream ? 240_000 : 90_000);
  try {
    if (!built.stream) {
      const result = await runUpstream(built.model, built.payload, timer.signal, gate.userId);
      if (!result.ok) return fail(gate, result.status, result.code, result.message, built.model);
      const text = await result.response.text();
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { return fail(gate, 502, "upstream_error", undefined, built.model); }
      if (extractError(parsed, "")) return fail(gate, 502, "upstream_error", undefined, built.model);
      const completion = normalizeChatCompletion(parsed, built.model);
      const usage = usageOf(parsed, textOfCompletion(parsed), built.promptChars);
      await gate.finish({ status: 200, model: built.model, promptTokens: usage.prompt, completionTokens: usage.completion, estimated: usage.estimated });
      const body = present === "anthropic"
        ? chatCompletionToAnthropic(completion, built.model)
        : present === "responses"
          ? chatCompletionToResponse(completion, built.model, customTools)
          : completion;
      return apiJson(200, body, gate.requestId, gate.headers);
    }
    const headers = new Headers({
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      "x-request-id": gate.requestId,
      "access-control-allow-origin": "*",
    });
    for (const [key, value] of Object.entries(gate.headers)) headers.set(key, value);
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const enc = new TextEncoder();
        let closed = false;
        const ping = setInterval(() => {
          if (closed) return;
          try { controller.enqueue(enc.encode(present === "anthropic" ? anthropicPing() : ": ping\n\n")); } catch { closed = true; }
        }, 10_000);
        const pushError = (message: string) => {
          if (present === "openai") {
            controller.enqueue(enc.encode(`data: ${JSON.stringify({ error: { message, type: "api_error", param: null, code: "upstream_error" } })}\n\n`));
            controller.enqueue(enc.encode("data: [DONE]\n\n"));
            return;
          }
          controller.enqueue(enc.encode(`event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "api_error", message } })}\n\n`));
        };
        try {
          const result = await runUpstream(built.model, built.payload, timer.signal, gate.userId);
          if (!result.ok || !result.response.body) {
            pushError(result.ok ? "The model returned an error." : result.message);
            await gate.finish({ status: result.ok ? 502 : result.status, model: built.model });
            return;
          }
          if (present === "openai") {
            let usage = { prompt: Math.ceil(built.promptChars / 4), completion: 0, estimated: true };
            const decorated = decorateOpenAiSse(result.response.body, {
              model: built.model,
              pingMs: 0,
              signal: timer.signal,
              promptChars: built.promptChars,
              onDone: (row) => { usage = row; },
            });
            const reader = decorated.getReader();
            while (true) {
              const step = await reader.read();
              if (step.done) break;
              controller.enqueue(step.value);
            }
            await gate.finish({ status: 200, model: built.model, promptTokens: usage.prompt, completionTokens: usage.completion, estimated: usage.estimated });
          } else {
            const encoder = present === "anthropic" ? new AnthropicEncoder(built.model) : new ResponsesEncoder(built.model);
            const reader = result.response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            while (!timer.signal.aborted) {
              const step = await reader.read();
              if (step.done) break;
              buffer += decoder.decode(step.value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() ?? "";
              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith("data:")) continue;
                const data = trimmed.slice(5).trim();
                if (!data || data === "[DONE]") continue;
                try {
                  const mapped = encoder.pushChunk(JSON.parse(data));
                  if (mapped) controller.enqueue(enc.encode(mapped));
                } catch { /* битый чанк не показываем */ }
              }
            }
            controller.enqueue(enc.encode(encoder.finish()));
            const usage = encoder.usage();
            const estimated = usage.prompt === 0 && usage.completion === 0;
            await gate.finish({
              status: 200,
              model: built.model,
              promptTokens: estimated ? Math.ceil(built.promptChars / 4) : usage.prompt,
              completionTokens: usage.completion,
              estimated,
            });
          }
        } catch {
          try { pushError("The model timed out."); } catch { /* клиент ушёл */ }
          await gate.finish({ status: 504, model: built.model });
        } finally {
          clearInterval(ping);
          timer.stop();
          closed = true;
          try { controller.close(); } catch { /* уже закрыт */ }
        }
      },
      cancel() { timer.abort(); },
    });
    return new Response(stream, { status: 200, headers });
  } finally {
    if (!built.stream) timer.stop();
  }
}

export async function v1ChatCompletions(request: Request): Promise<Response> {
  const gate = await guardRequest(request, "chat");
  if (!gate.ok) return gate.response;
  const body = await readApiBody(request);
  if (!body.ok) return fail(gate, body.status, body.code, body.message);
  const built = buildChatPayload(body.value, { maxOutputTokens: gate.settings.maxOutputTokens });
  if (!built.ok) return fail(gate, 400, "invalid_request_error", built.message);
  return complete(request, gate, built, "openai");
}

export async function v1Messages(request: Request): Promise<Response> {
  const gate = await guardRequest(request, "chat");
  if (!gate.ok) return gate.response;
  const body = await readApiBody(request);
  if (!body.ok) return fail(gate, body.status, body.code, body.message);
  const converted = anthropicRequestToChat(body.value);
  if (!converted.ok) return fail(gate, 400, "invalid_request_error", converted.message);
  const source: Record<string, unknown> = {
    model: converted.model,
    messages: converted.messages,
    max_tokens: converted.maxTokens,
    stream: converted.stream,
  };
  if (converted.temperature !== undefined) source.temperature = converted.temperature;
  if (converted.topP !== undefined) source.top_p = converted.topP;
  if (converted.stop) source.stop = converted.stop;
  if (converted.tools) source.tools = converted.tools;
  if (converted.toolChoice !== undefined) source.tool_choice = converted.toolChoice;
  const built = buildChatPayload(source, { maxOutputTokens: gate.settings.maxOutputTokens });
  if (!built.ok) return fail(gate, 400, "invalid_request_error", built.message);
  return complete(request, gate, built, "anthropic");
}

export async function v1CountTokens(request: Request): Promise<Response> {
  const gate = await guardRequest(request, "count");
  if (!gate.ok) return gate.response;
  const body = await readApiBody(request);
  if (!body.ok) return fail(gate, body.status, body.code, body.message);
  const tokens = estimateInputTokens(body.value);
  await gate.finish({ status: 200, promptTokens: tokens, estimated: true });
  return apiJson(200, { input_tokens: tokens }, gate.requestId, gate.headers);
}

export async function v1Responses(request: Request): Promise<Response> {
  const gate = await guardRequest(request, "chat");
  if (!gate.ok) return gate.response;
  const body = await readApiBody(request);
  if (!body.ok) return fail(gate, body.status, body.code, body.message);
  const converted = responsesRequestToChat(body.value);
  if (!converted.ok) return fail(gate, 400, converted.code, converted.message);
  const source: Record<string, unknown> = { model: converted.model, messages: converted.messages, stream: converted.stream };
  if (converted.maxTokens !== undefined) source.max_tokens = converted.maxTokens;
  if (converted.temperature !== undefined) source.temperature = converted.temperature;
  if (converted.topP !== undefined) source.top_p = converted.topP;
  if (converted.tools) source.tools = converted.tools;
  if (converted.toolChoice !== undefined) source.tool_choice = converted.toolChoice;
  const built = buildChatPayload(source, { maxOutputTokens: gate.settings.maxOutputTokens });
  if (!built.ok) return fail(gate, 400, "invalid_request_error", built.message);
  return complete(request, gate, built, "responses", converted.customTools);
}

export async function v1Images(request: Request): Promise<Response> {
  const gate = await guardRequest(request, "image");
  if (!gate.ok) return gate.response;
  const body = await readApiBody(request);
  if (!body.ok) return fail(gate, body.status, body.code, body.message);
  const timer = clock(request, 240_000);
  try {
    const image = await generateApiImage(body.value, timer.signal);
    if (!image.ok) return fail(gate, image.status, image.code, image.message);
    const model = body.value && typeof body.value === "object" && typeof (body.value as { model?: unknown }).model === "string"
      ? (body.value as { model: string }).model : "";
    await gate.finish({ status: 200, model, images: 1 });
    return apiJson(200, { created: Math.floor(Date.now() / 1000), data: [{ b64_json: image.b64 }] }, gate.requestId, gate.headers);
  } finally {
    timer.stop();
  }
}

export async function v1MissingResponse(): Promise<Response> {
  return apiError("openai", 404, "invalid_request_error", crypto.randomUUID(), "Stored responses are not supported. Send the full history on each request.");
}
