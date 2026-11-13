import { mcpUrlsOf, prepareMcp } from "@/lib/ai/mcp.server";
import { isBlockedHost, publicFetch } from "@/lib/security/net-guard";
import { ownedPersonaPrompt } from "@/lib/social/personas";
import { enforceDailyLimit } from "@/lib/social/limits";
import { finishCloudReply } from "@/lib/ai/cloud";
import { waitUntil } from "@vercel/functions";
import { assertDiskRoom, storeDiskImage } from "@/lib/social/disk";
import { getSql } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/verify.server";
import { assertBuiltinChat, loadAccess } from "@/lib/social/access";
import { explainApiError, readApiFailure } from "@/lib/ai/api-error";
import { ACCOUNT_REQUIRED_MESSAGE } from "@/lib/ai/guest-limit";
import { peekGuest, takeGuestQuestion, withGuestCookie } from "@/lib/ai/guest.server";
import { extractPieces, reasoningFields, softenReasoning, ThinkGate } from "@/lib/ai/reasoning";
import { formatSearch, searchQuery, searchWeb } from "@/lib/ai/search.server";
import { isSearchEngine } from "@/lib/ai/search-engine";
import type { ChatPart, Source, Usage } from "@/lib/ai/types";

type HeaderIn = { name?: string; value?: string };
type MessageIn = { role?: string; content?: unknown; reasoning?: string };
type ChatBody = {
  kind?: unknown;
  mode?: unknown;
  model?: unknown;
  messages?: unknown;
  systemPrompt?: unknown;
  temperature?: unknown;
  maxTokens?: unknown;
  baseUrl?: unknown;
  apiKey?: unknown;
  chatPath?: unknown;
  extraHeaders?: unknown;
  webSearch?: unknown;
  searchEngine?: unknown;
  reasoning?: unknown;
  imageModel?: unknown;
  chatId?: unknown;
  track?: unknown;
  personaId?: unknown;
  toolNote?: unknown;
  mcp?: unknown;
};
type ModelsBody = { kind?: unknown; baseUrl?: unknown; apiKey?: unknown; extraHeaders?: unknown };
type CatalogProvider = { baseUrl: string; apiKey: string; model: string };
type CatalogChat = { prompt: string; providers: CatalogProvider[] };

