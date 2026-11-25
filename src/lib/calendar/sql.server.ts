import { getSql } from "@/lib/db";
import { newId } from "@/lib/social/disk";
import { isCalendarColor } from "./colors.ts";
import { deleteMaster, updateMaster, type Master, type Reminder, type Scope } from "./mutate.ts";
import { expandRule } from "./rrule.ts";
import { queueReminders } from "./reminders.ts";
import { freeWindows } from "./free.ts";
import { cleanText, validReminder, validTitle } from "./policy.ts";
import { DEFAULT_TZ, validTz } from "./time.ts";
import type { ToolEvent } from "./tools.ts";

type Row = {
  id: string;
  calendar_id: string;
  user_id: string;
  title: string;
  notes: string;
  location: string;
  starts_at: Date | string;
  ends_at: Date | string;
  all_day: boolean;
  tz: string;
  rrule: string | null;
  exdates: Array<Date | string> | null;
  color: string | null;
};

function iso(value: Date | string) {
  return new Date(value).toISOString();
}

function pgTimes(values: string[]) {
  return `{${values.map((item) => `"${new Date(item).toISOString()}"`).join(",")}}`;
}

function masterFrom(row: Row, reminders: Reminder[]): Master {
  return {
    id: row.id,
    calendarId: row.calendar_id,
    userId: row.user_id,
    title: row.title,
    notes: row.notes,
    location: row.location,
    startsAt: iso(row.starts_at),
    endsAt: iso(row.ends_at),
    allDay: row.all_day,
    tz: row.tz,
    rrule: row.rrule,
    exdates: (row.exdates ?? []).map((item) => iso(item)),
    color: row.color,
    reminders,
  };
}

async function remindersOf(eventId: string): Promise<Reminder[]> {
  const sql = await getSql();
  const rows = await sql<{ minutes_before: number; remind_in_quiet: boolean }>`
    select minutes_before, remind_in_quiet from calendar_reminders where event_id = ${eventId}
  `;
  return rows.map((row) => ({ minutesBefore: row.minutes_before, remindInQuiet: row.remind_in_quiet }));
}

async function readOwned(userId: string, id: string): Promise<Master | null> {
  const sql = await getSql();
  const rows = await sql<Row>`
    select id, calendar_id, user_id, title, notes, location, starts_at, ends_at, all_day, tz, rrule, exdates, color
    from calendar_events where id = ${id} and user_id = ${userId}
  `;
  const row = rows[0];
  if (!row) return null;
  return masterFrom(row, await remindersOf(row.id));
}

async function saveMaster(master: Master) {
  const sql = await getSql();
  const exdates = pgTimes(master.exdates);
  await sql`
    insert into calendar_events (
      id, calendar_id, user_id, title, notes, location, starts_at, ends_at, all_day, tz, rrule, exdates, color, updated_at
    ) values (
      ${master.id}, ${master.calendarId}, ${master.userId}, ${master.title}, ${master.notes}, ${master.location},
      ${master.startsAt}, ${master.endsAt}, ${master.allDay}, ${master.tz}, ${master.rrule}, ${exdates}::timestamptz[], ${master.color}, now()
    )
    on conflict (id) do update set
      calendar_id = ${master.calendarId},
      title = ${master.title},
      notes = ${master.notes},
      location = ${master.location},
      starts_at = ${master.startsAt},
      ends_at = ${master.endsAt},
      all_day = ${master.allDay},
      tz = ${master.tz},
      rrule = ${master.rrule},
      exdates = ${exdates}::timestamptz[],
      color = ${master.color},
      updated_at = now()
  `;
  await sql`delete from calendar_reminders where event_id = ${master.id}`;
  for (const reminder of master.reminders) {
    await sql`
      insert into calendar_reminders (id, event_id, minutes_before, remind_in_quiet)
      values (${newId()}, ${master.id}, ${reminder.minutesBefore}, ${reminder.remindInQuiet})
    `;
  }
  await refill(master);
}

