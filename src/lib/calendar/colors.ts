export const CALENDAR_COLORS = ["lilac", "sage", "sand", "rose", "sky", "ink", "amber", "mint"] as const;
export type CalendarColor = (typeof CALENDAR_COLORS)[number];

export function isCalendarColor(value: string): value is CalendarColor {
  return (CALENDAR_COLORS as readonly string[]).includes(value);
}

export const COLOR_INK: Record<CalendarColor, string> = {
  lilac: "#c4b5e8",
  sage: "#9dccb6",
  sand: "#e8c98a",
  rose: "#e7a19c",
  sky: "#9eb6d6",
  ink: "#d9d4cc",
  amber: "#e0b36a",
  mint: "#b7e0c8",
};
