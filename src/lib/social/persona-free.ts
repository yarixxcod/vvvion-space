/** Roles everyone can turn on without paying. The rest stay in the shop. */
export const FREE_ROLES = [
  { id: "psych", name: "Психолог", role: "Спокойный разбор чувств" },
  { id: "marketer", name: "Маркетолог", role: "Текст и кому его сказать" },
  { id: "chef", name: "Повар", role: "Кухня из того, что есть" },
  { id: "programmer", name: "Программист", role: "Код и поиск ошибок" },
] as const;

export const FREE_PERSONA_IDS = FREE_ROLES.map((item) => item.id);

export function personaIsFree(id: string): boolean {
  return (FREE_PERSONA_IDS as readonly string[]).includes(id);
}

export type DayPart = "morning" | "afternoon" | "evening" | "night";

/** Local hour, 0–23. Night wraps around midnight. */
export function dayPart(hour: number): DayPart {
  const h = Math.floor(hour);
  const clock = ((h % 24) + 24) % 24;
  if (clock >= 5 && clock < 12) return "morning";
  if (clock >= 12 && clock < 17) return "afternoon";
  if (clock >= 17 && clock < 23) return "evening";
  return "night";
}

/** First word of a display name. Emails and blank names stay empty. */
export function nickOf(name: string | null | undefined): string {
  const raw = (name || "").replace(/\s+/g, " ").trim();
  if (!raw || raw.includes("@")) return "";
  const word = raw.split(" ")[0] || "";
  return Array.from(word).slice(0, 24).join("");
}
