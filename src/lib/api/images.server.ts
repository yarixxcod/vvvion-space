import {
  IMAGE_WAIT,
  adminBase,
  configuredImageRequest,
  deapiRequestId,
  extractError,
  inlineImage,
  joinParsed,
  pickImage,
  waitForDeapiImage,
} from "@/lib/ai/proxy.server";
import { publicFetch } from "@/lib/security/net-guard";
import { imageModelRow } from "@/lib/api/models.server";

export type ImageResult =
  | { ok: true; b64: string }
  | { ok: false; status: number; code: string; message: string };

function applySize(payload: Record<string, unknown>, size: unknown, model: string, config: Record<string, unknown>) {
  if (typeof size !== "string") return;
  if (config.width !== undefined || config.height !== undefined) return;
  const clean = size.trim();
  if (!/^\d{2,4}x\d{2,4}$/.test(clean)) return;
  payload.size = /qwen/i.test(model) ? clean.replace("x", "*") : clean;
}

function b64Of(image: string): string {
  const match = /^data:[^;]+;base64,([A-Za-z0-9+/=\s]+)$/i.exec(image);
  if (match) return match[1].replace(/\s+/g, "");
  return "";
}

export async function generateApiImage(body: unknown, signal: AbortSignal): Promise<ImageResult> {
  if (!body || typeof body !== "object") return { ok: false, status: 400, code: "invalid_request_error", message: "Body must be a JSON object." };
  const raw = body as Record<string, unknown>;
  const model = typeof raw.model === "string" ? raw.model.trim() : "";
  const prompt = typeof raw.prompt === "string" ? raw.prompt.trim() : "";
  if (!prompt) return { ok: false, status: 400, code: "invalid_request_error", message: "prompt is required." };
  if (prompt.length > 4000) return { ok: false, status: 400, code: "invalid_request_error", message: "prompt is longer than 4000 characters." };
  const n = raw.n == null ? 1 : raw.n;
  if (n !== 1) return { ok: false, status: 400, code: "invalid_request_error", message: "Only one image can be generated per request." };
  if (raw.response_format != null && raw.response_format !== "b64_json") {
    return { ok: false, status: 400, code: "invalid_request_error", message: "Only response_format b64_json is supported." };
  }
  const picked = model ? await imageModelRow(model) : null;
  if (!picked) return { ok: false, status: 404, code: "model_not_found", message: "That model is not available." };
  const config: Record<string, unknown> = { ...picked.requestConfig };
  if (/^https:\/\/api\.deapi\.ai(?:\/|$)/i.test(picked.baseUrl) && config.seed === undefined) config.seed = Math.floor(Math.random() * 2147483647);
  let endpoint = "";
  try {
    endpoint = joinParsed(adminBase(picked.baseUrl), typeof config.path === "string" ? config.path : "/images/generations");
  } catch {
    return { ok: false, status: 502, code: "upstream_error", message: "This model is not available." };
  }
  const payload = configuredImageRequest(picked.name, prompt, config);
  applySize(payload, raw.size, picked.name, config);
  try {
    const res = await publicFetch(endpoint, {
      method: "POST",
      headers: new Headers({ "content-type": "application/json", accept: "application/json", authorization: `Bearer ${picked.apiKey}` }),
      body: JSON.stringify(payload),
      signal,
    }, { hops: 0, timeoutMs: IMAGE_WAIT });
    if (!res.ok) return { ok: false, status: 502, code: "upstream_error", message: "The model returned an error." };
    const parsed = await res.json() as Record<string, unknown>;
    if (extractError(parsed, picked.apiKey)) return { ok: false, status: 502, code: "upstream_error", message: "The model returned an error." };
    let image = pickImage(parsed);
    if (!image && /^https:\/\/api\.deapi\.ai(?:\/|$)/i.test(endpoint)) {
      const requestId = deapiRequestId(parsed);
      if (requestId) image = await waitForDeapiImage(endpoint, requestId, picked.apiKey, signal);
    }
    if (image.startsWith("https://")) image = await inlineImage(image, signal);
    const b64 = b64Of(image);
    if (!b64) return { ok: false, status: 502, code: "upstream_error", message: "The model returned an error." };
    return { ok: true, b64 };
  } catch (error) {
    if (signal.aborted) return { ok: false, status: 504, code: "upstream_timeout", message: "The model timed out." };
    console.error("[api] image", error instanceof Error ? error.name : "failed");
    return { ok: false, status: 502, code: "upstream_error", message: "The model returned an error." };
  }
}
