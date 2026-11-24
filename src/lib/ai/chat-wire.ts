import { toolReasoningFields } from "@/lib/ai/reasoning";

type Row = {
  role?: unknown;
  content?: unknown;
  tool_calls?: unknown;
  reasoning_content?: unknown;
};

function rowsOf(payload: Record<string, unknown>): Row[] {
  return Array.isArray(payload.messages)
    ? payload.messages.filter((item): item is Row => Boolean(item) && typeof item === "object")
    : [];
}

/** Why a post-tool completion body would be rejected by DeepSeek and similar gateways. */
export function inspectChatWire(payload: Record<string, unknown>): string[] {
  const issues: string[] = [];
  const rows = rowsOf(payload);
  const toolHistory = rows.some((row) => row.role === "tool" || row.tool_calls != null);
  if (toolHistory && !payload.tools) issues.push("tools_missing");
  if (rows.some((row) => row.role === "assistant" && row.tool_calls != null && row.content === ""))
    issues.push("empty_assistant_content");
  const thinking = payload.thinking;
  const thinkingOn =
    (thinking != null && typeof thinking === "object" && (thinking as { type?: unknown }).type === "enabled") ||
    payload.reasoning_effort === "high";
  if (
    thinkingOn &&
    payload.tools &&
    rows.some((row) => row.role === "assistant" && row.tool_calls != null && row.reasoning_content == null)
  )
    issues.push("missing_reasoning_content");
  return issues;
}

/** Final answer after tools: same tool list, no further calls, thinking off, no private hints. */
export function closeoutChatPayload(
  payload: Record<string, unknown>,
  messages: unknown[],
  model: string,
  tools: unknown,
): Record<string, unknown> {
  const rest = { ...payload };
  delete rest.vvReason;
  delete rest.vvUser;
  delete rest.reasoning_effort;
  delete rest.reasoning;
  delete rest.thinking;
  delete rest.enable_thinking;
  delete rest.chat_template_kwargs;
  const picked = typeof rest.model === "string" && rest.model ? rest.model : model;
  return {
    ...rest,
    messages,
    stream: true,
    tools,
    tool_choice: "none",
    ...toolReasoningFields(picked),
  };
}
