const timeFmt = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" });
const timeCache = new Map<number, string>();

export function formatTime(ts: number | string | Date): string {
  const k = +new Date(ts);
  if (!Number.isFinite(k)) return "";
  const hit = timeCache.get(k);
  if (hit !== undefined) return hit;
  const text = timeFmt.format(k);
  if (timeCache.size > 500) timeCache.clear();
  timeCache.set(k, text);
  return text;
}
