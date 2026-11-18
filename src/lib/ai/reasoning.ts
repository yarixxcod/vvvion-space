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

function detailsText(value: unknown): string {
  if (typeof value === "string") return clip(value);
  if (!value || typeof value !== "object") return "";
  if (Array.isArray(value)) return value.map((part) => detailsText(part)).join("");
  const record = value as Record<string, unknown>;
  return firstText(record.text, record.content, record.summary, record.reasoning);
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
        reason: firstText(box.reasoning_content, box.reasoning, box.thinking, detailsText(box.reasoning_details)) || reasonParts(box.content),
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
 * Whether this upstream model can think, and whether the switch can turn it off.
 * `always` — Grok 4.x that accepts effort but rejects a full off switch.
 * `switch` — DeepSeek, Qwen, GPT-5 and the o-series: off really means off.
 * `never` — no reasoning fields; the control stays inactive.
 * The visible catalog label counts too: a row named DeepSeek must switch even if the id looks like Grok.
 */
export type ThinkKind = "switch" | "always" | "never";

const SWITCH_FAMILY = /deepseek|qwen|qwq|reasoner|\bo[134](?:[.-]|$)|gpt-5|claude|ernie|glm-|kimi|moonshot|hunyuan|step-/;

export function thinkKind(model: string, label = ""): ThinkKind {
  const id = model.toLowerCase();
  const shown = label.toLowerCase();
  const both = `${id} ${shown}`.trim();
  if (!both) return "never";
  if (SWITCH_FAMILY.test(both)) return "switch";
  if (/grok/.test(id) || /grok/.test(shown)) {
    if (/4\.1|4\.20|fast|non-?reasoning/.test(id || shown)) return "never";
    return "always";
  }
  if (/think|reason/.test(both)) return "switch";
  return "never";
}

const SMALLTALK =
  /^(?:привет|приветствую|здравствуй(?:те)?|добрый\s+(?:день|вечер|утро)|хай|hello|hi|hey|yo|ок|окей|okay|ok|спасибо|благодарю|thanks|thank you|пока|bye|да|нет|yes|no|ага|угу|понял|понятно|ясно|класс|круто|лол|ха+|👍|👋|🙏)[.!?\s…]*$/iu;

/** Easy turns stay quiet. A real question, code, math or a long prompt is worth a trace. */
export function wantsThought(text: string): boolean {
  const raw = text.replace(/\s+/g, " ").trim();
  if (!raw || SMALLTALK.test(raw)) return false;
  if (/(```|\bкод\b|\bcode\b|функц|алгоритм|сравни|почему|зачем|докажи|посчитай|вычисли|объясни|расскажи|разниц|\bexplain\b|\bwhy\b|\bhow\b|debug|ошибк|\bsql\b|regex|архитект|пошаг|\bплан\b|таблиц|формул|уравнен|разбер|проанализ|напиши|реализ|\bimplement\b)/i.test(raw)) return true;
  if (raw.length <= 28 && !/[?？]/.test(raw) && !/\d/.test(raw)) return false;
  if (raw.length > 160) return true;
  if (/[?？]/.test(raw) && raw.length > 36) return true;
  if (/\d+\s*[-+*/x×÷=]\s*\d+/.test(raw)) return true;
  return raw.length > 72;
}

/**
 * Fields that actually change how hard the model thinks.
 * The switch is the source of truth: off sends a real disable, on keeps the trace available.
 * Easy text only lowers the effort. Grok rejects `none` and can only go down to `low`.
 */
export function reasoningFields(model: string, enabled: boolean, userText = ""): Record<string, unknown> {
  const kind = thinkKind(model);
  if (kind === "never") return {};
  const hard = !userText || wantsThought(userText);
  const id = model.toLowerCase();
  if (id.includes("deepseek")) {
    return enabled
      ? { reasoning_effort: hard ? "high" : "low", thinking: { type: "enabled" } }
      : { thinking: { type: "disabled" } };
  }
  if (/qwen|qwq/.test(id)) {
    return { enable_thinking: enabled, chat_template_kwargs: { enable_thinking: enabled } };
  }
  if (kind === "always") return { reasoning_effort: enabled && hard ? "high" : "low" };
  return { reasoning_effort: enabled ? (hard ? "medium" : "low") : "none" };
}

/** Drop the private hint and apply the switch to the upstream model id, not the catalog alias. */
export function applyChatReasoning(payload: Record<string, unknown>, model: string, catalog = ""): Record<string, unknown> {
  const enabled = payload.vvReason === true;
  const user = typeof payload.vvUser === "string" ? payload.vvUser : "";
  const marked = "vvReason" in payload || "vvUser" in payload;
  const rest = { ...payload };
  delete rest.vvReason;
  delete rest.vvUser;
  if (!marked || rest.tools) return rest;
  const picked = thinkKind(model) === "never" && catalog && thinkKind(catalog) !== "never" ? catalog : model;
  return { ...rest, ...reasoningFields(picked, enabled, user) };
}

/** Tool turns must not send reasoning_effort=none: Ernie and other gateways then drop tool_calls and answer with text. */
export function toolReasoningFields(model: string): Record<string, unknown> {
  const id = model.toLowerCase();
  if (id.includes("deepseek")) return { thinking: { type: "disabled" } };
  if (/qwen|qwq/.test(id)) return { enable_thinking: false, chat_template_kwargs: { enable_thinking: false } };
  if (id.includes("grok")) return { reasoning_effort: "low" };
  return {};
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
