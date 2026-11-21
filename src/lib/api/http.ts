import { errorBody, type ApiDialect } from "./errors";
import { withCors } from "./cors";

export function limitHeaders(limit: number, remaining: number, retryAfter?: number): Record<string, string> {
  const headers: Record<string, string> = {
    "x-ratelimit-limit-requests": String(limit),
    "x-ratelimit-remaining-requests": String(Math.max(0, remaining)),
  };
  if (retryAfter) headers["retry-after"] = String(retryAfter);
  return headers;
}

export function apiJson(status: number, body: unknown, requestId: string, extra?: Record<string, string>): Response {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-request-id": requestId,
  });
  if (extra) for (const [key, value] of Object.entries(extra)) headers.set(key, value);
  return withCors(new Response(JSON.stringify(body), { status, headers }));
}

export function apiError(dialect: ApiDialect, status: number, code: string, requestId: string, message?: string, extra?: Record<string, string>): Response {
  return apiJson(status, errorBody(dialect, code, message), requestId, extra);
}

export function methodNotAllowed(dialect: ApiDialect): Response {
  return apiError(dialect, 405, "invalid_request_error", crypto.randomUUID(), "Method not allowed.");
}
