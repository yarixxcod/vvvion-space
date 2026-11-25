import { calendarEventUrl, cleanText, needsConfirm, validReminder, validTitle } from "./policy.ts";
import { validTz, DEFAULT_TZ } from "./time.ts";

export type ToolEvent = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  tz: string;
  allDay?: boolean;
  location?: string;
  notes?: string;
  rrule?: string | null;
  color?: string | null;
  calendarId?: string;
};

export type ToolApi = {
  list(userId: string, from: string, to: string, calendarId?: string): Promise<ToolEvent[]>;
  search(userId: string, query: string, from?: string, to?: string): Promise<ToolEvent[]>;
  create(userId: string, input: Record<string, unknown>): Promise<ToolEvent | { error: string }>;
  update(userId: string, input: Record<string, unknown>): Promise<ToolEvent | { error: string } | { needs_confirm: true; preview: unknown }>;
  remove(userId: string, input: Record<string, unknown>): Promise<{ ok: true } | { error: string } | { needs_confirm: true; preview: unknown }>;
  free(userId: string, from: string, to: string, durationMin: number, tz?: string): Promise<{ startsAt: string; endsAt: string }[]>;
};

const NAMES = ["calendar_list", "calendar_search", "calendar_create", "calendar_update", "calendar_delete", "calendar_free"] as const;

function tool(name: string, description: string, properties: Record<string, unknown>, required: string[]) {
  return {
    type: "function" as const,
    function: { name, description, parameters: { type: "object", properties, required, additionalProperties: false } },
  };
}

export function calendarToolSchemas() {
  const span = { from: { type: "string" }, to: { type: "string" } };
  return [
    tool("calendar_list", "События календаря этого человека в интервале. Не выдумывай события.", { ...span, calendar_id: { type: "string" }, limit: { type: "integer" } }, ["from", "to"]),
    tool("calendar_search", "Поиск событий по словам в названии, заметке и месте.", { query: { type: "string" }, ...span }, ["query"]),
    tool("calendar_create", "Создать событие. Время без пояса считается в поясе календаря. Не говори, что записал, пока нет ok.", {
      title: { type: "string" },
      starts_at: { type: "string" },
      ends_at: { type: "string" },
      all_day: { type: "boolean" },
      tz: { type: "string" },
      calendar_id: { type: "string" },
      rrule: { type: "string" },
      reminders: { type: "array", items: { type: "integer" } },
      location: { type: "string" },
      notes: { type: "string" },
    }, ["title", "starts_at"]),
    tool("calendar_update", "Изменить событие. Для повтора scope: this, this_and_future или all. all и this_and_future только с confirm:true после согласия человека.", {
      id: { type: "string" },
      scope: { type: "string" },
      confirm: { type: "boolean" },
      occurrence_at: { type: "string" },
      title: { type: "string" },
      starts_at: { type: "string" },
      ends_at: { type: "string" },
    }, ["id"]),
    tool("calendar_delete", "Удалить событие. Всегда сначала без confirm, покажи preview и повтори с confirm:true только после явного согласия.", {
      id: { type: "string" },
      scope: { type: "string" },
      confirm: { type: "boolean" },
      occurrence_at: { type: "string" },
    }, ["id"]),
    tool("calendar_free", "Свободные окна в интервале.", { ...span, duration_min: { type: "integer" }, tz: { type: "string" } }, ["from", "to", "duration_min"]),
  ];
}

export function calendarToolNames() {
  return NAMES;
}

function brief(event: ToolEvent) {
  return { id: event.id, title: event.title, starts_at: event.startsAt, ends_at: event.endsAt, tz: event.tz, url: calendarEventUrl(event.id) };
}

export async function runCalendarTool(userId: string, name: string, raw: unknown, api: ToolApi): Promise<string> {
  const input = raw && typeof raw === "object" ? { ...(raw as Record<string, unknown>) } : {};
  delete input.user_id;
  try {
    if (name === "calendar_list") {
      const from = String(input.from || "");
      const to = String(input.to || "");
      if (!from || !to) return JSON.stringify({ error: "Нужны from и to" });
      const rows = await api.list(userId, from, to, typeof input.calendar_id === "string" ? input.calendar_id : undefined);
      return JSON.stringify({ ok: true, events: rows.slice(0, 40).map(brief) });
    }
    if (name === "calendar_search") {
      const query = cleanText(input.query, 120);
      if (!query) return JSON.stringify({ error: "Пустой запрос" });
      const rows = await api.search(userId, query, typeof input.from === "string" ? input.from : undefined, typeof input.to === "string" ? input.to : undefined);
      return JSON.stringify({ ok: true, events: rows.slice(0, 20).map(brief) });
    }
    if (name === "calendar_create") {
      if (!validTitle(input.title)) return JSON.stringify({ error: "Нужно название" });
      if (typeof input.tz === "string" && !validTz(input.tz)) return JSON.stringify({ error: "Неизвестный часовой пояс" });
      if (!input.tz) input.tz = DEFAULT_TZ;
      const reminders = Array.isArray(input.reminders) ? input.reminders : [];
      if (reminders.some((item) => !validReminder(Number(item)))) return JSON.stringify({ error: "Такое напоминание не поддерживается" });
      const made = await api.create(userId, input);
      if ("error" in made) return JSON.stringify(made);
      return JSON.stringify({ ok: true, ...brief(made) });
    }
    if (name === "calendar_update" || name === "calendar_delete") {
      const id = typeof input.id === "string" ? input.id : "";
      if (!id) return JSON.stringify({ error: "NOT_FOUND" });
      const scope = typeof input.scope === "string" ? input.scope : undefined;
      const confirm = input.confirm === true;
      const action = name === "calendar_delete" ? "delete" : "update";
      if (needsConfirm(action, scope, confirm)) {
        return JSON.stringify({ needs_confirm: true, preview: { id, action, scope: scope ?? "this", title: cleanText(input.title, 200) } });
      }
      const result = name === "calendar_delete" ? await api.remove(userId, input) : await api.update(userId, input);
      if ("error" in result && result.error === "NOT_FOUND") return JSON.stringify({ error: "NOT_FOUND" });
      return JSON.stringify(result);
    }
    if (name === "calendar_free") {
      const duration = Number(input.duration_min);
      if (!Number.isInteger(duration) || duration < 15 || duration > 24 * 60) return JSON.stringify({ error: "Некорректная длительность" });
      const rows = await api.free(userId, String(input.from || ""), String(input.to || ""), duration, typeof input.tz === "string" ? input.tz : undefined);
      return JSON.stringify({ ok: true, windows: rows.slice(0, 8) });
    }
    return JSON.stringify({ error: "Неизвестный инструмент" });
  } catch {
    return JSON.stringify({ error: "Календарь сейчас не ответил" });
  }
}
