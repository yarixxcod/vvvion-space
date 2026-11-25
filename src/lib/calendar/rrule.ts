import { shiftCivil, utcFromWall, wallOf, type Wall } from "./time.ts";

export type Freq = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
export type Rule = { freq: Freq; interval: number; byday: number[]; until?: Date; count?: number };

const DAY: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

export function parseRrule(raw: string | null | undefined): Rule | null | { error: string } {
  if (raw == null || raw.trim() === "") return null;
  const text = raw.trim().toUpperCase();
  if (text.length > 240) return { error: "RRULE" };
  const parts = text.split(";").filter(Boolean);
  let freq: Freq | "" = "";
  let interval = 1;
  let byday: number[] = [];
  let until: Date | undefined;
  let count: number | undefined;
  for (const part of parts) {
    const [key, value] = part.split("=");
    if (!key || value == null || value === "") return { error: "RRULE" };
    if (key === "FREQ" && (value === "DAILY" || value === "WEEKLY" || value === "MONTHLY" || value === "YEARLY")) freq = value;
    else if (key === "INTERVAL") {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > 366) return { error: "RRULE" };
      interval = n;
    } else if (key === "BYDAY") {
      const days = value.split(",");
      if (days.some((day) => !DAY[day])) return { error: "RRULE" };
      byday = [...new Set(days.map((day) => DAY[day]!))].sort((a, b) => a - b);
    } else if (key === "UNTIL") {
      const date = parseUntil(value);
      if (!date) return { error: "RRULE" };
      until = date;
    } else if (key === "COUNT") {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > 500) return { error: "RRULE" };
      count = n;
    } else return { error: "RRULE" };
  }
  if (!freq) return { error: "RRULE" };
  if (until && count) return { error: "RRULE" };
  if (freq !== "WEEKLY" && byday.length) return { error: "RRULE" };
  return { freq, interval, byday, until, count };
}

function parseUntil(value: string): Date | null {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z)?$/.exec(value);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] ?? 23), Number(match[5] ?? 59), Number(match[6] ?? 59)));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatRrule(rule: Rule): string {
  const parts = [`FREQ=${rule.freq}`];
  if (rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.byday.length) {
    const names = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
    parts.push(`BYDAY=${rule.byday.map((day) => names[day]).join(",")}`);
  }
  if (rule.count) parts.push(`COUNT=${rule.count}`);
  if (rule.until) parts.push(`UNTIL=${rule.until.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`);
  return parts.join(";");
}

export type Span = { startsAt: Date; endsAt: Date };

function sameMinute(a: Date, b: Date) {
  return Math.abs(a.getTime() - b.getTime()) < 60_000;
}

function excluded(start: Date, exdates: Date[]) {
  return exdates.some((item) => sameMinute(item, start));
}

function civilKey(wall: Wall) {
  return wall.year * 10000 + wall.month * 100 + wall.day;
}

/** Occurrences that overlap [from, to). COUNT includes dates later removed by EXDATE. */
export function expandRule(input: {
  startsAt: Date;
  endsAt: Date;
  tz: string;
  rrule: string | null;
  exdates?: Date[];
  from: Date;
  to: Date;
  limit?: number;
}): Span[] | { error: string } {
  const parsed = parseRrule(input.rrule);
  if (parsed && "error" in parsed) return parsed;
  const duration = input.endsAt.getTime() - input.startsAt.getTime();
  if (duration <= 0) return { error: "RANGE" };
  const exdates = input.exdates ?? [];
  const limit = input.limit ?? 400;
  const out: Span[] = [];
  const push = (start: Date, index: number) => {
    if (parsed?.count && index >= parsed.count) return false;
    if (parsed?.until && start.getTime() > parsed.until.getTime()) return false;
    const end = new Date(start.getTime() + duration);
    if (!excluded(start, exdates) && end > input.from && start < input.to && out.length < limit) out.push({ startsAt: start, endsAt: end });
    return true;
  };
  if (!parsed) {
    push(input.startsAt, 0);
    return out;
  }
  const startWall = wallOf(input.startsAt, input.tz);
  const horizon = new Date(input.to.getTime() + duration);
  let index = 0;
  if (parsed.freq === "DAILY") {
    for (let step = 0; step < 4000; step += parsed.interval) {
      const day = shiftCivil(startWall.year, startWall.month, startWall.day, step);
      const start = utcFromWall(day.year, day.month, day.day, startWall.hour, startWall.minute, input.tz);
      if (start > horizon && index > 0) break;
      if (!push(start, index)) break;
      index += 1;
      if (start > horizon) break;
    }
    return out;
  }
  if (parsed.freq === "WEEKLY") {
    const days = parsed.byday.length ? parsed.byday : [startWall.weekday];
    const origin = shiftCivil(startWall.year, startWall.month, startWall.day, -((startWall.weekday + 6) % 7));
    for (let week = 0; week < 800; week += parsed.interval) {
      const weekStart = shiftCivil(origin.year, origin.month, origin.day, week * 7);
      let stop = false;
      for (const weekday of days) {
        const offset = (weekday + 6) % 7;
        const day = shiftCivil(weekStart.year, weekStart.month, weekStart.day, offset);
        if (civilKey({ ...startWall, ...day }) < civilKey(startWall)) continue;
        const start = utcFromWall(day.year, day.month, day.day, startWall.hour, startWall.minute, input.tz);
        if (!push(start, index)) {
          stop = true;
          break;
        }
        index += 1;
        if (start > horizon && index > 1) stop = true;
      }
      if (stop) break;
    }
    return out;
  }
  const months = parsed.freq === "YEARLY" ? parsed.interval * 12 : parsed.interval;
  for (let step = 0; step < 600; step += months) {
    const cursor = new Date(Date.UTC(startWall.year, startWall.month - 1 + step, 1));
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth() + 1;
    const dim = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (startWall.day > dim) continue;
    const start = utcFromWall(year, month, startWall.day, startWall.hour, startWall.minute, input.tz);
    if (!push(start, index)) break;
    index += 1;
    if (start > horizon) break;
  }
  return out;
}
