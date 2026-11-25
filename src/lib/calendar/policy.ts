export const REMINDER_MINUTES = [0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10080] as const;

export function validReminder(minutes: number) {
  return (REMINDER_MINUTES as readonly number[]).includes(minutes);
}

export function cleanText(value: unknown, max: number) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function validTitle(value: unknown) {
  const title = cleanText(value, 200);
  return title.length >= 1 ? title : null;
}

/** Delete always asks. A series-wide edit asks. One occurrence does not. */
export function needsConfirm(action: "create" | "update" | "delete", scope: string | undefined, confirm: boolean) {
  if (confirm) return false;
  if (action === "delete") return true;
  return action === "update" && (scope === "all" || scope === "this_and_future");
}

export function calendarEventUrl(id: string) {
  return `/?place=services&svc=calendar&event=${id}`;
}
