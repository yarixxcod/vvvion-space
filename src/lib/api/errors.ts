export type ApiDialect = "openai" | "anthropic";

const TEXT: Record<string, string> = {
  invalid_api_key: "Invalid API key.",
  premium_required: "Premium is required.",
  account_suspended: "This account is suspended.",
  model_not_found: "That model is not available.",
  invalid_request_error: "Invalid request.",
  request_too_large: "Request is larger than 4 MB, which is the platform limit.",
  rate_limit_exceeded: "Too many requests. Try again shortly.",
  daily_limit_exceeded: "Daily API limit reached.",
  upstream_error: "The model returned an error.",
  service_disabled: "The API is turned off.",
  upstream_timeout: "The model timed out.",
  unsupported_tool: "That tool type is not supported.",
  unsupported_parameter: "That parameter is not supported. This API does not keep response state.",
  storage_unavailable: "There is no room left on Disk. Use response_format b64_json.",
};

function openAiType(code: string): string {
  if (code === "invalid_api_key") return "authentication_error";
  if (code === "rate_limit_exceeded" || code === "daily_limit_exceeded") return "rate_limit_error";
  if (code === "model_not_found") return "not_found_error";
  if (code === "upstream_timeout") return "timeout_error";
  if (code === "upstream_error" || code === "service_disabled") return "api_error";
  if (code === "premium_required" || code === "account_suspended") return "permission_error";
  return "invalid_request_error";
}

function anthropicType(code: string): string {
  if (code === "invalid_api_key") return "authentication_error";
  if (code === "rate_limit_exceeded" || code === "daily_limit_exceeded") return "rate_limit_error";
  if (code === "model_not_found") return "not_found_error";
  if (code === "premium_required" || code === "account_suspended") return "permission_error";
  if (code === "upstream_error" || code === "upstream_timeout" || code === "service_disabled") return "api_error";
  return "invalid_request_error";
}

export function errorBody(dialect: ApiDialect, code: string, message?: string, param: string | null = null) {
  const text = message || TEXT[code] || "Request failed.";
  if (dialect === "anthropic") {
    return { type: "error" as const, error: { type: anthropicType(code), message: text } };
  }
  return { error: { message: text, type: openAiType(code), param, code } };
}

/** Один и тот же ответ на любой провал ключа: нет ключа, формат, неизвестный, отозван. */
export function invalidKeyBody(dialect: ApiDialect = "openai") {
  return errorBody(dialect, "invalid_api_key");
}

/** Текст апстрима без ключей, адресов и имён хостов. Свой русский текст чата сюда не проходит. */
export function publicUpstream(status: number, raw: string, secret?: string): string {
  let text = String(raw || "").replace(/\s+/g, " ").trim().slice(0, 400);
  if (secret && secret.length > 6) text = text.split(secret).join("•••");
  text = text
    .replace(/Bearer\s+\S+/gi, "Bearer •••")
    .replace(/\b(?:sk|xai|whsec|vvvion-sk)-[A-Za-z0-9_-]{6,}\b/g, "•••")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/\b[a-z0-9.-]+\.(?:ai|com|io|net|org|dev|ru)\b/gi, "[host]");
  if (!text || /\[url\]|\[host\]|•••|провайдер|api[_ ]?key|authorization|[А-Яа-яЁё]/i.test(text)) {
    if (status === 429) return "The model is busy. Try again shortly.";
    if (status === 408 || status === 504) return "The model timed out.";
    return "The model returned an error.";
  }
  return text.slice(0, 240);
}
