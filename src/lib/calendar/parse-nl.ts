import { allDaySpan, utcFromWall, validTz, wallOf, DEFAULT_TZ } from "./time.ts";
import { formatRrule, type Rule } from "./rrule.ts";

export type Draft = {
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  tz: string;
  rrule: string | null;
};

export type ParseResult = { draft: Draft; confidence: "high" | "medium" | "low"; warnings: string[] };

const MONTHS: Record<string, number> = {
  января: 1, январь: 1, january: 1, jan: 1,
  февраля: 2, февраль: 2, february: 2, feb: 2,
  марта: 3, март: 3, march: 3, mar: 3,
  апреля: 4, апрель: 4, april: 4, apr: 4,
  мая: 5, май: 5, may: 5,
  июня: 6, июнь: 6, june: 6, jun: 6,
  июля: 7, июль: 7, july: 7, jul: 7,
  августа: 8, август: 8, august: 8, aug: 8,
  сентября: 9, сентябрь: 9, september: 9, sep: 9, sept: 9,
  октября: 10, октябрь: 10, october: 10, oct: 10,
  ноября: 11, ноябрь: 11, november: 11, nov: 11,
  декабря: 12, декабрь: 12, december: 12, dec: 12,
};

const WEEKDAYS: Record<string, number> = {
  воскресенье: 0, вс: 0, sunday: 0, sun: 0,
  понедельник: 1, пн: 1, monday: 1, mon: 1,
  вторник: 2, вт: 2, tuesday: 2, tue: 2,
  среда: 3, среду: 3, ср: 3, wednesday: 3, wed: 3,
  четверг: 4, чт: 4, thursday: 4, thu: 4,
  пятница: 5, пятницу: 5, пт: 5, friday: 5, fri: 5,
  суббота: 6, субботу: 6, сб: 6, saturday: 6, sat: 6,
};

const NAMES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

