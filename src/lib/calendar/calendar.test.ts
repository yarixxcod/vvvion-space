import assert from "node:assert/strict";
import test from "node:test";
import { destinationFor } from "../app-nav.ts";
import { expandRule, parseRrule } from "./rrule.ts";
import { parseEventPhrase } from "./parse-nl.ts";
import { needsConfirm } from "./policy.ts";
import { maySendInQuiet, queueReminders } from "./reminders.ts";
import { freeWindows } from "./free.ts";
import { validPushPath, settingsFrom } from "../social/push-policy.ts";
import { utcFromWall } from "./time.ts";

const TZ = "Asia/Almaty";
const NOW = new Date("2026-11-24T10:00:00.000Z");

test("phrases in Asia/Almaty", () => {
  const tomorrow = parseEventPhrase("завтра в 15:00 встреча с Иваном", NOW, TZ);
  assert.equal(tomorrow.draft.startsAt, "2026-11-25T10:00:00.000Z");
  assert.equal(tomorrow.draft.endsAt, "2026-11-25T11:00:00.000Z");
  assert.match(tomorrow.draft.title, /Иваном/);
  assert.equal(tomorrow.confidence, "high");

  const today = parseEventPhrase("сегодня в 18:00", NOW, TZ);
  assert.equal(today.draft.startsAt, "2026-11-24T13:00:00.000Z");

  const soon = parseEventPhrase("через 2 часа позвонить маме", NOW, TZ);
  assert.equal(soon.draft.startsAt, "2026-11-24T12:00:00.000Z");
  assert.match(soon.draft.title, /маме/);

  const yoga = parseEventPhrase("каждый понедельник в 10 йога", NOW, TZ);
  assert.equal(yoga.draft.startsAt, "2026-11-30T05:00:00.000Z");
  assert.match(yoga.draft.rrule ?? "", /FREQ=WEEKLY/);
  assert.match(yoga.draft.rrule ?? "", /BYDAY=MO/);

  const slot = parseEventPhrase("25.11 13:00–14:00 стоматолог", NOW, TZ);
  assert.equal(slot.draft.startsAt, "2026-11-25T08:00:00.000Z");
  assert.equal(slot.draft.endsAt, "2026-11-25T09:00:00.000Z");

  const day = parseEventPhrase("1 Dec all day", NOW, TZ);
  assert.equal(day.draft.allDay, true);
  assert.equal(day.draft.startsAt, utcFromWall(2026, 12, 1, 0, 0, TZ).toISOString());
});

test("rrule expands daily, weekly, until, count and exdate", () => {
  const start = utcFromWall(2026, 11, 24, 15, 0, TZ);
  const end = new Date(start.getTime() + 3_600_000);
  const from = new Date("2026-11-24T00:00:00.000Z");
  const to = new Date("2026-12-20T00:00:00.000Z");
  const daily = expandRule({ startsAt: start, endsAt: end, tz: TZ, rrule: "FREQ=DAILY;COUNT=3", from, to });
  assert.ok(!("error" in daily));
  if (!("error" in daily)) assert.equal(daily.length, 3);

  const weekly = expandRule({
    startsAt: utcFromWall(2026, 11, 30, 10, 0, TZ),
    endsAt: new Date(utcFromWall(2026, 11, 30, 10, 0, TZ).getTime() + 3_600_000),
    tz: TZ,
    rrule: "FREQ=WEEKLY;BYDAY=MO",
    from,
    to,
  });
  assert.ok(!("error" in weekly));
  if (!("error" in weekly)) {
    assert.equal(weekly.length, 3);
    assert.equal(weekly[0]!.startsAt.toISOString(), "2026-11-30T05:00:00.000Z");
  }

  const skipped = expandRule({
    startsAt: start,
    endsAt: end,
    tz: TZ,
    rrule: "FREQ=DAILY;COUNT=3",
    exdates: [start],
    from,
    to,
  });
  assert.ok(!("error" in skipped));
  if (!("error" in skipped)) assert.equal(skipped.length, 2);

  const until = expandRule({
    startsAt: start,
    endsAt: end,
    tz: TZ,
    rrule: "FREQ=DAILY;UNTIL=20261125T235959Z",
    from,
    to,
  });
  assert.ok(!("error" in until));
  if (!("error" in until)) assert.equal(until.length, 2);
  assert.deepEqual(parseRrule("FREQ=DAILY;COUNT=2;UNTIL=20261201T000000Z"), { error: "RRULE" });
});

test("confirm, quiet hours, free windows and the deep link", () => {
  assert.equal(needsConfirm("delete", "this", false), true);
  assert.equal(needsConfirm("delete", "this", true), false);
  assert.equal(needsConfirm("update", "all", false), true);
  assert.equal(needsConfirm("update", "this", false), false);
  assert.equal(maySendInQuiet(false, true), false);
  assert.equal(maySendInQuiet(true, true), true);
  const start = utcFromWall(2026, 11, 25, 15, 0, TZ);
  const queued = queueReminders({
    startsAt: start,
    endsAt: new Date(start.getTime() + 3_600_000),
    tz: TZ,
    rrule: null,
    reminders: [{ minutesBefore: 15 }],
    now: NOW,
  });
  assert.equal(queued.length, 1);
  assert.equal(queued[0]!.fireAt, new Date(start.getTime() - 15 * 60_000).toISOString());
  const gaps = freeWindows(
    [{ startsAt: new Date("2026-11-25T04:00:00.000Z"), endsAt: new Date("2026-11-25T06:00:00.000Z") }],
    new Date("2026-11-25T03:00:00.000Z"),
    new Date("2026-11-25T09:00:00.000Z"),
    60,
  );
  assert.equal(gaps.length, 2);
  const url = "/?place=services&svc=calendar&event=abcdefgh";
  assert.equal(validPushPath(url), true);
  assert.equal(settingsFrom(undefined).calendar, true);
  assert.equal(settingsFrom({ calendar: false }).calendar, false);
  assert.deepEqual(destinationFor(`https://vvvion.space${url}`), {
    to: "/",
    search: { place: "services", svc: "calendar", event: "abcdefgh" },
  });
  assert.deepEqual(destinationFor("/c/services?svc=calendar&event=abcdefgh"), {
    to: "/",
    search: { place: "services", svc: "calendar", event: "abcdefgh" },
  });
});
