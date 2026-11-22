import { randomBytes } from "node:crypto";

type Fail = { ok: false; code: "invalid_request_error" | "unsupported_tool" | "unsupported_parameter"; message: string; param?: string };
type Ok = {
  ok: true;
  model: string;
  stream: boolean;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  messages: { role: string; content?: unknown; tool_calls?: unknown; tool_call_id?: string }[];
  tools?: unknown[];
  toolChoice?: unknown;
  customTools: string[];
};

const BUILTIN = new Set(["web_search", "file_search", "code_interpreter", "computer_use", "image_generation", "local_shell"]);

function id(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

/** Урезанный Responses API без состояния. previous_response_id и store:true отклоняются. */
export function responsesRequestToChat(body: unknown): Ok | Fail {
  if (!body || typeof body !== "object") return { ok: false, code: "invalid_request_error", message: "Body must be a JSON object." };
  const raw = body as Record<string, unknown>;
  if (typeof raw.previous_response_id === "string" && raw.previous_response_id) {
    return { ok: false, code: "unsupported_parameter", message: "previous_response_id is not supported. Send the full history; this API does not keep response state.", param: "previous_response_id" };
  }
  if (raw.store === true) {
    return { ok: false, code: "unsupported_parameter", message: "store is not supported. This API does not keep response state.", param: "store" };
  }
  const model = typeof raw.model === "string" ? raw.model.trim() : "";
  if (!model) return { ok: false, code: "invalid_request_error", message: "model is required.", param: "model" };
  const messages: Ok["messages"] = [];
  if (typeof raw.instructions === "string" && raw.instructions.trim()) messages.push({ role: "system", content: raw.instructions });
  const input = raw.input;
  if (typeof input === "string") messages.push({ role: "user", content: input });
  else if (Array.isArray(input)) {
    for (const item of input) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      if (row.type === "function_call") {
        messages.push({
          role: "assistant",
          content: "",
          tool_calls: [{
            id: typeof row.call_id === "string" ? row.call_id : id("call"),
            type: "function",
            function: { name: typeof row.name === "string" ? row.name : "tool", arguments: typeof row.arguments === "string" ? row.arguments : "{}" },
          }],
        });
        continue;
      }
      if (row.type === "function_call_output") {
        messages.push({
          role: "tool",
          tool_call_id: typeof row.call_id === "string" ? row.call_id : "",
          content: typeof row.output === "string" ? row.output : JSON.stringify(row.output ?? ""),
        });
        continue;
      }
      if (row.type === "message" || row.role) {
        const role = row.role === "assistant" ? "assistant" : row.role === "system" ? "system" : "user";
        const content = Array.isArray(row.content) ? row.content : row.content;
        messages.push({ role, content: flattenInput(content) });
      }
    }
  } else if (input != null) {
    return { ok: false, code: "invalid_request_error", message: "input must be a string or an array.", param: "input" };
  }
  if (!messages.some((message) => message.role === "user" || message.role === "tool" || message.role === "assistant")) {
    return { ok: false, code: "invalid_request_error", message: "input is required.", param: "input" };
  }
  const customTools: string[] = [];
  let tools: unknown[] | undefined;
  if (Array.isArray(raw.tools)) {
    tools = [];
    for (const tool of raw.tools) {
      if (!tool || typeof tool !== "object") continue;
      const row = tool as Record<string, unknown>;
      const type = typeof row.type === "string" ? row.type : "function";
      if (BUILTIN.has(type)) {
        return { ok: false, code: "unsupported_tool", message: `Tool type ${type} is not supported.`, param: "tools" };
      }
      if (type !== "function" && type !== "custom") {
        return { ok: false, code: "unsupported_tool", message: `Tool type ${type} is not supported.`, param: "tools" };
      }
      const name = typeof row.name === "string" ? row.name : "";
      if (!name) return { ok: false, code: "invalid_request_error", message: "Each tool needs a name.", param: "tools" };
      if (type === "custom") customTools.push(name);
      tools.push({
        type: "function",
        function: {
          name,
          description: typeof row.description === "string" ? row.description : "",
          parameters: type === "custom"
            ? { type: "object", properties: { input: { type: "string" } }, required: ["input"] }
            : (row.parameters && typeof row.parameters === "object" ? row.parameters : { type: "object", properties: {} }),
        },
      });
    }
  }
  return {
    ok: true,
    model,
    stream: raw.stream === true,
    maxTokens: typeof raw.max_output_tokens === "number" ? raw.max_output_tokens : undefined,
    temperature: typeof raw.temperature === "number" ? raw.temperature : undefined,
    topP: typeof raw.top_p === "number" ? raw.top_p : undefined,
    messages,
    tools,
    toolChoice: raw.tool_choice,
    customTools,
  };
}

