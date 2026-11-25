import { parseRrule } from "./rrule.ts";

export type Reminder = { minutesBefore: number; remindInQuiet: boolean };

export type Master = {
  id: string;
  calendarId: string;
  userId: string;
  title: string;
  notes: string;
  location: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  tz: string;
  rrule: string | null;
  exdates: string[];
  color: string | null;
  reminders: Reminder[];
};

export type Scope = "this" | "this_and_future" | "all";

function withUntil(rrule: string, until: Date) {
  const parsed = parseRrule(rrule);
  if (!parsed || "error" in parsed) return rrule;
  const parts = rrule.split(";").filter((part) => !part.startsWith("UNTIL=") && !part.startsWith("COUNT="));
  parts.push(`UNTIL=${until.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`);
  return parts.join(";");
}

export function deleteMaster(master: Master, scope: Scope, occurrence?: string): { keep: Master[]; drop: string[] } {
  if (!master.rrule || scope === "all") return { keep: [], drop: [master.id] };
  if (!occurrence) return { keep: [], drop: [master.id] };
  if (scope === "this") {
    return { keep: [{ ...master, exdates: [...master.exdates, occurrence] }], drop: [] };
  }
  const until = new Date(new Date(occurrence).getTime() - 1000);
  if (new Date(master.startsAt) >= new Date(occurrence)) return { keep: [], drop: [master.id] };
  return { keep: [{ ...master, rrule: withUntil(master.rrule, until) }], drop: [] };
}

export function updateMaster(master: Master, scope: Scope, patch: Partial<Master>, occurrence: string | undefined, nextId: string): { keep: Master[]; drop: string[] } {
  if (!master.rrule || scope === "all") {
    return { keep: [{ ...master, ...patch, id: master.id, userId: master.userId, exdates: patch.exdates ?? master.exdates, reminders: patch.reminders ?? master.reminders }], drop: [] };
  }
  if (scope === "this" && occurrence) {
    const single: Master = {
      ...master,
      ...patch,
      id: nextId,
      userId: master.userId,
      rrule: null,
      exdates: [],
      startsAt: patch.startsAt ?? occurrence,
      endsAt: patch.endsAt ?? new Date(new Date(occurrence).getTime() + (new Date(master.endsAt).getTime() - new Date(master.startsAt).getTime())).toISOString(),
    };
    return { keep: [{ ...master, exdates: [...master.exdates, occurrence] }, single], drop: [] };
  }
  if (scope === "this_and_future" && occurrence) {
    const until = new Date(new Date(occurrence).getTime() - 1000);
    const next: Master = { ...master, ...patch, id: nextId, userId: master.userId, startsAt: patch.startsAt ?? occurrence, exdates: [] };
    if (new Date(master.startsAt) >= new Date(occurrence)) return { keep: [next.id === master.id ? { ...next, id: master.id } : { ...next, id: master.id }], drop: [] };
    return { keep: [{ ...master, rrule: withUntil(master.rrule, until) }, next], drop: [] };
  }
  return { keep: [{ ...master, ...patch, id: master.id, userId: master.userId }], drop: [] };
}
