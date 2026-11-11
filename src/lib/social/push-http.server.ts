import { assertSameSiteRequest, CrossSiteRequestError } from "@/lib/auth/isolation.server";
import {
  allowPush,
  getPushSettings,
  pushLimitKey,
  registerPushToken,
  runSubscriptionReminders,
  savePushSettings,
  touchPresence,
  unregisterPushToken,
  userIdFromRequest,
} from "@/lib/social/push.server";
import { settingsFrom, validPushToken } from "@/lib/social/push-policy";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function guarded(): Response | null {
  try {
    assertSameSiteRequest();
    return null;
  } catch (err) {
    if (err instanceof CrossSiteRequestError) return json(403, { message: "Forbidden" });
    throw err;
  }
}

async function session(request: Request): Promise<string | Response> {
  const blocked = guarded();
  if (blocked) return blocked;
  const userId = await userIdFromRequest(request);
  if (!userId) return json(401, { message: "Нужен аккаунт" });
  return userId;
}

async function readJson(request: Request): Promise<Record<string, unknown> | Response> {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 16_000) return json(413, { message: "Слишком большой запрос" });
  try {
    const body = (await request.json()) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) return json(400, { message: "Некорректный запрос" });
    return body as Record<string, unknown>;
  } catch {
    return json(400, { message: "Некорректный запрос" });
  }
}

export async function handlePushRegister(request: Request) {
  const userId = await session(request);
  if (userId instanceof Response) return userId;
  if (!allowPush(pushLimitKey(request, userId, "register"), 20)) return json(429, { message: "Слишком много запросов" });
  const body = await readJson(request);
  if (body instanceof Response) return body;
  if (body.platform !== "android") return json(400, { message: "Некорректный запрос" });
  if (!validPushToken(body.token)) return json(400, { message: "Некорректный запрос" });
  const version = typeof body.appVersion === "string" ? body.appVersion : "";
  await registerPushToken(userId, body.token, version);
  return json(200, { ok: true });
}

export async function handlePushUnregister(request: Request) {
  const userId = await session(request);
  if (userId instanceof Response) return userId;
  if (!allowPush(pushLimitKey(request, userId, "unregister"), 20)) return json(429, { message: "Слишком много запросов" });
  const body = await readJson(request);
  if (body instanceof Response) return body;
  if (!validPushToken(body.token)) return json(400, { message: "Некорректный запрос" });
  await unregisterPushToken(userId, body.token);
  return json(200, { ok: true });
}

export async function handlePushSettingsGet(request: Request) {
  const userId = await session(request);
  if (userId instanceof Response) return userId;
  if (!allowPush(pushLimitKey(request, userId, "settings"), 60)) return json(429, { message: "Слишком много запросов" });
  return json(200, await getPushSettings(userId));
}

function flag(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

export async function handlePushSettingsPut(request: Request) {
  const userId = await session(request);
  if (userId instanceof Response) return userId;
  if (!allowPush(pushLimitKey(request, userId, "settings"), 60)) return json(429, { message: "Слишком много запросов" });
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const current = await getPushSettings(userId);
  const quietFrom = Number(body.quietFrom);
  const quietTo = Number(body.quietTo);
  const next = settingsFrom({
    messages: flag(body.messages, current.messages),
    ai: flag(body.ai, current.ai),
    subs: flag(body.subs, current.subs),
    money: flag(body.money, current.money),
    security: true,
    system: flag(body.system, current.system),
    preview: flag(body.preview, current.preview),
    quietFrom: Number.isFinite(quietFrom) ? quietFrom : current.quietFrom,
    quietTo: Number.isFinite(quietTo) ? quietTo : current.quietTo,
  });
  await savePushSettings(userId, next);
  return json(200, next);
}

export async function handlePushSeen(request: Request) {
  const userId = await session(request);
  if (userId instanceof Response) return userId;
  if (!allowPush(pushLimitKey(request, userId, "seen"), 120)) return json(429, { message: "Слишком много запросов" });
  await touchPresence(userId);
  return json(200, { ok: true });
}

export async function handlePushCron(request: Request) {
  const blocked = guarded();
  if (blocked) return blocked;
  const secret = process.env.CRON_SECRET?.trim() || process.env.PUSH_CRON_SECRET?.trim() || "";
  if (secret) {
    if (request.headers.get("authorization") !== `Bearer ${secret}`) return json(401, { message: "Unauthorized" });
  } else if (process.env.VERCEL) {
    return json(401, { message: "Unauthorized" });
  }
  if (!allowPush("cron", 4, 60_000)) return json(429, { message: "Слишком много запросов" });
  await runSubscriptionReminders();
  await import("@/lib/social/tips.server")
    .then((mod) => mod.refreshTipsIfDue())
    .catch(() => undefined);
  return json(200, { ok: true });
}
