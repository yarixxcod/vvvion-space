import type { ChatTurn, Source, Usage } from "@/lib/ai/types";
import { getBearerToken } from "@/lib/auth/client";

export type StreamPayload = {
  kind: "builtin" | "custom";
  baseUrl: string;
  apiKey: string;
  extraHeaders: { name: string; value: string }[];
  chatPath: string;
  model: string;
  imageModel?: string;
  messages: ChatTurn[];
  systemPrompt: string;
  temperature: number;
  maxTokens: number | null;
  mode?: "chat" | "image";
  webSearch?: boolean;
  searchEngine?: "duck" | "tinyfish" | "freeserp";
  reasoning?: boolean;
  track?: { chatId: string; messageId: string };
  personaId?: string;
  toolNote?: string;
  mcp?: string[];
};

type Handlers = {
  signal: AbortSignal;
  onDelta: (text: string) => void;
  onReason?: (text: string) => void;
  onUsage: (usage: Usage) => void;
  onLimit?: (remainingPct: number) => void;
  onMeta?: (meta: { truncated?: boolean }) => void;
  onError: (message: string) => void;
  onImage?: (url: string) => void;
  onSources?: (sources: Source[]) => void;
};

export async function streamChat(payload: StreamPayload, handlers: Handlers): Promise<void> {
  const headers = new Headers({ "content-type": "application/json" });
  const token = getBearerToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch("/api/chat", {
    method: "POST",
    headers,
    credentials: "same-origin",
    body: JSON.stringify(payload),
    signal: handlers.signal,
  });

  if (!res.ok) {
    let message = `Ошибка ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      /* ignore broken error bodies */
    }
    throw new Error(message);
  }

  if (!res.body) throw new Error("Пустой ответ провайдера");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let split = buffer.indexOf("\n\n");
    while (split >= 0) {
      const raw = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      parseEvent(raw, handlers);
      split = buffer.indexOf("\n\n");
    }
  }
  if (buffer.trim()) parseEvent(buffer, handlers);
}

function parseEvent(raw: string, handlers: Handlers) {
  let event = "message";
  let data = "";
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  if (!data) return;
  let json: { text?: string; message?: string; usage?: Usage; truncated?: boolean; url?: string; sources?: Source[]; remainingPct?: number };
  try {
    json = JSON.parse(data) as typeof json;
  } catch {
    return;
  }
  if (event === "delta" && json.text) handlers.onDelta(json.text);
  else if (event === "reason" && json.text) handlers.onReason?.(json.text);
  else if (event === "usage" && json.usage) handlers.onUsage(json.usage);
  else if (event === "limit" && typeof json.remainingPct === "number") handlers.onLimit?.(json.remainingPct);
  else if (event === "meta" && json.truncated) handlers.onMeta?.({ truncated: true });
  else if (event === "error" && json.message) handlers.onError(json.message);
  else if (event === "image" && json.url) handlers.onImage?.(json.url);
  else if (event === "sources" && Array.isArray(json.sources)) handlers.onSources?.(json.sources);
}

export type ModelsResult = {
  ok: boolean;
  models: string[];
  message?: string;
};

export async function requestModels(input: {
  kind: "builtin" | "custom";
  baseUrl: string;
  apiKey: string;
  extraHeaders: { name: string; value: string }[];
}): Promise<ModelsResult> {
  const res = await fetch("/api/models", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = (await res.json()) as ModelsResult;
  if (!res.ok && body.ok !== false) {
    return { ok: false, models: [], message: `Ошибка ${res.status}` };
  }
  return body;
}