async function refill(master: Master) {
  const sql = await getSql();
  await sql`delete from calendar_reminder_queue where event_id = ${master.id} and status = 'pending'`;
  const items = queueReminders({
    startsAt: new Date(master.startsAt),
    endsAt: new Date(master.endsAt),
    tz: master.tz,
    rrule: master.rrule,
    exdates: master.exdates.map((item) => new Date(item)),
    reminders: master.reminders,
    now: new Date(),
  });
  for (const item of items) {
    await sql`
      insert into calendar_reminder_queue (id, user_id, event_id, occurrence_at, fire_at, status)
      values (${newId()}, ${master.userId}, ${master.id}, ${item.occurrenceAt}, ${item.fireAt}, 'pending')
      on conflict (event_id, occurrence_at, fire_at) do nothing
    `;
  }
}

export async function ensureCalendar(userId: string) {
  const sql = await getSql();
  await sql`
    insert into calendar_prefs (user_id) values (${userId})
    on conflict (user_id) do nothing
  `;
  const existing = await sql<{ id: string }>`select id from calendars where user_id = ${userId} limit 1`;
  if (!existing[0]) {
    await sql`
      insert into calendars (id, user_id, name, color, tz, is_default)
      values (${newId()}, ${userId}, 'Личный', 'lilac', ${DEFAULT_TZ}, true)
    `;
  }
}

export async function readDesk(userId: string) {
  await ensureCalendar(userId);
  const sql = await getSql();
  const prefs = await sql<{ tz: string; week_starts: number; default_reminder_min: number }>`
    select tz, week_starts, default_reminder_min from calendar_prefs where user_id = ${userId}
  `;
  const calendars = await sql<{ id: string; name: string; color: string; tz: string; is_default: boolean }>`
    select id, name, color, tz, is_default from calendars where user_id = ${userId} order by sort_order, created_at
  `;
  return { prefs: prefs[0], calendars };
}

export async function savePrefs(userId: string, body: Record<string, unknown>) {
  await ensureCalendar(userId);
  const tz = typeof body.tz === "string" ? body.tz : "";
  if (tz && !validTz(tz)) return { error: "Неизвестный часовой пояс" as const };
  const week = body.week_starts === 0 || body.week_starts === 1 ? body.week_starts : null;
  const reminder = Number(body.default_reminder_min);
  if (body.default_reminder_min != null && !validReminder(reminder)) return { error: "Такое напоминание не поддерживается" as const };
  const sql = await getSql();
  const current = await sql<{ tz: string; week_starts: number; default_reminder_min: number }>`
    select tz, week_starts, default_reminder_min from calendar_prefs where user_id = ${userId}
  `;
  const prev = current[0]!;
  await sql`
    update calendar_prefs set
      tz = ${tz || prev.tz},
      week_starts = ${week ?? prev.week_starts},
      default_reminder_min = ${body.default_reminder_min == null ? prev.default_reminder_min : reminder}
    where user_id = ${userId}
  `;
  return readDesk(userId);
}

async function ownedCalendar(userId: string, calendarId: string) {
  const sql = await getSql();
  const rows = await sql<{ id: string; tz: string }>`
    select id, tz from calendars where id = ${calendarId} and user_id = ${userId}
  `;
  return rows[0] ?? null;
}

export async function createCalendar(userId: string, body: Record<string, unknown>) {
  await ensureCalendar(userId);
  const name = validTitle(body.name);
  const color = typeof body.color === "string" && isCalendarColor(body.color) ? body.color : "sage";
  const tz = typeof body.tz === "string" && validTz(body.tz) ? body.tz : DEFAULT_TZ;
  if (!name) return { error: "Нужно название" as const };
  if (typeof body.tz === "string" && !validTz(body.tz)) return { error: "Неизвестный часовой пояс" as const };
  const sql = await getSql();
  const id = newId();
  await sql`
    insert into calendars (id, user_id, name, color, tz) values (${id}, ${userId}, ${name}, ${color}, ${tz})
  `;
  return { id, name, color, tz };
}

export async function patchCalendar(userId: string, id: string, body: Record<string, unknown>) {
  const sql = await getSql();
  const rows = await sql<{ id: string }>`select id from calendars where id = ${id} and user_id = ${userId}`;
  if (!rows[0]) return { error: "NOT_FOUND" as const };
  const name = body.name == null ? null : validTitle(body.name);
  if (body.name != null && !name) return { error: "Нужно название" as const };
  if (typeof body.color === "string" && !isCalendarColor(body.color)) return { error: "Неизвестный цвет" as const };
  if (typeof body.tz === "string" && !validTz(body.tz)) return { error: "Неизвестный часовой пояс" as const };
  if (name) await sql`update calendars set name = ${name} where id = ${id} and user_id = ${userId}`;
  if (typeof body.color === "string") await sql`update calendars set color = ${body.color} where id = ${id} and user_id = ${userId}`;
  if (typeof body.tz === "string") await sql`update calendars set tz = ${body.tz} where id = ${id} and user_id = ${userId}`;
  return { ok: true as const };
}

