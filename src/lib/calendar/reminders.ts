import { expandRule } from "./rrule.ts";

export type ReminderSeed = { minutesBefore: number };

export type QueueItem = { occurrenceAt: string; fireAt: string; minutesBefore: number };

const HORIZON_MS = 35 * 86_400_000;

export function queueReminders(input: {
  startsAt: Date;
  endsAt: Date;
  tz: string;
  rrule: string | null;
  exdates?: Date[];
  reminders: ReminderSeed[];
  now: Date;
}): QueueItem[] {
  const from = new Date(input.now.getTime() - 60_000);
  const to = new Date(input.now.getTime() + HORIZON_MS);
  const spans = expandRule({
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    tz: input.tz,
    rrule: input.rrule,
    exdates: input.exdates,
    from,
    to,
    limit: 80,
  });
  if ("error" in spans) return [];
  const items: QueueItem[] = [];
  for (const span of spans) {
    for (const reminder of input.reminders) {
      const fire = new Date(span.startsAt.getTime() - reminder.minutesBefore * 60_000);
      if (fire.getTime() < input.now.getTime() - 60_000) continue;
      if (fire > to) continue;
      items.push({ occurrenceAt: span.startsAt.toISOString(), fireAt: fire.toISOString(), minutesBefore: reminder.minutesBefore });
    }
  }
  return items;
}

export function maySendInQuiet(remindInQuiet: boolean, quiet: boolean) {
  return remindInQuiet || !quiet;
}