function flattenInput(content: unknown): unknown {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: unknown[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if ((row.type === "input_text" || row.type === "output_text") && typeof row.text === "string") parts.push({ type: "text", text: row.text });
    if (row.type === "input_image") {
      const url = typeof row.image_url === "string" ? row.image_url : typeof (row.image_url as { url?: unknown } | undefined)?.url === "string" ? (row.image_url as { url: string }).url : "";
      if (url) parts.push({ type: "image_url", image_url: { url } });
    }
  }
  if (parts.length === 1 && (parts[0] as { type?: string }).type === "text") return (parts[0] as { text: string }).text;
  return parts;
}

function customArguments(name: string, raw: string, custom: string[]): string {
  if (!custom.includes(name)) return raw;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value && typeof value.input === "string" && Object.keys(value).length === 1) return value.input;
  } catch { /* оставляем исходную строку */ }
  return raw;
}

export function chatCompletionToResponse(raw: unknown, model: string, customTools: string[] = []) {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const choice = Array.isArray(row.choices) ? (row.choices[0] as Record<string, unknown> | undefined) : undefined;
  const message = choice?.message && typeof choice.message === "object" ? (choice.message as Record<string, unknown>) : {};
  const output: Record<string, unknown>[] = [];
  if (typeof message.content === "string" && message.content) {
    output.push({
      type: "message",
      id: id("msg"),
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: message.content, annotations: [] }],
    });
  }
  const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  for (const call of calls) {
    if (!call || typeof call !== "object") continue;
    const box = call as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
    const name = typeof box.function?.name === "string" ? box.function.name : "tool";
    const args = typeof box.function?.arguments === "string" ? box.function.arguments : "{}";
    const callId = typeof box.id === "string" ? box.id : id("call");
    output.push({ type: "function_call", id: id("fc"), call_id: callId, name, arguments: customArguments(name, args, customTools), status: "completed" });
  }
  const usage = row.usage && typeof row.usage === "object" ? (row.usage as Record<string, unknown>) : {};
  const inputTokens = Number(usage.prompt_tokens ?? 0) || 0;
  const outputTokens = Number(usage.completion_tokens ?? 0) || 0;
  return {
    id: id("resp"),
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "completed",
    model,
    output,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens, total_tokens: inputTokens + outputTokens },
  };
}

/** Стрим Responses. Каждое событие несёт sequence_number. response.completed включает usage. */
export class ResponsesEncoder {
  private sequence = 0;
  private text = "";
  private args = new Map<number, { name: string; id: string; callId: string; args: string; itemId: string }>();
  private started = false;
  private textOpened = false;
  private readonly responseId = id("resp");
  private readonly textItem = id("msg");
  private input = 0;
  private output = 0;
  private modelName = "";

  constructor(model: string) {
    this.modelName = model;
  }

  private emit(type: string, extra: Record<string, unknown>): string {
    const event = { type, sequence_number: this.sequence++, ...extra };
    return `event: ${type}\ndata: ${JSON.stringify(event)}\n\n`;
  }

