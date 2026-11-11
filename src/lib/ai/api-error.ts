const SECRET = /Bearer\s+\S+/gi;
const KEY = /\b(?:sk|xai|whsec)-[A-Za-z0-9_\-]{6,}\b/g;

function clean(text: string, secret?: string): string {
  let out = text.replace(/\s+/g, " ").trim();
  if (secret && secret.length > 6) out = out.split(secret).join("•••");
  out = out.replace(SECRET, "Bearer •••").replace(KEY, "•••");
  return out.slice(0, 220);
}

function textsFrom(value: unknown, depth = 0): string[] {
  if (depth > 4 || value == null) return [];
  if (typeof value === "string") {
    const text = value.trim();
    return text ? [text] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => textsFrom(item, depth + 1)).slice(0, 4);
  }
  if (typeof value !== "object") return [];
  const row = value as Record<string, unknown>;
  const out: string[] = [];
  for (const key of ["message", "msg", "detail", "error", "error_description", "description"]) {
    if (key in row) out.push(...textsFrom(row[key], depth + 1));
  }
  return out.slice(0, 4);
}

function codeOf(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const row = value as Record<string, unknown>;
  const nested = row.error && typeof row.error === "object" ? (row.error as Record<string, unknown>) : null;
  const code = row.code ?? row.type ?? nested?.code ?? nested?.type;
  return typeof code === "string" ? code : "";
}

function hint(code: string, text: string, status: number): string | null {
  const blob = `${code} ${text}`.toLowerCase();
  if (/invalid[_\s-]?api[_\s-]?key|incorrect api key|invalid token|authentication|unauthorized|permission denied/.test(blob) || status === 401) {
    return "Ключ не принят. Проверьте его в настройках.";
  }
  if (/insufficient[_\s-]?quota|billing|payment required|credit/.test(blob) || status === 402) {
    return "У ключа закончилась квота.";
  }
  if (/rate[_\s-]?limit|too many requests|tokens per min/.test(blob) || status === 429) {
    return "Попробуйте через минуту";
  }
  if (
    /unknown model|invalid model|no such model|model[_\s-]?not[_\s-]?found/.test(blob) ||
    (/model/.test(blob) && /does not exist|not found/.test(blob))
  ) {
    return "Такой модели нет у провайдера.";
  }
  if (/context.?length|maximum context|too many tokens|context_length|max(?:imum)? tokens/.test(blob)) {
    return "Диалог слишком длинный для модели. Начните новый или сократите историю.";
  }
  if (/content[_\s-]?policy|safety|moderation|flagged/.test(blob)) {
    return "Запрос отклонён правилами провайдера.";
  }
  if (/audio|could not process|invalid file|unsupported (?:media|format|language)/.test(blob)) {
    return "Запись не подошла для расшифровки. Попробуйте ещё раз.";
  }
  if (/timeout|timed out|deadline/.test(blob) || status === 408 || status === 504) {
    return "Провайдер не ответил вовремя.";
  }
  if (/overloaded|capacity|unavailable|bad gateway|server_error/.test(blob) || status === 502 || status === 503) {
    return "Провайдер временно недоступен. Попробуйте ещё раз.";
  }
  if (status === 413 || /request too large|maximum content size|payload too large/.test(blob)) {
    return "Запрос слишком большой.";
  }
  if (status === 404) return "Эндпоинт не найден. Проверьте адрес.";
  return null;
}

function statusLine(status: number): string {
  if (status === 401 || status === 403) return "Ключ отклонён или нет доступа";
  if (status === 404) return "Эндпоинт не найден. Проверьте адрес.";
  if (status === 413) return "Запрос слишком большой.";
  if (status === 422 || status === 400) return "Провайдер не принял запрос.";
  if (status === 429) return "Попробуйте через минуту";
  if (status === 402) return "У ключа закончилась квота.";
  if (status >= 500) return "Провайдер временно недоступен. Попробуйте ещё раз.";
  if (status > 0) return `Провайдер ответил ${status}`;
  return "Провайдер вернул ошибку";
}

function explainParts(status: number, parts: string[], code: string, secret?: string): string {
  const joined = clean(parts.filter(Boolean).join(" "), secret);
  const known = hint(code, joined, status);
  if (known) return known;
  if (!joined || joined.startsWith("<") || /<!doctype|<html/i.test(joined)) return statusLine(status);
  if (joined.length > 180) return statusLine(status);
  return joined;
}

/** User-facing text when a JSON body is an error, otherwise undefined. */
export function readApiFailure(payload: unknown, secret?: string, status = 0): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const row = payload as Record<string, unknown>;
  const marked = (row.error != null && row.error !== false) || typeof row.detail === "string" || Array.isArray(row.detail);
  if (!marked) return undefined;
  const parts = textsFrom(row.error ?? row.detail);
  if (!parts.length && !codeOf(row)) return undefined;
  return explainParts(status, parts, codeOf(row), secret);
}

/** Turn an upstream HTTP error body into one short Russian sentence. */
export function explainApiError(status: number, raw: string, secret?: string): string {
  const text = raw.trim();
  if (!text) return statusLine(status);
  if (text.startsWith("<") || /<!doctype|<html/i.test(text)) return statusLine(status);
  try {
    const json = JSON.parse(text) as unknown;
    const known = readApiFailure(json, secret, status);
    if (known) return known;
    if (json && typeof json === "object") {
      const parts = textsFrom(json);
      if (parts.length) return explainParts(status, parts, codeOf(json), secret);
    }
  } catch {
    /* plain text */
  }
  return explainParts(status, [text], "", secret);
}