var BUILTIN_BASE = "https://api.x.ai/v1";
var BUILTIN_IMAGE_MODEL = "grok-imagine-image";
var WINDOW_MS = 6e5;
var buckets = /* @__PURE__ */ new Map();
var STOP_TTL = 15 * 60 * 1000;
var chatStops = /* @__PURE__ */ new Map();
var chatRuns = /* @__PURE__ */ new Map();
function chatRunKey(userId: string, chatId: string) {
	return `${userId}:${chatId}`;
}
function rememberStop(userId: string, chatId: string) {
	const key = chatRunKey(userId, chatId);
	chatStops.set(key, Date.now() + STOP_TTL);
	const run = chatRuns.get(key);
	if (run) run.abort();
}
function takeStop(userId: string, chatId: string) {
	const key = chatRunKey(userId, chatId);
	const exp = chatStops.get(key);
	if (!exp) return false;
	chatStops.delete(key);
	return Date.now() <= exp;
}
function readTrack(body: ChatBody) {
	const track = body.track;
	if (!track || typeof track !== "object") return null;
	const raw = track as { chatId?: unknown; messageId?: unknown };
	const chatId = typeof raw.chatId === "string" ? raw.chatId : "";
	const messageId = typeof raw.messageId === "string" ? raw.messageId : "";
	if (!/^[A-Za-z0-9-]{8,80}$/.test(chatId) || !/^[A-Za-z0-9-]{8,80}$/.test(messageId)) return null;
	return { chatId, messageId };
}
function blankSink() {
	return { text: "", reason: "", error: "", imageUrl: "", truncated: false };
}
function armRun(userId: string | null, track: { chatId: string } | null, request: Request, timeoutMs: number) {
	const timeout = AbortSignal.timeout(timeoutMs);
	if (!userId || !track) return AbortSignal.any([request.signal, timeout]);
	const controller = new AbortController();
	chatRuns.set(chatRunKey(userId, track.chatId), controller);
	return AbortSignal.any([controller.signal, timeout]);
}
function disarmRun(userId: string | null, track: { chatId: string } | null) {
	if (!userId || !track) return;
	chatRuns.delete(chatRunKey(userId, track.chatId));
}
function settleReply(request: Request, userId: string | null, track: { chatId: string; messageId: string } | null, sink: { text: string; reason: string; error: string; imageUrl: string; truncated: boolean }, clientGone = false) {
	disarmRun(userId, track);
	if (!userId || !track) return Promise.resolve();
	const stopped = takeStop(userId, track.chatId);
	const content = sink.text.trim();
	const reasoning = sink.reason.trim();
	const error = sink.error.trim();
	if (!content && !reasoning && !error && !sink.imageUrl) return Promise.resolve();
	const left = clientGone || request.signal.aborted;
	const saved = finishCloudReply(userId, track.chatId, track.messageId, {
		content,
		reasoning,
		error,
		imageUrl: sink.imageUrl,
		live: false,
		sync: 2_000_000_000,
		unread: left && !stopped,
		stopped
	}).catch(() => undefined);
	if (!stopped) {
		void saved.then(() =>
			import("@/lib/social/push.server")
				.then((mod) => {
					const failed = Boolean(error) && !content && !sink.imageUrl;
					if (failed) return mod.pushAiFail(userId, track.chatId, track.messageId, left);
					return mod.pushAiReady(userId, track.chatId, track.messageId, left);
				})
				.catch(() => undefined),
		);
	}
	return saved;
}
function keep(work: Promise<unknown>, request?: Request) {
	const pending = work.catch(() => undefined);
	const host = request as (Request & { waitUntil?: (promise: Promise<unknown>) => void }) | undefined;
	try {
		host?.waitUntil?.(pending);
	} catch {
		/* this host has no request.waitUntil */
	}
	try {
		waitUntil(pending);
	} catch {
		/* the runtime has no vercel context */
	}
	return pending;
}
function holdStream(stream: ReadableStream<Uint8Array>, request: Request, userId: string | null, track: { chatId: string; messageId: string } | null, sink: ReturnType<typeof blankSink>) {
	let release = () => {};
	const done = new Promise<void>((resolve) => {
		release = resolve;
	});
	keep(done, request);
	let clientGone = false;
	const markGone = () => {
		clientGone = true;
	};
	const [forKeep, forClient] = stream.tee();
	let sync = 0;
	let lastFlush = 0;
	let tail = Promise.resolve();
	const checkpoint = () => {
		if (!userId || !track) return;
		if (!sink.text && !sink.reason && !sink.imageUrl) return;
		const now = Date.now();
		if (now - lastFlush < 2000) return;
		lastFlush = now;
		sync += 1;
		const mine = sync;
		const snap = { content: sink.text, reasoning: sink.reason, imageUrl: sink.imageUrl };
		tail = tail.then(() => finishCloudReply(userId, track.chatId, track.messageId, {
			...snap,
			live: true,
			sync: mine,
			unread: true
		})).catch(() => undefined);
	};
	void (async () => {
		const reader = forKeep.getReader();
		try {
			while (true) {
				const { done: end } = await reader.read();
				checkpoint();
				if (end) break;
			}
		} catch {
			markGone();
		} finally {
			void tail.then(() => settleReply(request, userId, track, sink, clientGone)).finally(release);
		}
	})();
	return drainToClient(forClient, markGone);
}
function drainToClient(stream: ReadableStream<Uint8Array>, onGone: () => void) {
	return new ReadableStream({
		async start(controller) {
			const reader = stream.getReader();
			let gone = false;
			try {
				while (true) {
					const { done: end, value } = await reader.read();
					if (end) break;
					if (gone || !value) continue;
					try {
						controller.enqueue(value);
					} catch {
						gone = true;
						onGone();
					}
				}
				if (!gone) try { controller.close(); } catch { /* the visitor already left */ }
			} catch {
				onGone();
				try { controller.close(); } catch { /* the visitor already left */ }
			}
		},
		cancel() {
			onGone();
		}
	});
}
async function resolveBuiltinImageModel(value: unknown) {
	const rows = await (await getSql())<{ name: string; base_url: string | null; api_key: string | null }>`
    select name, base_url, api_key from image_models order by created_at asc, name asc
  `;
	const clean = rows.filter((row) => /^[A-Za-z0-9._:/-]+$/.test(row.name));
	const asked = typeof value === "string" ? value.trim() : "";
	const row = clean.find((item) => item.name === asked) || clean[0];
	return {
		name: row?.name || BUILTIN_IMAGE_MODEL,
		baseUrl: row?.base_url?.trim() || BUILTIN_BASE,
		apiKey: row?.api_key?.trim() || process.env.XAI_API_KEY || ""
	};
}
async function handleStop(request: Request, body: ChatBody) {
	const user = await getSessionUser();
	if (!user) return json(401, { message: "Нужно войти" });
	const chatId = typeof body.chatId === "string" ? body.chatId : "";
	if (!/^[A-Za-z0-9-]{8,80}$/.test(chatId)) return json(400, { message: "Диалог не найден" });
	rememberStop(user.id, chatId);
	return json(200, { ok: true });
}
function json(status: any,  body: any) {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"content-type": "application/json; charset=utf-8",
			"cache-control": "no-store"
		}
	});
}
function clientIp(request: Request) {
	const xf = request.headers.get("x-forwarded-for");
	if (xf) return xf.split(",")[0]?.trim().slice(0, 80) || "local";
	return "local";
}
function allow(ip: any,  limit: any) {
	const now = Date.now();
	const bucket = buckets.get(ip);
	if (!bucket || now > bucket.reset) {
		buckets.set(ip, {
			n: 1,
			reset: now + WINDOW_MS
		});
		return true;
	}
	if (bucket.n >= limit) return false;
	bucket.n += 1;
	return true;
}
function sanitize(text: string, secret?: string) {
	let out = text.replace(/\s+/g, " ").trim().slice(0, 700);
	if (secret && secret.length > 6) out = out.split(secret).join("•••");
	out = out.replace(/Bearer\s+\S+/gi, "Bearer •••");
	out = out.replace(/\bsk-[A-Za-z0-9_\-]{6,}\b/g, "sk-•••");
	out = out.replace(/\bxai-[A-Za-z0-9_\-]{6,}\b/g, "xai-•••");
	return out || "Провайдер вернул ошибку";
}
function blockedHost(hostname: string) {
	return isBlockedHost(hostname);
}
function publicBase(raw: string) {
	let url;
	try {
		url = new URL(raw);
	} catch {
		throw new Error("Некорректный Base URL");
	}
	if (url.protocol !== "https:") throw new Error("Разрешён только HTTPS");
	if (url.username || url.password) throw new Error("Не кладите ключ в адрес");
	if (blockedHost(url.hostname)) throw new Error("Этот адрес недоступен");
	return url;
}
function safePath(path: any,  kind: any) {
	if (!path.startsWith("/") || path.includes("..") || path.includes("://") || path.length > 160) throw new Error("Некорректный путь запроса");
	if (kind === "chat" && !/\/(chat\/completions|completions|responses)$/.test(path)) throw new Error("Путь чата должен заканчиваться на /chat/completions");
	if (kind === "models" && !/\/models$/.test(path)) throw new Error("Путь моделей должен заканчиваться на /models");
	return path;
}
function joinUrl(baseRaw: any,  path: any) {
	return joinParsed(publicBase(baseRaw), path);
}
function adminBase(raw: string) {
	let url;
	try {
		url = new URL(raw);
	} catch {
		throw new Error("Некорректный Base URL");
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Разрешён только HTTP или HTTPS");
	if (url.username || url.password) throw new Error("Не кладите ключ в адрес");
	const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
	if (host === "metadata.google.internal" || host === "169.254.169.254") throw new Error("Этот адрес недоступен");
	return url;
}
function joinParsed(base: any,  path: any) {
	const cleanPath = path.startsWith("/") ? path : `/${path}`;
	const prefix = base.pathname.replace(/\/+$/, "");
	let next = cleanPath;
	if (/\/v1$/i.test(prefix) && /^\/v1(\/|$)/i.test(next)) next = next.replace(/^\/v1/i, "");
	base.pathname = `${prefix}${next}` || "/";
	base.search = "";
	base.hash = "";
	return base.toString();
}
var HOP = /* @__PURE__ */ new Set([
	"host",
	"connection",
	"content-length",
	"transfer-encoding",
	"keep-alive",
	"upgrade",
	"proxy-authorization",
	"proxy-authenticate",
	"te",
	"trailer",
	"authorization"
]);
function extraHeaderList(value: unknown) {
	if (!Array.isArray(value)) return [];
	const out = [];
	for (const item of value.slice(0, 12)) {
		const name = typeof item?.name === "string" ? item.name.trim() : "";
		const headerValue = typeof item?.value === "string" ? item.value.trim() : "";
		if (!name || !headerValue) continue;
		if (!/^[A-Za-z0-9-]{1,64}$/.test(name)) continue;
		if (HOP.has(name.toLowerCase())) continue;
		out.push({
			name,
			value: headerValue.slice(0, 400)
		});
	}
	return out;
}
function asNumber(value: unknown) {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function pickUsage(raw: unknown): Usage | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const usage = raw as Record<string, unknown>;
	const prompt = asNumber(usage.prompt_tokens ?? usage.promptTokens ?? usage.input_tokens);
	const completion = asNumber(usage.completion_tokens ?? usage.completionTokens ?? usage.output_tokens);
	const total = asNumber(usage.total_tokens ?? usage.totalTokens) ?? (prompt != null && completion != null ? prompt + completion : undefined);
	if (prompt == null && completion == null && total == null) return undefined;
	const next: Usage = {};
	if (prompt != null) next.prompt_tokens = prompt;
	if (completion != null) next.completion_tokens = completion;
	if (total != null) next.total_tokens = total;
	const details = usage.completion_tokens_details ?? usage.output_tokens_details;
	if (details && typeof details === "object") {
		const reasoning = asNumber((details as Record<string, unknown>).reasoning_tokens);
		if (reasoning != null) next.reasoning_tokens = reasoning;
	}
	return next;
}
function contentToText(value: unknown) {
	if (typeof value === "string") return value;
	if (!Array.isArray(value)) return "";
	return value.map((part) => {
		if (typeof part === "string") return part;
		if (!part || typeof part !== "object") return "";
		const record = part;
		if (typeof record.text === "string") return record.text;
		if (typeof record.content === "string") return record.content;
		return "";
	}).join("");
}
function splitAnswer(payload: Record<string, unknown>) {
	const pieces = extractPieces(payload);
	const gate = new ThinkGate();
	const split = gate.push(pieces.text);
	const rest = gate.flush();
	return {
		text: `${split.answer}${rest.answer}`,
		reason: `${pieces.reason}${split.reason}${rest.reason}`
	};
}
function toolCallsOf(payload: Record<string, unknown>) {
	const choices = Array.isArray(payload.choices) ? payload.choices : [];
	const first = choices[0];
	const message = first && typeof first === "object" ? (first as { message?: unknown }).message : null;
	const raw = message && typeof message === "object" && Array.isArray((message as { tool_calls?: unknown }).tool_calls) ? (message as { tool_calls: unknown[] }).tool_calls : [];
	const calls: { id: string; name: string; args: string }[] = [];
	for (const item of raw) {
		if (calls.length >= 4) break;
		if (!item || typeof item !== "object") continue;
		const row = item as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
		const name = typeof row.function?.name === "string" ? row.function.name.trim() : "";
		if (!name) continue;
		let args = "{}";
		const value = row.function?.arguments;
		if (typeof value === "string") args = value.slice(0, 4000) || "{}";
		else if (value && typeof value === "object") {
			try {
				args = JSON.stringify(value).slice(0, 4000);
			} catch {
				args = "{}";
			}
		}
		calls.push({
			id: typeof row.id === "string" && row.id.trim() ? row.id.trim().slice(0, 80) : `call_${calls.length}`,
			name: name.slice(0, 80),
			args
		});
	}
	return calls;
}
function extractError(payload: unknown, secret?: string): string | undefined {
	return readApiFailure(payload, secret);
}
function sse(event: any,  data: any) {
	return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
function streamFromText(text: any, usage: any, reason: any, sink: ReturnType<typeof blankSink>) {
	if (reason) sink.reason = String(reason);
	if (text) sink.text = String(text);
	return new ReadableStream({ start(controller) {
		if (reason) controller.enqueue(sse("reason", { text: reason }));
		if (text) controller.enqueue(sse("delta", { text }));
		if (usage) controller.enqueue(sse("usage", { usage }));
		controller.enqueue(sse("done", {}));
		controller.close();
	} });
}
function normalizeSse(upstream: ReadableStream<Uint8Array>, secret: string | undefined, onUsage: ((total: number) => void) | undefined, sink: ReturnType<typeof blankSink>, keepReason = true) {
	const decoder = new TextDecoder();
	const gate = new ThinkGate();
	let buffer = "";
	return new ReadableStream({
		async start(controller) {
			const reader = upstream.getReader();
			let gone = false;
			const push = (event: string, data: unknown) => {
				if (gone) return;
				try {
					controller.enqueue(sse(event, data));
				} catch {
					gone = true;
				}
			};
			const note = (text: string, reason: string) => {
				const split = gate.push(text);
				const traced = keepReason ? `${reason}${split.reason}` : "";
				if (traced) {
					sink.reason = (sink.reason + traced).slice(0, 24000);
					push("reason", { text: traced });
				}
				if (split.answer) {
					sink.text += split.answer;
					push("delta", { text: split.answer });
				}
			};
			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					buffer += decoder.decode(value, { stream: true });
					const lines = buffer.split("\n");
					buffer = lines.pop() ?? "";
					for (const line of lines) {
						const trimmed = line.trim();
						if (!trimmed.startsWith("data:")) continue;
						const payload = trimmed.slice(5).trim();
						if (!payload || payload === "[DONE]") continue;
						try {
							const json = JSON.parse(payload);
							const error = extractError(json, secret);
							if (error) {
								sink.error = sanitize(error, secret).slice(0, 500);
								push("error", { message: sink.error });
							}
							const pieces = extractPieces(json);
							note(pieces.text, pieces.reason);
							const usage = pickUsage(json.usage);
							if (usage) {
								push("usage", { usage });
								if (usage.total_tokens) onUsage?.(usage.total_tokens);
							}
						} catch {}
					}
				}
				const rest = gate.flush();
				if (keepReason && rest.reason) {
					sink.reason = (sink.reason + rest.reason).slice(0, 24000);
					push("reason", { text: rest.reason });
				}
				if (rest.answer) {
					sink.text += rest.answer;
					push("delta", { text: rest.answer });
				}
				push("done", {});
				if (!gone) try { controller.close(); } catch { gone = true; }
			} catch {
				if (!sink.error) sink.error = "Поток прервался";
				push("error", { message: "Поток прервался" });
				push("done", {});
				if (!gone) try { controller.close(); } catch { /* gone */ }
			}
		},
		cancel() {}
	});
}
function sseResponse(stream: ReadableStream<Uint8Array>) {
	return new Response(stream, { headers: {
		"content-type": "text/event-stream; charset=utf-8",
		"cache-control": "no-cache, no-transform",
		"x-accel-buffering": "no"
	} });
}
function readKind(value: unknown): "builtin" | "custom" {
	return value === "custom" ? "custom" : "builtin";
}
function modelName(value: unknown) {
	if (typeof value !== "string") throw new Error("Укажите модель");
	const model = value.trim();
	if (!model || model.length > 120 || !/^[A-Za-z0-9._:/-]+$/.test(model)) throw new Error("Некорректное имя модели");
	return model;
}
async function readJson(request: Request) {
	const raw = await request.text();
	if (raw.length > 5e6) throw new Error("Слишком длинный запрос");
	try {
		return JSON.parse(raw);
	} catch {
		throw new Error("Некорректный JSON");
	}
}
async function loadCatalog(model: string): Promise<CatalogChat> {
	const sql = await getSql();
	const rows = await sql<{ base_url?: string; api_key?: string; system_prompt?: string }>`
    select base_url, api_key, system_prompt from catalog_models where name = ${model}
  `;
	const row = rows[0];
	const extra = await sql<{ base_url?: string; api_key?: string; model_id?: string }>`
    select base_url, api_key, model_id from catalog_providers where model_name = ${model} order by slot asc
  `;
	const providers = (extra.length ? extra : [row]).slice(0, 4).map((item) => ({
		baseUrl: item?.base_url?.trim() || BUILTIN_BASE,
		apiKey: item?.api_key?.trim() || "",
		model: item && "model_id" in item ? item.model_id?.trim() || "" : ""
	}));
	return {
		prompt: row?.system_prompt?.trim().slice(0, 8e3) || "",
		providers
	};
}
function builtinTargets(catalog: CatalogChat | null): { url: string; headers: Headers; secret: string; model: string }[] | Response {
	const list = catalog?.providers?.length ? catalog.providers.slice(0, 4) : [{ baseUrl: BUILTIN_BASE, apiKey: "", model: "" }];
	const targets: { url: string; headers: Headers; secret: string; model: string }[] = [];
	for (const provider of list) {
		let host = "";
		try {
			host = new URL(provider.baseUrl || BUILTIN_BASE).hostname;
		} catch {
			host = "";
		}
		const xai = host === "api.x.ai" || host.endsWith(".x.ai");
		const key = provider.apiKey || (xai ? process.env.XAI_API_KEY || "" : "");
		if (!key) continue;
		const headers = new Headers();
		headers.set("content-type", "application/json");
		headers.set("accept", "text/event-stream, application/json");
		headers.set("authorization", `Bearer ${key}`);
		targets.push({
			url: joinParsed(adminBase(provider.baseUrl || BUILTIN_BASE), "/chat/completions"),
			headers,
			secret: key,
			model: provider.model || ""
		});
	}
	if (!targets.length) return json(503, { message: catalog ? "Для этой модели нет ключа" : "Встроенная модель сейчас недоступна" });
	return targets;
}
function imageDataUrl(value: unknown) {
	if (typeof value !== "string") return "";
	const url = value.replace(/\s/g, "");
	const match = /^data:image\/(jpeg|png|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(url);
	if (!match || url.length > 12e5 || match[2].length < 32) return "";
	return url;
}
function normalizeContent(value: any,  cap: any) {
	if (typeof value === "string") return value.slice(0, cap).trim();
	if (!Array.isArray(value)) return "";
	const parts = [];
	let images = 0;
	for (const item of value.slice(0, 8)) {
		if (!item || typeof item !== "object") continue;
		const record = item;
		if (record.type === "text" && typeof record.text === "string") {
			const text = record.text.slice(0, cap).trim();
			if (text) parts.push({
				type: "text",
				text
			});
			continue;
		}
		if (record.type === "image_url" && images < 4) {
			const box = record.image_url;
			const url = imageDataUrl(box?.url);
			if (!url) continue;
			images += 1;
			parts.push({
				type: "image_url",
				image_url: { url }
			});
		}
	}
	if (!parts.length) return "";
	if (parts.length === 1 && parts[0].type === "text") return parts[0].text;
	return parts;
}
function contentHasBody(content: string | ChatPart[]) {
	return typeof content === "string" ? content.length > 0 : content.length > 0;
}
function upstreamErrorMessage(status: number,  text: string,  secret?: string): string {
	return explainApiError(status, text, secret);
}
function hostOf(url: string): string {
	try {
		return new URL(url).hostname;
	} catch {
		return "провайдер";
	}
}
function logUpstream(status: number, url: string, raw: string, secret?: string) {
	let body = raw.replace(/\s+/g, " ").trim();
	if (secret && secret.length > 6) body = body.split(secret).join("•••");
	body = body.replace(/Bearer\s+\S+/gi, "Bearer •••").replace(/\b(?:sk|xai|whsec)-[A-Za-z0-9_\-]{6,}\b/g, "•••").slice(0, 300);
	console.error("[ai] upstream", status, hostOf(url), body);
}
function told(status: number, url: string, raw: string, secret?: string): string {
	const text = status === 429 ? "Попробуйте через минуту" : upstreamErrorMessage(status, raw, secret);
	if (status === 401 || status === 403) return `${text} (${hostOf(url)})`;
	return text;
}
async function pause(ms: number) {
	await new Promise((resolve) => setTimeout(resolve, ms));
}
function lastUserText(body: ChatBody) {
	const messages = Array.isArray(body.messages) ? body.messages : [];
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const item = messages[i];
		if (item?.role === "assistant" || item?.role === "system") continue;
		const text = contentToText(item?.content).trim();
		if (text) return text.slice(0, 4e3);
	}
	return "";
}
function imageModelName(value: unknown) {
	if (typeof value !== "string") return "dall-e-3";
	const model = value.trim();
	if (!model || model.length > 120 || !/^[A-Za-z0-9._:/-]+$/.test(model)) return "dall-e-3";
	return model;
}
function safeImageRef(value: unknown) {
	if (typeof value !== "string") return "";
	const raw = value.trim();
	if (raw.startsWith("data:image/")) return raw.length < 12_000_000 ? raw : "";
	try {
		const url = new URL(raw);
		if (url.protocol !== "https:") return "";
		const href = url.toString();
		return href.length <= 8000 ? href : "";
	} catch {
		return "";
	}
}
function pickImage(payload: Record<string, unknown>) {
	const direct = imageFromRecord(payload);
	if (direct) return direct;
	for (const key of ["data", "images", "output"] as const) {
		const found = imageFromValue(payload[key]);
		if (found) return found;
	}
	return "";
}
function imageFromValue(value: unknown): string {
	if (Array.isArray(value)) {
		for (const item of value) {
			const found = imageFromValue(item);
			if (found) return found;
		}
		return "";
	}
	if (value && typeof value === "object") return imageFromRecord(value as Record<string, unknown>);
	return safeImageRef(value);
}
function imageFromRecord(row: Record<string, unknown>) {
	const rawB64 = row.b64_json ?? row.b64 ?? row.base64;
	const b64 = typeof rawB64 === "string" ? rawB64.replace(/\s+/g, "") : "";
	if (b64.startsWith("data:image/") && b64.length < 12_000_000) return b64;
	if (b64.length > 32 && b64.length < 11_000_000) {
		const mime = typeof row.mime_type === "string" && /^image\/[a-z0-9.+-]+$/i.test(row.mime_type) ? row.mime_type.split(";")[0] : "image/png";
		return `data:${mime};base64,${b64}`;
	}
	for (const key of ["url", "image_url", "image"] as const) {
		const item = row[key];
		const direct = safeImageRef(item);
		if (direct) return direct;
		if (item && typeof item === "object") {
			const boxed = safeImageRef((item as { url?: unknown }).url);
			if (boxed) return boxed;
		}
	}
	return "";
}
function sniffImageMime(bytes: Uint8Array, header: string) {
	const clean = header.split(";")[0]?.trim().toLowerCase() || "";
	if (clean.startsWith("image/")) return clean;
	if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
	if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
	if (bytes[0] === 0x47 && bytes[1] === 0x49) return "image/gif";
	if (bytes[0] === 0x52 && bytes[1] === 0x49) return "image/webp";
	return "";
}
async function inlineImage(url: string, signal: AbortSignal) {
	if (!url.startsWith("https://")) return url;
	let current = url;
	try {
		for (let hop = 0; hop < 3; hop += 1) {
			const parsed = new URL(current);
			if (parsed.protocol !== "https:" || blockedHost(parsed.hostname)) return url;
			const res = await publicFetch(current, { signal }, { hops: 0 });
			if (res.status >= 300 && res.status < 400) {
				const next = res.headers.get("location");
				if (!next) return url;
				current = new URL(next, current).toString();
				continue;
			}
			if (!res.ok) return url;
			const len = Number(res.headers.get("content-length") || 0);
			if (len > 8_000_000) return url;
			const bytes = new Uint8Array(await res.arrayBuffer());
			if (bytes.length < 32 || bytes.length > 8_000_000) return url;
			const mime = sniffImageMime(bytes, res.headers.get("content-type") || "");
			if (!mime) return url;
			return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
		}
	} catch {
		return url;
	}
	return url;
}
function streamFromImage(url: any, caption: any, sink: ReturnType<typeof blankSink>) {
	sink.imageUrl = typeof url === "string" ? url : "";
	if (caption) sink.text = String(caption).slice(0, 12000);
	return new ReadableStream({ start(controller) {
		controller.enqueue(sse("image", { url }));
		if (caption) controller.enqueue(sse("delta", { text: caption }));
		controller.enqueue(sse("done", {}));
		controller.close();
	} });
}
function withLead(stream: any, lead: any) {
	if (!lead) return stream;
	return new ReadableStream({
		async start(controller) {
			let gone = false;
			const push = (chunk: Uint8Array) => {
				if (gone) return;
				try {
					controller.enqueue(chunk);
				} catch {
					gone = true;
				}
			};
			push(lead);
			const reader = stream.getReader();
			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					if (value) push(value);
				}
				if (!gone) try { controller.close(); } catch { gone = true; }
			} catch {
				push(sse("error", { message: "Поток прервался" }));
				push(sse("done", {}));
				if (!gone) try { controller.close(); } catch { /* gone */ }
			}
		},
		cancel() {}
	});
}
function attemptNote(body: ChatBody) {
	return lastUserText(body).replace(/\s+/g, " ").trim().slice(0, 160);
}
async function recordAttempt(row: { userId: string | null; guestId: string | null; model: string; kind: string; mode: string; ok: boolean; note: string; totalTokens?: number }): Promise<string | null> {
	const id = crypto.randomUUID();
	try {
		await (await getSql())`
      insert into chat_attempts (id, user_id, guest_id, model, kind, mode, ok, note, total_tokens)
      values (
        ${id},
        ${row.userId},
        ${row.guestId},
        ${row.model.slice(0, 80)},
        ${row.kind.slice(0, 16)},
        ${row.mode.slice(0, 16)},
        ${row.ok},
        ${row.note.slice(0, 160)},
        ${Math.max(0, Math.round(row.totalTokens ?? 0))}
      )
    `;
		return id;
	} catch (error) {
		console.error("[attempts]", error instanceof Error ? error.message : "insert failed");
		return null;
	}
}
async function storeTokens(id: string | null, total: number) {
	if (!id || !Number.isFinite(total) || total <= 0) return;
	try {
		await (await getSql())`update chat_attempts set total_tokens = ${Math.round(total)} where id = ${id}`;
	} catch (error) {
		console.error("[attempts]", error instanceof Error ? error.message : "token update failed");
	}
}
async function chargeBuiltinGuest(request: Request) {
	const user = await getSessionUser();
	if (user) return {
		seal: null,
		blocked: null,
		userId: user.id,
		guestId: null
	};
	const peek = await peekGuest(request);
	if (!peek.ok) return {
		seal: peek.setCookie,
		blocked: json(403, {
			code: "account_required",
			message: ACCOUNT_REQUIRED_MESSAGE
		}),
		userId: null,
		guestId: peek.id
	};
	return {
		seal: peek.setCookie,
		blocked: null,
		userId: null,
		guestId: peek.id
	};
}
async function commitBuiltinGuest(request: any,  seal: any) {
	const ticket = await takeGuestQuestion(request);
	if (!ticket.ok) return {
		seal: ticket.setCookie ?? seal,
		blocked: json(403, {
			code: "account_required",
			message: ACCOUNT_REQUIRED_MESSAGE
		})
	};
	return {
		seal: ticket.setCookie ?? seal,
		blocked: null
	};
}
export async function handleChat(request: Request): Promise<Response> {
	let guestSeal: string | null = null;
	const seal = (response: Response) => withGuestCookie(response, guestSeal);
	if (!(request.headers.get("content-type") || "").includes("application/json")) return json(415, { message: "Ожидался JSON" });
	let body;
	try {
		body = await readJson(request);
	} catch (error) {
		return json(400, { message: error instanceof Error ? error.message : "Плохой запрос" });
	}
	const kind = readKind(body.kind);
	if (body.mode === "stop") return handleStop(request, body);
	if (body.mode === "image") return handleImage(request, body, kind);
	if (!allow(`${kind}:${clientIp(request)}`, kind === "builtin" ? 24 : 60)) return json(429, { message: "Слишком много запросов. Подождите пару минут." });
	let secret = "";
	let actorUser: string | null = null;
	let track: { chatId: string; messageId: string } | null = null;
	const sink = blankSink();
	try {
		const model = modelName(body.model);
		const catalog = kind === "builtin" ? await loadCatalog(model) : null;
		if (kind === "builtin") await assertBuiltinChat(model);
		const messagesIn: MessageIn[] = Array.isArray(body.messages) ? (body.messages as MessageIn[]) : [];
		const cap = kind === "builtin" ? 24e3 : 48e3;
		const reasoningOn = body.reasoning !== false;
		const messages: Array<{ role: string; content: string | ChatPart[]; reasoning_content?: string }> = messagesIn.slice(-32).map((item) => {
			const role = item.role === "assistant" || item.role === "system" ? item.role : "user";
			const content = normalizeContent(item.content, cap);
			const reasoning = reasoningOn && role === "assistant" && typeof item.reasoning === "string" ? item.reasoning.trim().slice(0, 12e3) : "";
			return reasoning ? {
				role,
				content,
				reasoning_content: reasoning
			} : {
				role,
				content
			};
		}).filter((item) => item.role !== "system" && (contentHasBody(item.content) || "reasoning_content" in item && item.reasoning_content));
		const catalogPrompt = (catalog?.prompt || "").trim();
		const userPrompt = typeof body.systemPrompt === "string" ? body.systemPrompt.trim().slice(0, 8e3) : "";
		const personaId = typeof body.personaId === "string" ? body.personaId.trim() : "";
		let personaText = "";
		if (personaId) {
			const owner = actorUser ? { id: actorUser } : await getSessionUser();
			if (owner) personaText = await ownedPersonaPrompt(owner.id, personaId);
		}
		let system = kind === "builtin" && catalogPrompt ? catalogPrompt : userPrompt;
		if (personaText) system = kind === "builtin" && catalogPrompt ? `${catalogPrompt}\n\n${personaText}` : personaText;
		const toolNote = typeof body.toolNote === "string" ? body.toolNote.trim().slice(0, 4000) : "";
		if (toolNote) system = system ? `${system}\n\n${toolNote}` : toolNote;
		if (system) messages.unshift({
			role: "system",
			content: system.slice(0, 16e3)
		});
		if (!messages.some((item) => item.role === "user")) return json(400, { message: "Нет сообщения для отправки" });
		let sources: Source[] = [];
		if (body.webSearch === true) {
			const rawQuery = contentToText([...messages].reverse().find((item) => item.role === "user")?.content);
			const engine = isSearchEngine(typeof body.searchEngine === "string" ? body.searchEngine : "") ? body.searchEngine : "duck";
			try {
				sources = await searchWeb(searchQuery(rawQuery), engine);
			} catch {
				sources = [];
			}
			const note = formatSearch(sources);
			if (note) {
			const systemIndex = messages.findIndex((item) => item.role === "system");
			if (systemIndex >= 0) messages[systemIndex] = {
				role: "system",
				content: `${contentToText(messages[systemIndex]?.content)}\n\n${note}`.slice(0, 20e3)
			};
			else messages.unshift({
				role: "system",
				content: note
			});
			}
		}
		const lengthRule = "Длина соразмерна вопросу: коротко, если вопрос короткий; развёрнуто — только когда просят объяснить, сравнить, написать код, таблицу или план. Без вступлений, повторов и лишних списков.";
		const systemIndex = messages.findIndex((item) => item.role === "system");
		const currentSystem = systemIndex >= 0 ? contentToText(messages[systemIndex]?.content) : "";
		const withLength = (currentSystem.includes("Длина соразмерна вопросу") ? currentSystem : `${currentSystem ? `${currentSystem}\n\n` : ""}${lengthRule}`).slice(0, 20_000);
		if (systemIndex >= 0) messages[systemIndex] = { role: "system", content: withLength };
		else messages.unshift({ role: "system", content: withLength });
		const temperature = typeof body.temperature === "number" && Number.isFinite(body.temperature) ? Math.min(2, Math.max(0, body.temperature)) : undefined;
		let targets: { url: string; headers: Headers; secret: string; model: string }[];
		if (kind === "builtin") {
			const built = builtinTargets(catalog);
			if (built instanceof Response) return built;
			targets = built;
		} else {
			const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
			secret = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
			if (!secret) return json(400, { message: "Добавьте API-ключ" });
			const headers = new Headers();
			headers.set("content-type", "application/json");
			headers.set("accept", "text/event-stream, application/json");
			headers.set("authorization", `Bearer ${secret}`);
			for (const header of extraHeaderList(body.extraHeaders)) headers.set(header.name, header.value);
			targets = [{
				url: joinUrl(baseUrl, safePath(typeof body.chatPath === "string" && body.chatPath.trim() ? body.chatPath.trim() : "/chat/completions", "chat")),
				headers,
				secret,
				model: ""
			}];
		}
		let guest = false;
		let actorGuest = null;
		if (kind === "builtin") {
			const gate = await chargeBuiltinGuest(request);
			guestSeal = gate.seal;
			actorUser = gate.userId;
			actorGuest = gate.guestId;
			if (gate.blocked) {
				await recordAttempt({
					userId: null,
					guestId: gate.guestId,
					model,
					kind,
					mode: "chat",
					ok: false,
					note: attemptNote(body)
				});
				return seal(gate.blocked);
			}
			guest = actorUser == null;
		} else actorUser = (await getSessionUser())?.id ?? null;
		let limitNotice: { remainingPct: number } | null = null;
		if (kind === "builtin" && actorUser) {
			const limit = await enforceDailyLimit(actorUser);
			if (limit.blocked) {
				await recordAttempt({
					userId: actorUser,
					guestId: null,
					model,
					kind,
					mode: "chat",
					ok: false,
					note: attemptNote(body)
				});
				return seal(json(429, { message: limit.message }));
			}
			if (limit.remainingPct != null && limit.remainingPct <= 50) limitNotice = { remainingPct: limit.remainingPct };
		}
		const payload: Record<string, unknown> = {
			model,
			messages,
			stream: true,
			stream_options: { include_usage: true }
		};
		if (temperature != null) payload.temperature = temperature;
		const canSteer = kind === "builtin" || !reasoningOn || /grok|deepseek|qwen|qwq|\bo[134]\b|gpt-5|reasoner/i.test(model);
		if (canSteer) Object.assign(payload, reasoningFields(model, reasoningOn));
		track = actorUser ? readTrack(body) : null;
		let releaseWork = () => {};
		keep(new Promise<void>((resolve) => {
			releaseWork = resolve;
		}), request);
		try {
		const signal = armRun(actorUser, track, request, 24e4);
		const mcpUrls = mcpUrlsOf(body.mcp);
		if (mcpUrls.length) {
			try {
				const pack = await prepareMcp(mcpUrls);
				const target = targets[0];
				if (pack && target) {
					const wire = messages as Array<{ role: string; content: string | ChatPart[] | null; tool_calls?: unknown; tool_call_id?: string }>;
					let direct: { text: string; reason: string; usage?: Usage } | null = null;
					for (let round = 0; round < 2; round += 1) {
						if (signal.aborted) break;
						const toolPayload: Record<string, unknown> = {
							model: target.model || model,
							messages: wire,
							stream: false,
							tools: pack.tools,
							tool_choice: "auto"
						};
						if (temperature != null) toolPayload.temperature = temperature;
						secret = target.secret;
						const attempt = await callChat(target.url, target.headers, toolPayload, signal, target.secret);
						if (attempt.failed) break;
						const parsed = await attempt.response.json() as Record<string, unknown>;
						if (extractError(parsed, target.secret)) break;
						const parts = splitAnswer(parsed);
						const calls = toolCallsOf(parsed);
						if (!calls.length) {
							if (parts.text.trim() || parts.reason.trim()) direct = { text: parts.text, reason: parts.reason, usage: pickUsage(parsed.usage) };
							break;
						}
						wire.push({
							role: "assistant",
							content: parts.text || "",
							tool_calls: calls.map((call) => ({
								id: call.id,
								type: "function",
								function: { name: call.name, arguments: call.args }
							}))
						});
						for (const call of calls) {
							let args: unknown = {};
							try {
								args = JSON.parse(call.args);
							} catch {
								args = {};
							}
							if (!args || typeof args !== "object" || Array.isArray(args)) args = {};
							const text = await pack.invoke(call.name, args);
							wire.push({ role: "tool", tool_call_id: call.id, content: text });
						}
					}
					if (direct) {
						const modeName = body.webSearch === true ? "web" : "chat";
						if (guest) {
							const spent = await commitBuiltinGuest(request, guestSeal);
							guestSeal = spent.seal;
							if (spent.blocked) {
								disarmRun(actorUser, track);
								return seal(spent.blocked);
							}
						}
						const attemptId = await recordAttempt({
							userId: actorUser,
							guestId: actorGuest,
							model,
							kind,
							mode: modeName,
							ok: true,
							note: attemptNote(body)
						});
						if (direct.usage?.total_tokens) void storeTokens(attemptId, direct.usage.total_tokens);
						let stream = streamFromText(direct.text, direct.usage, reasoningOn ? direct.reason : "", sink);
						if (limitNotice) stream = withLead(stream, sse("limit", limitNotice));
						const lead = body.webSearch === true ? sse("sources", { sources }) : null;
						return seal(sseResponse(holdStream(withLead(stream, lead), request, actorUser, track, sink)));
					}
					if (wire.some((item) => item.role === "tool")) {
						const note = "Ниже результаты инструментов MCP. Ответь пользователю по ним и не выдумывай то, чего в результатах нет.";
						const sys = wire.findIndex((item) => item.role === "system");
						if (sys >= 0) wire[sys] = { role: "system", content: `${contentToText(wire[sys]?.content)}\n\n${note}`.slice(0, 20000) };
						else wire.unshift({ role: "system", content: note });
					}
				}
			} catch (error) {
				if (signal.aborted) throw error;
				console.error("[mcp]", error instanceof Error ? error.message : "skip");
			}
		}
		let upstream: { failed: boolean; response: Response } | null = null;
		for (let i = 0; i < targets.length; i += 1) {
			const target = targets[i];
			const lastOne = i === targets.length - 1;
			secret = target.secret;
			const cap = new AbortController();
			const timer = lastOne ? 0 : setTimeout(() => cap.abort(), 25_000);
			const attemptSignal = lastOne ? signal : AbortSignal.any([signal, cap.signal]);
			try {
				const sent = target.model ? { ...payload, model: target.model } : payload;
				const attempt = await callChat(target.url, target.headers, sent, attemptSignal, target.secret);
				if (!attempt.failed || lastOne) {
					upstream = attempt;
					break;
				}
			} catch (error) {
				if (signal.aborted || lastOne) throw error;
			} finally {
				if (timer) clearTimeout(timer);
			}
		}
		if (!upstream) return seal(json(502, { message: "Провайдер не ответил" }));
		const mode = body.webSearch === true ? "web" : "chat";
		if (upstream.failed) {
			disarmRun(actorUser, track);
			await recordAttempt({
				userId: actorUser,
				guestId: actorGuest,
				model,
				kind,
				mode,
				ok: false,
				note: attemptNote(body)
			});
			return seal(upstream.response);
		}
		if (guest) {
			const spent = await commitBuiltinGuest(request, guestSeal);
			guestSeal = spent.seal;
			if (spent.blocked) {
				disarmRun(actorUser, track);
				await upstream.response.body?.cancel().catch(() => undefined);
				return seal(spent.blocked);
			}
		}
		const lead = body.webSearch === true ? sse("sources", { sources }) : null;
		const type = upstream.response.headers.get("content-type") || "";
		if (!upstream.response.body) {
			disarmRun(actorUser, track);
			await recordAttempt({
				userId: actorUser,
				guestId: actorGuest,
				model,
				kind,
				mode,
				ok: false,
				note: attemptNote(body)
			});
			return seal(json(502, { message: "Пустой ответ провайдера" }));
		}
		const attemptId = await recordAttempt({
			userId: actorUser,
			guestId: actorGuest,
			model,
			kind,
			mode,
			ok: true,
			note: attemptNote(body)
		});
		const remember = (total: number) => {
			void storeTokens(attemptId, total);
		};
		let stream: ReadableStream<Uint8Array>;
		if (type.includes("text/event-stream") || type.includes("text/plain")) {
			stream = normalizeSse(upstream.response.body, secret, remember, sink, reasoningOn);
		} else {
			const parsed = await upstream.response.json();
			const error = extractError(parsed, secret);
			if (error) {
				disarmRun(actorUser, track);
				return seal(json(502, { message: sanitize(error, secret) }));
			}
			const parts = splitAnswer(parsed);
			const usage = pickUsage(parsed.usage);
			if (usage?.total_tokens) remember(usage.total_tokens);
			stream = streamFromText(parts.text, usage, reasoningOn ? parts.reason : "", sink);
		}
		if (limitNotice) stream = withLead(stream, sse("limit", limitNotice));
		const outgoing = holdStream(withLead(stream, lead), request, actorUser, track, sink);
		return seal(sseResponse(outgoing));
		} finally {
			releaseWork();
		}
	} catch (error) {
		disarmRun(actorUser, track);
		const message = error instanceof Error ? error.message : "Не удалось выполнить запрос";
		const stopped = actorUser && track ? takeStop(actorUser, track.chatId) : false;
		if (request.signal.aborted) {
			if (actorUser && track && !stopped) {
				keep(finishCloudReply(actorUser, track.chatId, track.messageId, {
					content: sink.text,
					reasoning: sink.reason,
					error: sink.error || (/timeout|aborted/i.test(message) ? "Провайдер не ответил вовремя" : "Не удалось дождаться ответа"),
					imageUrl: sink.imageUrl,
					live: false,
					sync: 2_000_000_000,
					unread: true
				}), request);
			}
			return seal(new Response(null, { status: 499 }));
		}
		if (/timeout|aborted/i.test(message)) return seal(json(504, { message: "Провайдер не ответил вовремя" }));
		return seal(json(400, { message: sanitize(message, secret) }));
	}
}
async function handleImage(request: Request, body: ChatBody, kind: "builtin" | "custom") {
	let guestSeal: string | null = null;
	const seal = (response: Response) => withGuestCookie(response, guestSeal);
	if (!allow(`image:${kind}:${clientIp(request)}`, kind === "builtin" ? 8 : 20)) return json(429, { message: "Слишком много картинок. Подождите пару минут." });
	let secret = "";
	let userId: string | null = null;
	let track: { chatId: string; messageId: string } | null = null;
	const sink = blankSink();
	let armed = false;
	const drop = () => {
		if (!armed) return;
		armed = false;
		disarmRun(userId, track);
	};
	try {
		const prompt = lastUserText(body);
		if (!prompt) return json(400, { message: "Опишите картинку" });
		const headers = new Headers({
			"content-type": "application/json",
			accept: "application/json"
		});
		let url = "";
		let model = BUILTIN_IMAGE_MODEL;
		let guest = false;
		let guestId = null;
		let imageLimit: { remainingPct: number } | null = null;
		if (kind === "builtin") {
			const picked = await resolveBuiltinImageModel(body.imageModel);
			model = picked.name;
			secret = picked.apiKey;
			if (!secret) return json(503, { message: "Встроенная модель сейчас недоступна" });
			const user = await getSessionUser();
			if (user) {
				userId = user.id;
				if ((await loadAccess(user.id)).banned) return json(403, { message: "Аккаунт заблокирован" });
			} else {
				const gate = await chargeBuiltinGuest(request);
				guestSeal = gate.seal;
				guestId = gate.guestId;
				if (gate.blocked) {
					await recordAttempt({
						userId: null,
						guestId: gate.guestId,
						model,
						kind,
						mode: "image",
						ok: false,
						note: prompt.slice(0, 160)
					});
					return seal(gate.blocked);
				}
				guest = true;
			}
			if (userId) {
				const limit = await enforceDailyLimit(userId);
				if (limit.blocked) return seal(json(429, { message: limit.message }));
				if (limit.remainingPct != null && limit.remainingPct <= 50) imageLimit = { remainingPct: limit.remainingPct };
			}
			url = joinParsed(adminBase(picked.baseUrl || BUILTIN_BASE), "/images/generations");
			headers.set("authorization", `Bearer ${secret}`);
		} else {
			const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
			secret = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
			if (!secret) return json(400, { message: "Добавьте API-ключ" });
			model = imageModelName(body.imageModel);
			url = joinUrl(baseUrl, "/images/generations");
			headers.set("authorization", `Bearer ${secret}`);
			userId = (await getSessionUser())?.id ?? null;
			for (const header of extraHeaderList(body.extraHeaders)) headers.set(header.name, header.value);
		}
		track = userId ? readTrack(body) : null;
		if (userId) {
			const room = await assertDiskRoom(userId);
			if (room) return seal(json(409, { message: room }));
		}
		let releaseWork = () => {};
		keep(new Promise<void>((resolve) => {
			releaseWork = resolve;
		}), request);
		try {
		const signal = armRun(userId, track, request, 24e4);
		armed = true;
		const send = (imagePayload: Record<string, unknown>) => publicFetch(url, {
			method: "POST",
			headers,
			body: JSON.stringify(imagePayload),
			signal
		}, { hops: 0 });
		let res = await send({
			model,
			prompt,
			n: 1,
			response_format: "b64_json"
		});
		if (res.status >= 300 && res.status < 400) {
			drop();
			return seal(json(502, { message: "Провайдер вернул редирект — запрос остановлен" }));
		}
		if (!res.ok) {
			const text = await res.text();
			if (/response_format|b64_json|unknown parameter|unsupported/i.test(text)) res = await send({
				model,
				prompt,
				n: 1
			});
			else {
				drop();
				return seal(json(res.status, { message: upstreamErrorMessage(res.status, text, secret) }));
			}
		}
		if (res.status >= 300 && res.status < 400) {
			drop();
			return seal(json(502, { message: "Провайдер вернул редирект — запрос остановлен" }));
		}
		if (!res.ok) {
			const text = await res.text();
			drop();
			return seal(json(res.status, { message: upstreamErrorMessage(res.status, text, secret) }));
		}
		const parsed = await res.json();
		const failed = extractError(parsed, secret);
		if (failed) {
			drop();
			return seal(json(502, { message: sanitize(failed, secret) }));
		}
		let image = pickImage(parsed);
		if (!image) {
			const again = await send({ model, prompt, n: 1 });
			if (again.ok) {
				const second = await again.json();
				const secondError = extractError(second, secret);
				if (!secondError) image = pickImage(second);
			}
		}
		if (image.startsWith("https://")) image = await inlineImage(image, signal);
		if (!image) {
			drop();
			return seal(json(502, { message: "Провайдер не вернул картинку" }));
		}
		if (userId && image.startsWith("data:image/")) {
			const stored = await storeDiskImage(userId, image);
			if (stored === "full") {
				drop();
				return seal(json(409, { message: "На диске не хватило места под эту картинку." }));
			}
			if (stored) image = stored;
		}
		if (guest) {
			const spent = await commitBuiltinGuest(request, guestSeal);
			guestSeal = spent.seal;
			if (spent.blocked) {
				drop();
				return seal(spent.blocked);
			}
		}
		await recordAttempt({
			userId,
			guestId: userId ? null : guestId,
			model,
			kind,
			mode: "image",
			ok: true,
			note: prompt.slice(0, 160)
		});
		const row = Array.isArray(parsed.data) ? parsed.data[0] : undefined;
		const caption = row && typeof row === "object" && typeof row.revised_prompt === "string" ? row.revised_prompt.trim().slice(0, 500) : "";
		let stream = streamFromImage(image, caption, sink);
		if (imageLimit) stream = withLead(stream, sse("limit", imageLimit));
		armed = false;
		if (userId && track && request.signal.aborted) {
			keep(finishCloudReply(userId, track.chatId, track.messageId, {
				content: caption,
				imageUrl: image,
				live: false,
				sync: 2_000_000_000,
				unread: true
			}), request);
		}
		return seal(sseResponse(holdStream(stream, request, userId, track, sink)));
		} finally {
			releaseWork();
		}
	} catch (error) {
		drop();
		const message = error instanceof Error ? error.message : "Не удалось создать картинку";
		const stopped = userId && track ? takeStop(userId, track.chatId) : false;
		if (request.signal.aborted) {
			if (userId && track && !stopped) {
				keep(finishCloudReply(userId, track.chatId, track.messageId, {
					content: sink.text,
					reasoning: sink.reason,
					error: sink.error || (/timeout|aborted/i.test(message) ? "Картинка не успела сгенерироваться" : "Не удалось дождаться картинки"),
					imageUrl: sink.imageUrl,
					live: false,
					sync: 2_000_000_000,
					unread: true
				}), request);
			}
			return seal(new Response(null, { status: 499 }));
		}
		if (/timeout|aborted/i.test(message)) return seal(json(504, { message: "Картинка не успела сгенерироваться" }));
		return seal(json(400, { message: sanitize(message, secret) }));
	}
}
async function callChat(url: string, headers: Headers, payload: Record<string, unknown>, signal: AbortSignal, secret: string) {
	const send = (body: Record<string, unknown>) => publicFetch(url, {
		method: "POST",
		headers,
		body: JSON.stringify(body),
		signal
	}, { hops: 0 });
	const fail = (response: Response) => ({
		failed: true,
		response
	});
	let res = await send(payload);
	if (res.status >= 300 && res.status < 400) return fail(json(502, { message: "Провайдер вернул редирект — запрос остановлен" }));
	if (res.ok) return {
		failed: false,
		response: res
	};
	let errText = await res.text();
	logUpstream(res.status, url, errText, secret);
	if (res.status === 429) {
		if (!signal.aborted) {
			await pause(1200);
			if (!signal.aborted) {
				res = await send(payload);
				if (res.ok) return { failed: false, response: res };
				if (res.status >= 300 && res.status < 400) return fail(json(502, { message: "Провайдер вернул редирект — запрос остановлен" }));
				errText = await res.text();
				logUpstream(res.status, url, errText, secret);
			}
		}
		return fail(json(res.status, { message: told(res.status, url, errText, secret) }));
	}
	const lower = errText.toLowerCase();
	const retry = { ...payload };
	let changed = false;
	if (lower.includes("temperature") && "temperature" in retry) {
		delete retry.temperature;
		changed = true;
	}
	if ((lower.includes("max_tokens") || lower.includes("max tokens")) && "max_tokens" in retry) {
		const value = retry.max_tokens;
		delete retry.max_tokens;
		if (lower.includes("max_completion_tokens") || lower.includes("unsupported parameter")) retry.max_completion_tokens = value;
		changed = true;
	}
	if (lower.includes("stream_options") && "stream_options" in retry) {
		delete retry.stream_options;
		changed = true;
	}
	if ((lower.includes("reasoning_effort") || lower.includes("reasoning effort") || lower.includes("reasoning_content") || lower.includes("thinking") || lower.includes("enable_thinking")) && softenReasoning(retry, errText)) {
		changed = true;
	}
	if (!changed) return fail(json(res.status, { message: told(res.status, url, errText, secret) }));
	res = await send(retry);
	if (res.status >= 300 && res.status < 400) return fail(json(502, { message: "Провайдер вернул редирект — запрос остановлен" }));
	if (!res.ok) {
		const second = await res.text();
		logUpstream(res.status, url, second, secret);
		return fail(json(res.status, { message: told(res.status, url, second, secret) }));
	}
	return {
		failed: false,
		response: res
	};
}
export async function handleModels(request: Request): Promise<Response> {
	let body;
	try {
		body = await readJson(request);
	} catch (error) {
		return json(400, {
			ok: false,
			models: [],
			message: error instanceof Error ? error.message : "Плохой запрос"
		});
	}
	const kind = readKind(body.kind);
	if (!allow(`models:${kind}:${clientIp(request)}`, 30)) return json(429, {
		ok: false,
		models: [],
		message: "Слишком много проверок. Подождите немного."
	});
	let secret = "";
	try {
		let url;
		const headers = new Headers({ accept: "application/json" });
		if (kind === "builtin") {
			secret = process.env.XAI_API_KEY ?? "";
			if (!secret) return json(503, {
				ok: false,
				models: [],
				message: "Встроенная модель сейчас недоступна"
			});
			url = joinUrl(BUILTIN_BASE, "/models");
			headers.set("authorization", `Bearer ${secret}`);
		} else {
			const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
			secret = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
			if (!secret) return json(400, {
				ok: false,
				models: [],
				message: "Добавьте API-ключ"
			});
			url = joinUrl(baseUrl, "/models");
			headers.set("authorization", `Bearer ${secret}`);
			for (const header of extraHeaderList(body.extraHeaders)) headers.set(header.name, header.value);
		}
		const res = await publicFetch(url, {
			method: "GET",
			headers,
			signal: AbortSignal.timeout(2e4)
		}, { hops: 0 });
		if (res.status >= 300 && res.status < 400) return json(502, {
			ok: false,
			models: [],
			message: "Провайдер вернул редирект — запрос остановлен"
		});
		const text = await res.text();
		if (!res.ok) return json(res.status, {
			ok: false,
			models: [],
			message: upstreamErrorMessage(res.status, text, secret)
		});
		let parsed;
		try {
			parsed = JSON.parse(text);
		} catch {
			return json(502, {
				ok: false,
				models: [],
				message: "Провайдер вернул не JSON"
			});
		}
		const data = parsed.data;
		const models = Array.isArray(data) ? data.map((item) => item && typeof item === "object" ? item.id : undefined).filter((id) => typeof id === "string" && id.length > 0 && id.length < 120).filter((id) => !/imagine|image|video|tts|embed/i.test(id)) : [];
		if (!models.length) return json(200, {
			ok: false,
			models: [],
			message: "Список моделей пуст. Добавьте имя модели вручную."
		});
		return json(200, {
			ok: true,
			models,
			message: `Соединение есть. Моделей: ${models.length}`
		});
	} catch (error) {
		return json(400, {
			ok: false,
			models: [],
			message: sanitize(error instanceof Error ? error.message : "Не удалось проверить подключение", secret)
		});
	}
}
