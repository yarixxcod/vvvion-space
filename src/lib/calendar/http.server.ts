import { assertSameSiteRequest, CrossSiteRequestError } from "@/lib/auth/isolation.server";
import { allowPush, pushLimitKey, userIdFromRequest, getPushSettings, sendPush } from "@/lib/social/push.server";
import { inQuietHours } from "@/lib/social/push-policy";
import { formatWhen } from "./time.ts";
import { calendarEventUrl } from "./policy.ts";
import { maySendInQuiet } from "./reminders.ts";
import { parseEventPhrase } from "./parse-nl.ts";
import { runCalendarTool, type ToolApi } from "./tools.ts";
import {
  createCalendar,
  createEvent,
  dueFor,
  extendHorizon,
  fireDue,
  freeSlots,
  getEvent,
  listOccurrences,
  markStatus,
  patchCalendar,
  patchEvent,
  quietOverride,
  readDesk,
  removeCalendar,
  removeEvent,
  savePrefs,
  searchEvents,
} from "./sql.server.ts";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function session(request: Request): Promise<string | Response> {
  try {
    assertSameSiteRequest();
  } catch (err) {
    if (err instanceof CrossSiteRequestError) return json(403, { message: "Forbidden" });
    throw err;
  }
  const userId = await userIdFromRequest(request);
  if (!userId) return json(401, { message: "Нужен аккаунт" });
  return userId;
}

async function readJson(request: Request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 32_000) return json(413, { message: "Слишком большой запрос" });
  try {
    const body = (await request.json()) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) return json(400, { message: "Некорректный запрос" });
    return body as Record<string, unknown>;
  } catch {
    return json(400, { message: "Некорректный запрос" });
  }
}

function fail(error: string) {
  const status = error === "NOT_FOUND" ? 404 : 400;
  return json(status, { message: error === "NOT_FOUND" ? "Не найдено" : error });
}

function errorOf(result: object): string | null {
  const error = (result as { error?: unknown }).error;
  return typeof error === "string" ? error : null;
}

export async function handleCalendarGet(request: Request) {
  const userId = await session(request);
  if (userId instanceof Response) return userId;
  if (!allowPush(pushLimitKey(request, userId, "cal"), 120)) return json(429, { message: "Слишком много запросов" });
  return json(200, await readDesk(userId));
}

export async function handlePrefsPut(request: Request) {
  const userId = await session(request);
  if (userId instanceof Response) return userId;
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const saved = await savePrefs(userId, body);
  const savedError = errorOf(saved);
  if (savedError) return fail(savedError);
  return json(200, saved);
}

export async function handleCalendarPost(request: Request) {
  const userId = await session(request);
  if (userId instanceof Response) return userId;
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const made = await createCalendar(userId, body);
  const madeError = errorOf(made);
  if (madeError) return fail(madeError);
  return json(200, made);
}

export async function handleCalendarPatch(request: Request, id: string) {
  const userId = await session(request);
  if (userId instanceof Response) return userId;
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const saved = await patchCalendar(userId, id, body);
  const savedError = errorOf(saved);
  if (savedError) return fail(savedError);
  return json(200, saved);
}

export async function handleCalendarDelete(request: Request, id: string) {
  const userId = await session(request);
  if (userId instanceof Response) return userId;
  const saved = await removeCalendar(userId, id);
  const savedError = errorOf(saved);
  if (savedError) return fail(savedError);
  return json(200, saved);
}

export async function handleEventsGet(request: Request) {
  const userId = await session(request);
  if (userId instanceof Response) return userId;
  const url = new URL(request.url);
  const listed = await listOccurrences(userId, url.searchParams.get("from") || "", url.searchParams.get("to") || "", url.searchParams.get("calendar_id") || undefined);
  const listedError = errorOf(listed);
  if (listedError) return fail(listedError);
  return json(200, listed);
}

export async function handleEventsPost(request: Request) {
  const userId = await session(request);
  if (userId instanceof Response) return userId;
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const made = await createEvent(userId, body);
  const madeError = errorOf(made);
  if (madeError) return fail(madeError);
  return json(200, made);
}

export async function handleEventGet(request: Request, id: string) {
  const userId = await session(request);
  if (userId instanceof Response) return userId;
  const event = await getEvent(userId, id);
  const eventError = errorOf(event);
  if (eventError) return fail(eventError);
  return json(200, event);
}

export async function handleEventPatch(request: Request, id: string) {
  const userId = await session(request);
  if (userId instanceof Response) return userId;
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const saved = await patchEvent(userId, id, body);
  const savedError = errorOf(saved);
  if (savedError) return fail(savedError);
  return json(200, saved);
}

export async function handleEventDelete(request: Request, id: string) {
  const userId = await session(request);
  if (userId instanceof Response) return userId;
  const url = new URL(request.url);
  const saved = await removeEvent(userId, id, { scope: url.searchParams.get("scope") || undefined, occurrence_at: url.searchParams.get("occurrence") || undefined });
  const savedError = errorOf(saved);
  if (savedError) return fail(savedError);
  return json(200, saved);
}

