import { randomBytes } from "node:crypto";

export type ConvertFail = { ok: false; message: string };
export type ChatTurn = {
  role: "system" | "user" | "assistant" | "tool";
  content?: unknown;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
};

export type AnthropicChat = {
  ok: true;
  model: string;
  maxTokens: number;
  stream: boolean;
  temperature?: number;
  topP?: number;
  stop?: string[];
  messages: ChatTurn[];
  tools?: unknown[];
  toolChoice?: unknown;
};

type Block = Record<string, unknown>;

function blocksOf(content: unknown): Block[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (!Array.isArray(content)) return [];
  return content.filter((item) => item && typeof item === "object") as Block[];
}

function textOfBlocks(content: unknown): string {
  if (typeof content === "string") return content;
  return blocksOf(content)
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => String(block.text))
    .join("");
}

function imagePart(block: Block): { type: "image_url"; image_url: { url: string } } | null {
  if (block.type !== "image") return null;
  const source = block.source;
  if (!source || typeof source !== "object") return null;
  const box = source as Record<string, unknown>;
  if (box.type === "base64" && typeof box.data === "string" && typeof box.media_type === "string") {
    return { type: "image_url", image_url: { url: `data:${box.media_type};base64,${box.data}` } };
  }
  if (box.type === "url" && typeof box.url === "string") return { type: "image_url", image_url: { url: box.url } };
  return null;
}

function userParts(content: unknown): unknown {
  if (typeof content === "string") return content;
  const parts: unknown[] = [];
  for (const block of blocksOf(content)) {
    if (block.type === "text" && typeof block.text === "string") parts.push({ type: "text", text: block.text });
    const image = imagePart(block);
    if (image) parts.push(image);
  }
  if (!parts.length) return "";
  if (parts.length === 1 && (parts[0] as { type?: string }).type === "text") return (parts[0] as { text: string }).text;
  return parts;
}

function toolChoiceOf(value: unknown): unknown {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  if (row.type === "auto") return "auto";
  if (row.type === "any") return "required";
  if (row.type === "none") return "none";
  if (row.type === "tool" && typeof row.name === "string") return { type: "function", function: { name: row.name } };
  return undefined;
}

/** Anthropic Messages → Chat Completions. thinking, metadata и cache_control отбрасываются. */
export function anthropicRequestToChat(body: unknown): AnthropicChat | ConvertFail {
  if (!body || typeof body !== "object") return { ok: false, message: "Body must be a JSON object." };
  const raw = body as Record<string, unknown>;
  const model = typeof raw.model === "string" ? raw.model.trim() : "";
  if (!model) return { ok: false, message: "model is required." };
  if (typeof raw.max_tokens !== "number" || !Number.isFinite(raw.max_tokens) || raw.max_tokens < 1) {
    return { ok: false, message: "max_tokens is required." };
  }
  const messages: ChatTurn[] = [];
  if (typeof raw.system === "string" && raw.system.trim()) messages.push({ role: "system", content: raw.system });
  else if (Array.isArray(raw.system)) {
    const text = textOfBlocks(raw.system);
    if (text) messages.push({ role: "system", content: text });
  }
  const incoming = Array.isArray(raw.messages) ? raw.messages : null;
  if (!incoming) return { ok: false, message: "messages must be an array." };
  for (const item of incoming) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (row.role === "assistant") {
      const calls = blocksOf(row.content).filter((block) => block.type === "tool_use");
      const text = textOfBlocks(row.content);
      const turn: ChatTurn = { role: "assistant", content: text };
      if (calls.length) {
        turn.tool_calls = calls.map((block) => ({
          id: typeof block.id === "string" ? block.id : `toolu_${randomBytes(6).toString("hex")}`,
          type: "function" as const,
          function: {
            name: typeof block.name === "string" ? block.name : "tool",
            arguments: JSON.stringify(block.input && typeof block.input === "object" ? block.input : {}),
          },
        }));
      }
      messages.push(turn);
      continue;
    }
    const blocks = typeof row.content === "string" ? [{ type: "text", text: row.content }] : blocksOf(row.content);
    let pending: Block[] = [];
    const flush = () => {
      if (!pending.length) return;
      messages.push({ role: "user", content: userParts(pending) });
      pending = [];
    };
    for (const block of blocks) {
      if (block.type === "tool_result") {
        flush();
        const text = textOfBlocks(block.content);
        const prefix = block.is_error === true ? "Error: " : "";
        messages.push({
          role: "tool",
          tool_call_id: typeof block.tool_use_id === "string" ? block.tool_use_id : "",
          content: `${prefix}${typeof block.content === "string" ? block.content : text}`,
        });
        continue;
      }
      pending.push(block);
    }
    flush();
  }
  const tools = Array.isArray(raw.tools)
    ? raw.tools
        .filter((tool) => tool && typeof tool === "object")
        .map((tool) => {
          const row = tool as Record<string, unknown>;
          return {
            type: "function",
            function: {
              name: typeof row.name === "string" ? row.name : "tool",
              description: typeof row.description === "string" ? row.description : "",
              parameters: row.input_schema && typeof row.input_schema === "object" ? row.input_schema : { type: "object", properties: {} },
            },
          };
        })
    : undefined;
  const stop = Array.isArray(raw.stop_sequences) ? raw.stop_sequences.filter((item) => typeof item === "string") as string[] : undefined;
  return {
    ok: true,
    model,
    maxTokens: raw.max_tokens,
    stream: raw.stream === true,
    temperature: typeof raw.temperature === "number" ? raw.temperature : undefined,
    topP: typeof raw.top_p === "number" ? raw.top_p : undefined,
    stop,
    messages,
    tools,
    toolChoice: toolChoiceOf(raw.tool_choice),
  };
}