export async function removeCalendar(userId: string, id: string) {
  const sql = await getSql();
  const rows = await sql<{ id: string }>`select id from calendars where user_id = ${userId}`;
  if (!rows.some((row) => row.id === id)) return { error: "NOT_FOUND" as const };
  if (rows.length < 2) return { error: "Последний календарь нельзя удалить" as const };
  await sql`delete from calendars where id = ${id} and user_id = ${userId}`;
  return { ok: true as const };
}

function occurrences(master: Master, from: Date, to: Date): ToolEvent[] {
  const spans = expandRule({
    startsAt: new Date(master.startsAt),
    endsAt: new Date(master.endsAt),
    tz: master.tz,
    rrule: master.rrule,
    exdates: master.exdates.map((item) => new Date(item)),
    from,
    to,
  });
  if ("error" in spans) return [];
  return spans.map((span) => ({
    id: master.id,
    title: master.title,
    startsAt: span.startsAt.toISOString(),
    endsAt: span.endsAt.toISOString(),
    tz: master.tz,
    allDay: master.allDay,
    location: master.location,
    notes: master.notes,
    rrule: master.rrule,
    color: master.color,
    calendarId: master.calendarId,
  }));
}

async function mastersBetween(userId: string, from: Date, to: Date, calendarId?: string) {
  const sql = await getSql();
  const rows = await sql<Row>`
    select id, calendar_id, user_id, title, notes, location, starts_at, ends_at, all_day, tz, rrule, exdates, color
    from calendar_events
    where user_id = ${userId}
      and (${calendarId ?? null}::text is null or calendar_id = ${calendarId ?? null})
      and (rrule is not null or (starts_at < ${to.toISOString()} and ends_at > ${from.toISOString()}))
  `;
  const out: Master[] = [];
  for (const row of rows) out.push(masterFrom(row, await remindersOf(row.id)));
  return out;
}