export function parseEventPhrase(phrase: string, now: Date, tz = DEFAULT_TZ): ParseResult {
  const zone = validTz(tz) ? tz : DEFAULT_TZ;
  const warnings: string[] = [];
  let text = phrase.replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();
  const wall = wallOf(now, zone);
  let day = { year: wall.year, month: wall.month, day: wall.day };
  let hour = wall.hour;
  let minute = wall.minute;
  let daySet = false;
  let timeSet = false;
  let allDay = false;
  let durationMin = 60;
  let rule: Rule | null = null;

  const relative = /(?:через|in)\s+(\d{1,3})\s*(минут[а-я]*|мин|minutes?|min|час[а-я]*|hours?|ч\b)/i.exec(lower);
  if (relative) {
    const n = Number(relative[1]);
    const unit = relative[2]!.toLowerCase();
    const mins = /ч|hour/.test(unit) ? n * 60 : n;
    const at = new Date(now.getTime() + mins * 60_000);
    const next = wallOf(at, zone);
    day = { year: next.year, month: next.month, day: next.day };
    hour = next.hour;
    minute = next.minute;
    daySet = true;
    timeSet = true;
    text = text.replace(relative[0], " ");
  }

  if (/послезавтра/.test(lower)) {
    const next = add(day, 2);
    day = next;
    daySet = true;
    text = text.replace(/послезавтра/i, " ");
  } else if (/завтра|tomorrow|ертең/.test(lower)) {
    day = add(day, 1);
    daySet = true;
    text = text.replace(/завтра|tomorrow|ертең/i, " ");
  } else if (/сегодня|today|бүгін/.test(lower)) {
    daySet = true;
    text = text.replace(/сегодня|today|бүгін/i, " ");
  }

  const numeric = /(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/.exec(text);
  if (numeric) {
    const d = Number(numeric[1]);
    const m = Number(numeric[2]);
    const y = numeric[3] ? Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3]) : nextYear(wall, m, d);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      day = { year: y, month: m, day: d };
      daySet = true;
      text = text.replace(numeric[0], " ");
    }
  }

  const named = /(\d{1,2})\s+([a-zа-яё]+)/i.exec(text.toLowerCase());
  if (named && MONTHS[named[2]!]) {
    const d = Number(named[1]);
    const m = MONTHS[named[2]!]!;
    day = { year: nextYear(wall, m, d), month: m, day: d };
    daySet = true;
    text = text.replace(new RegExp(`${named[1]}\\s+${named[2]}`, "i"), " ");
  }

  const range = /(\d{1,2})[:.](\d{2})\s*[-–—]\s*(\d{1,2})[:.](\d{2})/.exec(text);
  if (range) {
    hour = Number(range[1]);
    minute = Number(range[2]);
    const endH = Number(range[3]);
    const endM = Number(range[4]);
    durationMin = endH * 60 + endM - (hour * 60 + minute);
    if (durationMin <= 0) durationMin += 24 * 60;
    timeSet = true;
    text = text.replace(range[0], " ");
  } else {
    const clock = /(?:в|at|@)?\s*(\d{1,2})[:.](\d{2})/.exec(text);
    if (clock && Number(clock[1]) <= 23 && Number(clock[2]) <= 59) {
      hour = Number(clock[1]);
      minute = Number(clock[2]);
      timeSet = true;
      text = text.replace(clock[0], " ");
    }
  }

  if (/весь день|all day|all-day|күні бойы/.test(text.toLowerCase())) {
    allDay = true;
    text = text.replace(/весь день|all day|all-day|күні бойы/i, " ");
  }

  const dur = /(\d{1,2})\s*(час[а-я]*|hours?|минут[а-я]*|minutes?)/i.exec(text);
  if (dur && !/через|in\s+\d/.test(dur[0])) {
    const n = Number(dur[1]);
    durationMin = /ч|hour/i.test(dur[2]!) ? n * 60 : n;
    text = text.replace(dur[0], " ");
  }

  const weekly = /(?:каждый|каждую|каждое|every)\s+([a-zа-яё]+)/i.exec(text.toLowerCase());
  if (weekly && WEEKDAYS[weekly[1]!]) {
    const weekday = WEEKDAYS[weekly[1]!]!;
    day = nextWeekday(daySet ? day : { year: wall.year, month: wall.month, day: wall.day }, weekday, timeSet ? { hour, minute } : null, wall, zone, now);
    daySet = true;
    rule = { freq: "WEEKLY", interval: 1, byday: [weekday] };
    text = text.replace(weekly[0], " ");
  } else if (/каждый день|every day|күн сайын/.test(text.toLowerCase())) {
    rule = { freq: "DAILY", interval: 1, byday: [] };
    text = text.replace(/каждый день|every day|күн сайын/i, " ");
  } else if (/каждую неделю|every week|апта сайын/.test(text.toLowerCase())) {
    rule = { freq: "WEEKLY", interval: 1, byday: [wallOf(utcFromWall(day.year, day.month, day.day, 12, 0, zone), zone).weekday] };
    text = text.replace(/каждую неделю|every week|апта сайын/i, " ");
  }

  if (!timeSet && !allDay) {
    hour = 10;
    minute = 0;
    warnings.push("Время не сказано — поставил 10:00");
  }
  if (!daySet && !relative) warnings.push("День не сказан — взял сегодня");

  const title = text.replace(/[^\p{L}\p{N} .,:+-]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 200) || "Событие";
  if (title === "Событие") warnings.push("Название не разобрал");

  let startsAt: Date;
  let endsAt: Date;
  if (allDay) {
    const span = allDaySpan(day, 1, zone);
    startsAt = span.startsAt;
    endsAt = span.endsAt;
  } else {
    startsAt = utcFromWall(day.year, day.month, day.day, hour, minute, zone);
    endsAt = new Date(startsAt.getTime() + Math.max(15, durationMin) * 60_000);
  }
  const confidence: ParseResult["confidence"] = warnings.length === 0 ? "high" : warnings.length === 1 ? "medium" : "low";
  return {
    draft: { title, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), allDay, tz: zone, rrule: rule ? formatRrule(rule) : null },
    confidence,
    warnings,
  };
}

function add(day: { year: number; month: number; day: number }, days: number) {
  const next = new Date(Date.UTC(day.year, day.month - 1, day.day + days));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

function nextYear(wall: { year: number; month: number; day: number }, month: number, day: number) {
  if (month > wall.month || (month === wall.month && day >= wall.day)) return wall.year;
  return wall.year + 1;
}

function nextWeekday(
  from: { year: number; month: number; day: number },
  weekday: number,
  time: { hour: number; minute: number } | null,
  wall: { hour: number; minute: number },
  tz: string,
  now: Date,
) {
  for (let i = 0; i < 8; i += 1) {
    const day = add(from, i);
    const probe = utcFromWall(day.year, day.month, day.day, time?.hour ?? 12, time?.minute ?? 0, tz);
    if (wallOf(probe, tz).weekday !== weekday) continue;
    if (probe.getTime() <= now.getTime()) continue;
    return day;
  }
  return add(from, (weekday - wall.hour + 7) % 7 || 7);
}