export function parseToolInput(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw);
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    console.error("[api] tool arguments were not valid JSON");
  }
  return {};
}

export function anthropicStopReason(finish: unknown, usedTool: boolean): "end_turn" | "max_tokens" | "tool_use" | "stop_sequence" {
  if (finish === "length") return "max_tokens";
  if (finish === "stop_sequence") return "stop_sequence";
  if (finish === "tool_calls" || usedTool) return "tool_use";
  return "end_turn";
}

export function chatCompletionToAnthropic(raw: unknown, model: string) {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const choice = Array.isArray(row.choices) ? (row.choices[0] as Record<string, unknown> | undefined) : undefined;
  const message = choice?.message && typeof choice.message === "object" ? (choice.message as Record<string, unknown>) : {};
  const content: Record<string, unknown>[] = [];
  if (typeof message.content === "string" && message.content) content.push({ type: "text", text: message.content });
  const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  for (const call of calls) {
    if (!call || typeof call !== "object") continue;
    const box = call as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
    const args = typeof box.function?.arguments === "string" ? box.function.arguments : "{}";
    content.push({
      type: "tool_use",
      id: typeof box.id === "string" ? box.id : `toolu_${randomBytes(6).toString("hex")}`,
      name: typeof box.function?.name === "string" ? box.function.name : "tool",
      input: parseToolInput(args),
    });
  }
  const usage = row.usage && typeof row.usage === "object" ? (row.usage as Record<string, unknown>) : {};
  const id = typeof row.id === "string" ? row.id.replace(/^chatcmpl_/, "") : randomBytes(8).toString("hex");
  return {
    id: id.startsWith("msg_") ? id : `msg_${id}`,
    type: "message" as const,
    role: "assistant" as const,
    model,
    content,
    stop_reason: anthropicStopReason(choice?.finish_reason, calls.length > 0),
    stop_sequence: null,
    usage: {
      input_tokens: Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0,
      output_tokens: Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0,
    },
  };
}

export function estimateInputTokens(body: unknown): number {
  const text = typeof body === "string" ? body : JSON.stringify(body ?? "");
  return Math.max(1, Math.ceil(text.length / 3.5));
}

type ToolBlock = { openIndex: number; id: string; name: string; opened: boolean };

