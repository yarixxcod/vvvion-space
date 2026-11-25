import { cleanSearchSummary, type SearchSummary } from "./search-types";
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
  stickerReplies?: boolean;
  mcp?: string[];
  diskAccess?: boolean;
  memory?: string[];
  memoryOn?: boolean;
  agent?: { autonomy: "auto" | "ask"; web: boolean; image: boolean; files: boolean };
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
  onSources?: (sources: Source[], search?: SearchSummary) => void;
  onStep?: (step: { id: string; tool: string; label: string; detail?: string; status: "running" | "done" | "error" }) => void;
  onMemory?: (entries: string[], revision?: number) => void;
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
    let message = "";
    const raw = await res.text().catch(() => "");
    try {
      const body = JSON.parse(raw) as { message?: unknown; error?: unknown };
      const nested = body?.error;
      const detail = typeof body?.message === "string" ? body.message
        : typeof nested === "string" ? nested
        : nested && typeof nested === "object" && "message" in nested && typeof nested.message === "string" ? nested.message : "";
      message = detail.trim().slice(0, 350);
    } catch { /* An HTML gateway denial is not an application JSON error. */ }
    if (!message) {
      const handled = res.headers.get("x-vvvion-chat") === "1";
      message = res.status === 401 ? "Сессия истекла. Войдите в аккаунт снова."
        : res.status === 403 ? (handled ? "Доступ к чату отклонён. Проверьте вход в аккаунт и подписку."
          : "Соединение отклонено до обработки чата (403). Обновите страницу и повторите отправку.")
        : `Не удалось выполнить запрос (${res.status}).`;
    }
    const requestId = res.headers.get("x-vvvion-request-id") || res.headers.get("x-vercel-id");
    if (requestId && /^[a-zA-Z0-9:_.-]{1,160}$/.test(requestId)) message += ` Код запроса: ${requestId}`;
    throw new Error(message);
  }

  if (!res.body) throw new Error("Пустой ответ провайдера");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;
  let failed = false;
  function consume(raw: string) {
    const event = parseEvent(raw, handlers);
    if (event === "done") completed = true;
    if (event === "error") failed = true;
  }

  try {
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = buffer.replace(/\r\n/g, "\n");
    let split = buffer.indexOf("\n\n");
    while (split >= 0) {
      const raw = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      consume(raw);
      split = buffer.indexOf("\n\n");
    }
  }
  if (buffer.trim()) consume(buffer);
  if (!completed && !failed && !handlers.signal.aborted) throw new TypeError("Соединение прервано до завершения ответа");
  } finally { await reader.cancel().catch(() => undefined); }
}

function parseEvent(raw: string, handlers: Handlers) {
  let event = "message";
  let data = "";
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  if (!data) return;
  let json: { text?: string; message?: string; detail?: string; usage?: Usage; truncated?: boolean; url?: string; sources?: Source[]; search?: SearchSummary; remainingPct?: number; id?: string; tool?: string; label?: string; status?: "running" | "done" | "error"; entries?: string[]; revision?: number };
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
  else if (event === "error" && json.message) {
    const detail = typeof json.detail === "string" ? json.detail.trim() : "";
    handlers.onError(detail ? `${json.message}\n${detail}` : json.message);
  }
  else if (event === "image" && json.url) handlers.onImage?.(json.url);
  else if (event === "sources" && Array.isArray(json.sources)) handlers.onSources?.(json.sources, cleanSearchSummary(json.search));
  else if (event === "step" && json.id && json.label && json.status) handlers.onStep?.({ id: json.id, tool: json.tool || "", label: json.label, detail: json.detail, status: json.status });
  else if (event === "memory" && Array.isArray(json.entries)) handlers.onMemory?.(json.entries.filter((item): item is string => typeof item === "string"), typeof json.revision === "number" ? json.revision : undefined);
  return event;
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