export async function handleSearch(request: Request) {
  const userId = await session(request);
  if (userId instanceof Response) return userId;
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  if (!q) return json(400, { message: "Пустой запрос" });
  return json(200, { events: await searchEvents(userId, q, url.searchParams.get("from") || undefined, url.searchParams.get("to") || undefined) });
}

export async function handleFree(request: Request) {
  const userId = await session(request);
  if (userId instanceof Response) return userId;
  const url = new URL(request.url);
  const duration = Number(url.searchParams.get("duration_min") || "60");
  const slots = await freeSlots(userId, url.searchParams.get("from") || "", url.searchParams.get("to") || "", duration, url.searchParams.get("tz") || undefined);
  const slotsError = errorOf(slots);
  if (slotsError) return fail(slotsError);
  return json(200, slots);
}

export async function handleParse(request: Request) {
  const userId = await session(request);
  if (userId instanceof Response) return userId;
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const phrase = typeof body.phrase === "string" ? body.phrase.slice(0, 300) : "";
  if (!phrase.trim()) return json(400, { message: "Пустая фраза" });
  const desk = await readDesk(userId);
  return json(200, parseEventPhrase(phrase, new Date(), desk.prefs?.tz));
}

async function deliver(row: { id: string; user_id: string; event_id: string; occurrence_at: Date; fire_at: Date; title: string; tz: string }) {
  const settings = await getPushSettings(row.user_id);
  if (!settings.calendar) {
    await markStatus(row.id, "canceled");
    return;
  }
  const quiet = await quietOverride(row.event_id);
  if (!maySendInQuiet(quiet, inQuietHours(settings))) return;
  if (!(await markStatus(row.id, "sent"))) return;
  const when = formatWhen(new Date(row.occurrence_at), row.tz);
  const minutes = Math.max(0, Math.round((new Date(row.occurrence_at).getTime() - new Date(row.fire_at).getTime()) / 60_000));
  const url = calendarEventUrl(row.event_id);
  await sendPush(row.user_id, "calendar", {
    id: `cal:${row.event_id}:${new Date(row.occurrence_at).toISOString()}`.slice(0, 80),
    title: row.title,
    body: `через ${minutes} мин · ${when}`,
    url,
    ts: Date.now(),
    actions: [{ title: "Открыть", url }],
  }, { ignoreQuiet: quiet });
}

export async function handleCalendarCron(request: Request) {
  try {
    assertSameSiteRequest();
  } catch (err) {
    if (err instanceof CrossSiteRequestError) return json(403, { message: "Forbidden" });
    throw err;
  }
  const secret = process.env.CRON_SECRET?.trim() || process.env.PUSH_CRON_SECRET?.trim() || "";
  if (secret) {
    if (request.headers.get("authorization") !== `Bearer ${secret}`) return json(401, { message: "Unauthorized" });
  } else if (process.env.VERCEL) return json(401, { message: "Unauthorized" });
  const rows = await fireDue();
  for (const row of rows) await deliver(row);
  const now = new Date();
  if (now.getUTCHours() === 3 && now.getUTCMinutes() < 2) await extendHorizon();
  return json(200, { ok: true, sent: rows.length });
}

export async function handleDue(request: Request) {
  const userId = await session(request);
  if (userId instanceof Response) return userId;
  if (!allowPush(pushLimitKey(request, userId, "cal-due"), 80)) return json(429, { message: "Слишком много запросов" });
  const rows = await dueFor(userId);
  return json(200, {
    reminders: rows.map((row) => ({
      id: row.id,
      title: row.title,
      body: formatWhen(new Date(row.occurrenceAt), row.tz),
      url: calendarEventUrl(row.eventId),
    })),
  });
}

export function calendarApi(): ToolApi {
  return {
    list: async (userId, from, to, calendarId) => {
      const listed = await listOccurrences(userId, from, to, calendarId);
      return "events" in listed && listed.events ? listed.events : [];
    },
    search: (userId, query, from, to) => searchEvents(userId, query, from, to),
    create: (userId, input) => createEvent(userId, input),
    update: async (userId, input) => {
      const id = String(input.id || "");
      const saved = await patchEvent(userId, id, input);
      if (errorOf(saved)) return { error: errorOf(saved) || "NOT_FOUND" };
      if ("id" in saved && typeof saved.id === "string" && typeof saved.title === "string" && typeof saved.startsAt === "string" && typeof saved.endsAt === "string" && typeof saved.tz === "string") {
        return { id: saved.id, title: saved.title, startsAt: saved.startsAt, endsAt: saved.endsAt, tz: saved.tz };
      }
      return { error: "NOT_FOUND" };
    },
    remove: (userId, input) => removeEvent(userId, String(input.id || ""), input),
    free: async (userId, from, to, durationMin) => {
      const slots = await freeSlots(userId, from, to, durationMin);
      if (errorOf(slots) || !("windows" in slots)) return [];
      return slots.windows;
    },
  };
}

export function invokeCalendarTool(userId: string, name: string, input: unknown) {
  return runCalendarTool(userId, name, input, calendarApi());
}