  private open(): string {
    if (this.started) return "";
    this.started = true;
    const response = { id: this.responseId, object: "response", created_at: Math.floor(Date.now() / 1000), status: "in_progress", model: this.modelName, output: [] };
    return this.emit("response.created", { response }) + this.emit("response.in_progress", { response });
  }

  pushChunk(chunk: unknown): string {
    if (!chunk || typeof chunk !== "object") return "";
    const row = chunk as Record<string, unknown>;
    const usage = row.usage && typeof row.usage === "object" ? (row.usage as Record<string, unknown>) : null;
    if (usage) {
      const p = Number(usage.prompt_tokens ?? usage.input_tokens);
      const c = Number(usage.completion_tokens ?? usage.output_tokens);
      if (Number.isFinite(p)) this.input = p;
      if (Number.isFinite(c)) this.output = c;
    }
    let out = this.open();
    const choice = Array.isArray(row.choices) ? (row.choices[0] as { delta?: Record<string, unknown> } | undefined) : undefined;
    const delta = choice?.delta || {};
    if (typeof delta.content === "string" && delta.content) {
      if (!this.textOpened) {
        this.textOpened = true;
        out += this.emit("response.output_item.added", { output_index: 0, item: { type: "message", id: this.textItem, role: "assistant", status: "in_progress", content: [] } });
        out += this.emit("response.content_part.added", { output_index: 0, content_index: 0, part: { type: "output_text", text: "", annotations: [] } });
      }
      this.text += delta.content;
      out += this.emit("response.output_text.delta", { output_index: 0, content_index: 0, delta: delta.content });
    }
    const calls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
    for (const call of calls) {
      if (!call || typeof call !== "object") continue;
      const box = call as { index?: unknown; id?: unknown; function?: { name?: unknown; arguments?: unknown } };
      const index = Number(box.index ?? 0);
      let tool = this.args.get(index);
      if (!tool) {
        tool = {
          name: typeof box.function?.name === "string" ? box.function.name : "tool",
          id: id("fc"),
          callId: typeof box.id === "string" ? box.id : id("call"),
          args: "",
          itemId: id("fc"),
        };
        this.args.set(index, tool);
        out += this.emit("response.output_item.added", {
          output_index: index + 1,
          item: { type: "function_call", id: tool.id, call_id: tool.callId, name: tool.name, arguments: "", status: "in_progress" },
        });
      }
      const piece = typeof box.function?.arguments === "string" ? box.function.arguments : "";
      if (piece) {
        tool.args += piece;
        out += this.emit("response.function_call_arguments.delta", { output_index: index + 1, delta: piece });
      }
    }
    return out;
  }

  usage(): { prompt: number; completion: number } {
    return { prompt: this.input, completion: this.output };
  }

  finish(): string {
    let out = this.open();
    if (this.textOpened) {
      out += this.emit("response.output_text.done", { output_index: 0, content_index: 0, text: this.text });
      out += this.emit("response.content_part.done", { output_index: 0, content_index: 0, part: { type: "output_text", text: this.text, annotations: [] } });
      out += this.emit("response.output_item.done", { output_index: 0, item: { type: "message", id: this.textItem, role: "assistant", status: "completed", content: [{ type: "output_text", text: this.text, annotations: [] }] } });
    }
    for (const [index, tool] of this.args) {
      out += this.emit("response.function_call_arguments.done", { output_index: index + 1, arguments: tool.args });
      out += this.emit("response.output_item.done", {
        output_index: index + 1,
        item: { type: "function_call", id: tool.id, call_id: tool.callId, name: tool.name, arguments: tool.args, status: "completed" },
      });
    }
    const usage = { input_tokens: this.input, output_tokens: this.output, total_tokens: this.input + this.output };
    out += this.emit("response.completed", {
      response: { id: this.responseId, object: "response", status: "completed", model: this.modelName, usage },
    });
    return out;
  }
}
