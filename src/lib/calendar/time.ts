export const DEFAULT_TZ = "Asia/Almaty";

export function validTz(tz: string): boolean {
  if (!tz || tz.length > 64 || /[\s;]/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(0);
    return true;
  } catch {
    return false;
  }
}

export type Wall = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

const WEEK: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function wallOf(date: Date, tz: string): Wall {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const bag: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) bag[part.type] = part.value;
  const hour = bag.hour === "24" ? 0 : Number(bag.hour);
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour,
    minute: Number(bag.minute),
    weekday: WEEK[bag.weekday ?? ""] ?? 0,
  };
}

export function shiftCivil(year: number, month: number, day: number, days: number) {
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

/** Wall clock in `tz` to a UTC instant. */
export function utcFromWall(year: number, month: number, day: number, hour: number, minute: number, tz: string): Date {
  let guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let i = 0; i < 4; i += 1) {
    const wall = wallOf(new Date(guess), tz);
    const seen = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
    const want = Date.UTC(year, month - 1, day, hour, minute);
    const delta = want - seen;
    if (delta === 0) break;
    guess += delta;
  }
  return new Date(guess);
}

export function allDaySpan(startDay: { year: number; month: number; day: number }, days: number, tz: string) {
  const end = shiftCivil(startDay.year, startDay.month, startDay.day, Math.max(1, days));
  return {
    startsAt: utcFromWall(startDay.year, startDay.month, startDay.day, 0, 0, tz),
    endsAt: utcFromWall(end.year, end.month, end.day, 0, 0, tz),
  };
}

export function formatWhen(date: Date, tz: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: tz,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