/** Копит чанки OpenAI и отдаёт события Anthropic с корректными границами блоков. */
export class AnthropicEncoder {
  private started = false;
  private textIndex = -1;
  private textOpen = false;
  private next = 0;
  private tools = new Map<number, ToolBlock>();
  private input = 0;
  private output = 0;
  private finishReason: unknown = null;
  private modelName = "";
  readonly id: string;

  constructor(model: string, id?: string) {
    this.modelName = model;
    this.id = id || `msg_${randomBytes(8).toString("hex")}`;
  }

  private event(name: string, data: unknown): string {
    return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
  }

  private start(input = 0): string {
    if (this.started) return "";
    this.started = true;
    this.input = input;
    return this.event("message_start", {
      type: "message_start",
      message: {
        id: this.id,
        type: "message",
        role: "assistant",
        model: this.modelName,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: input, output_tokens: 0 },
      },
    });
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
    let out = this.start(this.input);
    const choice = Array.isArray(row.choices) ? (row.choices[0] as Record<string, unknown> | undefined) : undefined;
    if (choice?.finish_reason) this.finishReason = choice.finish_reason;
    const delta = choice?.delta && typeof choice.delta === "object" ? (choice.delta as Record<string, unknown>) : {};
    if (typeof delta.content === "string" && delta.content) {
      if (!this.textOpen) {
        this.textIndex = this.next++;
        this.textOpen = true;
        out += this.event("content_block_start", {
          type: "content_block_start",
          index: this.textIndex,
          content_block: { type: "text", text: "" },
        });
      }
      out += this.event("content_block_delta", {
        type: "content_block_delta",
        index: this.textIndex,
        delta: { type: "text_delta", text: delta.content },
      });
    }
    const calls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
    for (const call of calls) {
      if (!call || typeof call !== "object") continue;
      const box = call as { index?: unknown; id?: unknown; function?: { name?: unknown; arguments?: unknown } };
      const index = Number(box.index ?? 0);
      let tool = this.tools.get(index);
      if (!tool) {
        tool = {
          openIndex: this.next++,
          id: typeof box.id === "string" ? box.id : `toolu_${index}_${randomBytes(3).toString("hex")}`,
          name: typeof box.function?.name === "string" ? box.function.name : "",
          opened: false,
        };
        this.tools.set(index, tool);
      }
      if (typeof box.id === "string") tool.id = box.id;
      if (typeof box.function?.name === "string" && box.function.name) tool.name = box.function.name;
      const piece = typeof box.function?.arguments === "string" ? box.function.arguments : "";
      if (!tool.opened && (tool.name || piece)) {
        tool.opened = true;
        out += this.event("content_block_start", {
          type: "content_block_start",
          index: tool.openIndex,
          content_block: { type: "tool_use", id: tool.id, name: tool.name || "tool", input: {} },
        });
      }
      if (piece && tool.opened) {
        out += this.event("content_block_delta", {
          type: "content_block_delta",
          index: tool.openIndex,
          delta: { type: "input_json_delta", partial_json: piece },
        });
      }
    }
    return out;
  }

  usage(): { prompt: number; completion: number } {
    return { prompt: this.input, completion: this.output };
  }

  finish(): string {
    let out = this.start(this.input);
    if (this.textOpen) {
      out += this.event("content_block_stop", { type: "content_block_stop", index: this.textIndex });
      this.textOpen = false;
    }
    for (const tool of this.tools.values()) {
      if (!tool.opened) continue;
      out += this.event("content_block_stop", { type: "content_block_stop", index: tool.openIndex });
    }
    out += this.event("message_delta", {
      type: "message_delta",
      delta: { stop_reason: anthropicStopReason(this.finishReason, this.tools.size > 0), stop_sequence: null },
      usage: { output_tokens: this.output },
    });
    out += this.event("message_stop", { type: "message_stop" });
    return out;
  }
}

export function anthropicPing(): string {
  return `event: ping\ndata: ${JSON.stringify({ type: "ping" })}\n\n`;
}
