export type Busy = { startsAt: Date; endsAt: Date };

/** Gaps inside [from, to) that fit durationMin. Merged busy ranges. */
export function freeWindows(busy: Busy[], from: Date, to: Date, durationMin: number, limit = 8): Busy[] {
  const need = durationMin * 60_000;
  const spans = busy
    .map((item) => ({ startsAt: item.startsAt < from ? from : item.startsAt, endsAt: item.endsAt > to ? to : item.endsAt }))
    .filter((item) => item.endsAt > item.startsAt)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const merged: Busy[] = [];
  for (const span of spans) {
    const last = merged.at(-1);
    if (last && span.startsAt <= last.endsAt) last.endsAt = span.endsAt > last.endsAt ? span.endsAt : last.endsAt;
    else merged.push({ ...span });
  }
  const out: Busy[] = [];
  let cursor = from;
  for (const span of merged) {
    if (span.startsAt.getTime() - cursor.getTime() >= need) out.push({ startsAt: cursor, endsAt: span.startsAt });
    if (span.endsAt > cursor) cursor = span.endsAt;
    if (out.length >= limit) return out;
  }
  if (to.getTime() - cursor.getTime() >= need && out.length < limit) out.push({ startsAt: cursor, endsAt: to });
  return out;
}
