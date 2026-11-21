export const API_BODY_LIMIT = 4 * 1024 * 1024;

export type BodyResult =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413; code: "invalid_request_error" | "request_too_large"; message: string };

export async function readApiBody(request: Request): Promise<BodyResult> {
  const type = (request.headers.get("content-type") || "").toLowerCase();
  if (type && !type.includes("application/json")) {
    return { ok: false, status: 400, code: "invalid_request_error", message: "Content-Type must be application/json." };
  }
  const declared = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > API_BODY_LIMIT) {
    return { ok: false, status: 413, code: "request_too_large", message: "Request is larger than 4 MB, which is the platform limit." };
  }
  const raw = await request.text();
  if (raw.length > API_BODY_LIMIT) {
    return { ok: false, status: 413, code: "request_too_large", message: "Request is larger than 4 MB, which is the platform limit." };
  }
  try {
    return { ok: true, value: raw ? JSON.parse(raw) : {} };
  } catch {
    return { ok: false, status: 400, code: "invalid_request_error", message: "Body is not valid JSON." };
  }
}