export async function listOccurrences(userId: string, from: string, to: string, calendarId?: string) {
  const start = new Date(from);
  const end = new Date(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return { error: "Некорректный интервал" as const };
  if (end.getTime() - start.getTime() > 92 * 86_400_000) return { error: "Слишком длинный интервал" as const };
  const rows = await mastersBetween(userId, start, end, calendarId);
  return { events: rows.flatMap((master) => occurrences(master, start, end)) };
}

function reminderInput(value: unknown, fallback: number): Reminder[] | { error: string } {
  if (value == null) return [{ minutesBefore: fallback, remindInQuiet: false }];
  if (!Array.isArray(value)) return { error: "Такое напоминание не поддерживается" };
  const reminders: Reminder[] = [];
  for (const item of value) {
    const minutes = typeof item === "number" ? item : Number((item as { minutes_before?: unknown })?.minutes_before);
    const quiet = typeof item === "object" && item != null && (item as { remind_in_quiet?: unknown }).remind_in_quiet === true;
    if (!validReminder(minutes)) return { error: "Такое напоминание не поддерживается" };
    reminders.push({ minutesBefore: minutes, remindInQuiet: quiet });
  }
  return reminders;
}

export async function createEvent(userId: string, body: Record<string, unknown>) {
  await ensureCalendar(userId);
  const title = validTitle(body.title);
  if (!title) return { error: "Нужно название" as const };
  const sql = await getSql();
  const prefs = await sql<{ tz: string; default_reminder_min: number }>`
    select tz, default_reminder_min from calendar_prefs where user_id = ${userId}
  `;
  const pref = prefs[0]!;
  let calendarId = typeof body.calendar_id === "string" ? body.calendar_id : "";
  if (!calendarId) {
    const def = await sql<{ id: string }>`select id from calendars where user_id = ${userId} order by is_default desc limit 1`;
    calendarId = def[0]?.id || "";
  }
  const calendar = await ownedCalendar(userId, calendarId);
  if (!calendar) return { error: "NOT_FOUND" as const };
  const tz = typeof body.tz === "string" ? body.tz : calendar.tz || pref.tz || DEFAULT_TZ;
  if (!validTz(tz)) return { error: "Неизвестный часовой пояс" as const };
  const starts = new Date(String(body.starts_at || ""));
  if (Number.isNaN(starts.getTime())) return { error: "Некорректное время" as const };
  const ends = body.ends_at ? new Date(String(body.ends_at)) : new Date(starts.getTime() + 3_600_000);
  if (Number.isNaN(ends.getTime()) || ends <= starts) return { error: "Некорректное время" as const };
  if (typeof body.rrule === "string" && body.rrule) {
    const { parseRrule } = await import("./rrule.ts");
    const rule = parseRrule(body.rrule);
    if (rule && "error" in rule) return { error: "Повтор не поддерживается" as const };
  }
  const reminders = reminderInput(body.reminders, pref.default_reminder_min);
  if ("error" in reminders) return reminders;
  const master: Master = {
    id: newId(),
    calendarId,
    userId,
    title,
    notes: cleanText(body.notes, 4000),
    location: cleanText(body.location, 300),
    startsAt: starts.toISOString(),
    endsAt: ends.toISOString(),
    allDay: body.all_day === true,
    tz,
    rrule: typeof body.rrule === "string" && body.rrule ? body.rrule : null,
    exdates: [],
    color: typeof body.color === "string" && isCalendarColor(body.color) ? body.color : null,
    reminders,
  };
  await saveMaster(master);
  return { id: master.id, title: master.title, startsAt: master.startsAt, endsAt: master.endsAt, tz: master.tz, allDay: master.allDay };
}

export async function getEvent(userId: string, id: string) {
  const master = await readOwned(userId, id);
  if (!master) return { error: "NOT_FOUND" as const };
  return master;
}

function scopeOf(value: unknown, repeating: boolean): Scope | { error: string } {
  if (!repeating) return "all";
  if (value === "this" || value === "this_and_future" || value === "all") return value;
  return { error: "Для повтора нужен scope" };
}

export async function patchEvent(userId: string, id: string, body: Record<string, unknown>) {
  const master = await readOwned(userId, id);
  if (!master) return { error: "NOT_FOUND" as const };
  const scope = scopeOf(body.scope, Boolean(master.rrule));
  if (typeof scope === "object" && "error" in scope) return scope;
  const patch: Partial<Master> = {};
  if (body.title != null) {
    const title = validTitle(body.title);
    if (!title) return { error: "Нужно название" as const };
    patch.title = title;
  }
  if (typeof body.notes === "string") patch.notes = cleanText(body.notes, 4000);
  if (typeof body.location === "string") patch.location = cleanText(body.location, 300);
  if (typeof body.starts_at === "string") patch.startsAt = new Date(body.starts_at).toISOString();
  if (typeof body.ends_at === "string") patch.endsAt = new Date(body.ends_at).toISOString();
  if (typeof body.tz === "string") {
    if (!validTz(body.tz)) return { error: "Неизвестный часовой пояс" as const };
    patch.tz = body.tz;
  }
  if (body.reminders != null) {
    const reminders = reminderInput(body.reminders, 15);
    if ("error" in reminders) return reminders;
    patch.reminders = reminders;
  }
  const next = updateMaster(master, scope, patch, typeof body.occurrence_at === "string" ? body.occurrence_at : master.startsAt, newId());
  for (const item of next.keep) await saveMaster(item);
  for (const drop of next.drop) await dropEvent(userId, drop);
  const saved = next.keep[0];
  return saved ? { id: saved.id, title: saved.title, startsAt: saved.startsAt, endsAt: saved.endsAt, tz: saved.tz } : { ok: true as const };
}

async function dropEvent(userId: string, id: string) {
  const sql = await getSql();
  await sql`delete from calendar_events where id = ${id} and user_id = ${userId}`;
}

export async function removeEvent(userId: string, id: string, body: Record<string, unknown>) {
  const master = await readOwned(userId, id);
  if (!master) return { error: "NOT_FOUND" as const };
  const scope = scopeOf(body.scope, Boolean(master.rrule));
  if (typeof scope === "object" && "error" in scope) return scope;
  const next = deleteMaster(master, scope, typeof body.occurrence_at === "string" ? body.occurrence_at : master.startsAt);
  for (const item of next.keep) await saveMaster(item);
  for (const drop of next.drop) await dropEvent(userId, drop);
  return { ok: true as const, id };
}

export async function searchEvents(userId: string, query: string, from?: string, to?: string) {
  const sql = await getSql();
  const q = `%${query.slice(0, 80).replace(/[%_]/g, "")}%`;
  const rows = await sql<Row>`
    select id, calendar_id, user_id, title, notes, location, starts_at, ends_at, all_day, tz, rrule, exdates, color
    from calendar_events
    where user_id = ${userId} and (title ilike ${q} or notes ilike ${q} or location ilike ${q})
    order by starts_at desc
    limit 40
  `;
  const start = from ? new Date(from) : new Date(Date.now() - 86_400_000);
  const end = to ? new Date(to) : new Date(Date.now() + 92 * 86_400_000);
  const events: ToolEvent[] = [];
  for (const row of rows) events.push(...occurrences(masterFrom(row, []), start, end));
  return events;
}

export async function freeSlots(userId: string, from: string, to: string, durationMin: number, tz?: string) {
  const listed = await listOccurrences(userId, from, to);
  if ("error" in listed) return listed;
  const gaps = freeWindows(
    listed.events.map((item) => ({ startsAt: new Date(item.startsAt), endsAt: new Date(item.endsAt) })),
    new Date(from),
    new Date(to),
    durationMin,
  );
  return { tz: tz && validTz(tz) ? tz : DEFAULT_TZ, windows: gaps.map((gap) => ({ startsAt: gap.startsAt.toISOString(), endsAt: gap.endsAt.toISOString() })) };
}

export async function dueFor(userId: string) {
  const sql = await getSql();
  const rows = await sql<{ id: string; event_id: string; occurrence_at: Date; fire_at: Date; title: string; tz: string }>`
    select q.id, q.event_id, q.occurrence_at, q.fire_at, e.title, e.tz
    from calendar_reminder_queue q
    join calendar_events e on e.id = q.event_id and e.user_id = q.user_id
    where q.user_id = ${userId} and q.status = 'pending' and q.fire_at <= now()
    order by q.fire_at
    limit 10
  `;
  const sent = [];
  for (const row of rows) {
    const claimed = await sql<{ id: string }>`
      update calendar_reminder_queue set status = 'sent' where id = ${row.id} and status = 'pending' returning id
    `;
    if (!claimed[0]) continue;
    sent.push({
      id: `cal:${row.event_id}:${iso(row.occurrence_at)}`.slice(0, 80),
      eventId: row.event_id,
      title: row.title,
      tz: row.tz,
      occurrenceAt: iso(row.occurrence_at),
    });
  }
  return sent;
}

export async function fireDue(limit = 40) {
  const sql = await getSql();
  return sql<{ id: string; user_id: string; event_id: string; occurrence_at: Date; fire_at: Date; title: string; tz: string }>`
    select q.id, q.user_id, q.event_id, q.occurrence_at, q.fire_at, e.title, e.tz
    from calendar_reminder_queue q
    join calendar_events e on e.id = q.event_id and e.user_id = q.user_id
    where q.status = 'pending' and q.fire_at <= now()
    order by q.fire_at
    limit ${limit}
  `;
}

export async function quietOverride(eventId: string) {
  const sql = await getSql();
  const rows = await sql<{ ok: boolean }>`
    select true as ok from calendar_reminders where event_id = ${eventId} and remind_in_quiet = true limit 1
  `;
  return Boolean(rows[0]);
}

export async function markStatus(id: string, status: "sent" | "canceled") {
  const sql = await getSql();
  const rows = await sql<{ id: string }>`
    update calendar_reminder_queue set status = ${status} where id = ${id} and status = 'pending' returning id
  `;
  return Boolean(rows[0]);
}

export async function extendHorizon() {
  const sql = await getSql();
  const rows = await sql<Row>`
    select id, calendar_id, user_id, title, notes, location, starts_at, ends_at, all_day, tz, rrule, exdates, color
    from calendar_events
    where rrule is not null or starts_at > now() - interval '1 day'
    limit 200
  `;
  for (const row of rows) await refill(masterFrom(row, await remindersOf(row.id)));
}
