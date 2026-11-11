const OPEN_TAGS = ["<think>", "<thinking>"];
const CLOSE_TAGS = ["</think>", "</thinking>"];

function clip(value: unknown): string {
  return typeof value === "string" ? value.slice(0, 8_000) : "";
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = clip(value);
    if (text) return text;
  }
  return "";
}

function partType(part: Record<string, unknown>): string {
  return typeof part.type === "string" ? part.type : "";
}

function isReasonType(type: string): boolean {
  return type === "reasoning" || type === "thinking" || type === "reasoning_text" || type === "reasoning_summary";
}

function visibleContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const record = part as Record<string, unknown>;
      if (isReasonType(partType(record))) return "";
      if (typeof record.text === "string") return record.text;
      if (typeof record.content === "string") return record.content;
      return "";
    })
    .join("");
}

function reasonParts(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const record = part as Record<string, unknown>;
      if (!isReasonType(partType(record))) return "";
      if (typeof record.text === "string") return record.text;
      if (typeof record.reasoning === "string") return record.reasoning;
      if (typeof record.content === "string") return record.content;
      return "";
    })
    .join("");
}

/** Split a provider payload into the visible answer and the reasoning trace. */
export function extractPieces(payload: Record<string, unknown>): { text: string; reason: string } {
  const type = typeof payload.type === "string" ? payload.type : "";
  if (
    type === "response.reasoning_summary_text.delta" ||
    type === "response.reasoning_text.delta" ||
    type === "response.reasoning.delta"
  ) {
    return { text: "", reason: clip(payload.delta) };
  }
  if (type === "response.output_text.delta") {
    return { text: clip(payload.delta), reason: "" };
  }

  const choices = payload.choices;
  if (Array.isArray(choices) && choices[0] && typeof choices[0] === "object") {
    const choice = choices[0] as Record<string, unknown>;
    const box =
      choice.delta && typeof choice.delta === "object"
        ? (choice.delta as Record<string, unknown>)
        : choice.message && typeof choice.message === "object"
          ? (choice.message as Record<string, unknown>)
          : null;
    if (box) {
      return {
        text: visibleContent(box.content),
        reason: firstText(box.reasoning_content, box.reasoning, box.thinking) || reasonParts(box.content),
      };
    }
    if (typeof choice.text === "string") return { text: choice.text, reason: "" };
  }
  if (typeof payload.output_text === "string") return { text: payload.output_text, reason: "" };
  return { text: "", reason: "" };
}

function findTag(buffer: string, tags: string[]): { index: number; length: number } | null {
  const lower = buffer.toLowerCase();
  let best: { index: number; length: number } | null = null;
  for (const tag of tags) {
    const index = lower.indexOf(tag);
    if (index >= 0 && (!best || index < best.index)) best = { index, length: tag.length };
  }
  return best;
}

function partialTail(buffer: string, tags: string[]): number {
  const lower = buffer.toLowerCase();
  let keep = 0;
  for (const tag of tags) {
    const max = Math.min(buffer.length, tag.length - 1);
    for (let size = max; size > 0; size -= 1) {
      if (lower.endsWith(tag.slice(0, size))) {
        keep = Math.max(keep, size);
        break;
      }
    }
  }
  return keep;
}

/**
 * Pulls `<think>` / `<thinking>` blocks out of a content stream.
 * Tags may arrive split across chunks.
 */
export class ThinkGate {
  private open = false;
  private hold = "";

  push(chunk: string): { answer: string; reason: string } {
    if (!chunk) return { answer: "", reason: "" };
    this.hold += chunk;
    let answer = "";
    let reason = "";
    while (this.hold) {
      if (this.open) {
        const end = findTag(this.hold, CLOSE_TAGS);
        if (!end) {
          const keep = partialTail(this.hold, CLOSE_TAGS);
          reason += this.hold.slice(0, this.hold.length - keep);
          this.hold = this.hold.slice(this.hold.length - keep);
          break;
        }
        reason += this.hold.slice(0, end.index);
        this.hold = this.hold.slice(end.index + end.length);
        this.open = false;
        continue;
      }
      const start = findTag(this.hold, OPEN_TAGS);
      if (!start) {
        const keep = partialTail(this.hold, OPEN_TAGS);
        answer += this.hold.slice(0, this.hold.length - keep);
        this.hold = this.hold.slice(this.hold.length - keep);
        break;
      }
      answer += this.hold.slice(0, start.index);
      this.hold = this.hold.slice(start.index + start.length);
      this.open = true;
    }
    return { answer, reason };
  }

  flush(): { answer: string; reason: string } {
    const rest = this.hold;
    this.hold = "";
    if (!rest) return { answer: "", reason: "" };
    if (this.open) {
      this.open = false;
      return { answer: "", reason: rest };
    }
    return { answer: rest, reason: "" };
  }
}

/**
 * Fields that actually change how hard the model thinks.
 * Grok 4 rejects `none` (the request fails); the lowest accepted effort is `low`.
 * Other families get a real off switch: `none` or `thinking: disabled`.
 */
export function reasoningFields(model: string, enabled: boolean): Record<string, unknown> {
  const id = model.toLowerCase();
  if (id.includes("deepseek")) {
    return enabled
      ? { reasoning_effort: "high", thinking: { type: "enabled" } }
      : { thinking: { type: "disabled" } };
  }
  if (/qwen|qwq/.test(id)) {
    return { enable_thinking: enabled, chat_template_kwargs: { enable_thinking: enabled } };
  }
  if (id.includes("grok")) return { reasoning_effort: enabled ? "high" : "low" };
  return { reasoning_effort: enabled ? "high" : "none" };
}

/** One retry when a provider rejects the reasoning switch. Returns true if the body changed. */
export function softenReasoning(payload: Record<string, unknown>, errorText: string): boolean {
  const lower = errorText.toLowerCase();
  let changed = false;
  const effort = lower.includes("reasoning_effort") || lower.includes("reasoning effort") || lower.includes("reasoning.effort");
  if (effort && ("reasoning_effort" in payload || "reasoning" in payload)) {
    const unknown = /unknown|unrecognized|unexpected|extra inputs|additional propert|unsupported parameter/.test(lower);
    if (!unknown && payload.reasoning_effort === "none") payload.reasoning_effort = "low";
    else delete payload.reasoning_effort;
    delete payload.reasoning;
    changed = true;
  }
  const thinking =
    lower.includes("enable_thinking") || lower.includes("chat_template") || /\bthinking\b/.test(lower);
  if (thinking && ("thinking" in payload || "enable_thinking" in payload || "chat_template_kwargs" in payload)) {
    delete payload.thinking;
    delete payload.enable_thinking;
    delete payload.chat_template_kwargs;
    changed = true;
  }
  if ((effort || lower.includes("reasoning_content")) && Array.isArray(payload.messages)) {
    let stripped = false;
    payload.messages = payload.messages.map((item: unknown) => {
      if (!item || typeof item !== "object" || !("reasoning_content" in item)) return item;
      stripped = true;
      const copy = { ...(item as Record<string, unknown>) };
      delete copy.reasoning_content;
      return copy;
    });
    if (stripped) changed = true;
  }
  return changed;
}
