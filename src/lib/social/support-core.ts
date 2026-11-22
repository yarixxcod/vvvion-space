export const TICKET_CATEGORIES = [
  ["tech", "Техническая проблема"],
  ["model", "Ошибка ИИ-модели"],
  ["account", "Проблема с аккаунтом"],
  ["pay", "Покупки и Вубли"],
  ["gifts", "Подарки"],
  ["persona", "Персонажи"],
  ["feed", "Проблемы с лентой"],
  ["rules", "Вопрос по правилам"],
  ["idea", "Предложение"],
  ["other", "Другое"],
] as const;

export const REPORT_REASONS = [
  ["spam", "Спам"],
  ["abuse", "Оскорбления и травля"],
  ["fraud", "Мошенничество"],
  ["impersonation", "Выдача себя за другого"],
  ["banned", "Запрещённый контент"],
  ["threat", "Угрозы"],
  ["rules", "Нарушение правил"],
  ["other", "Другое"],
] as const;

export const TICKET_STATUSES = ["new", "open", "waiting", "solved", "closed"] as const;
export const PRIORITIES = ["low", "normal", "high"] as const;
export const TARGETS = ["user", "post", "message"] as const;
export const SANCTIONS = ["dismiss", "warn", "hide_post", "delete_post", "limit_posts", "suspend", "ban", "lift"] as const;

export const REPORT_HOUR_LIMIT = 5;
export const TICKET_DAY_LIMIT = 8;

const CATEGORY_KEYS = new Set<string>(TICKET_CATEGORIES.map(([id]) => id));
const REASON_KEYS = new Set<string>(REPORT_REASONS.map(([id]) => id));
const STATUS_KEYS = new Set<string>(TICKET_STATUSES);
const PRIORITY_KEYS = new Set<string>(PRIORITIES);
const TARGET_KEYS = new Set<string>(TARGETS);
const SANCTION_KEYS = new Set<string>(SANCTIONS);

export function clipText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  // eslint-disable-next-line no-control-regex -- Strip forbidden control bytes from untrusted input.
  return value.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function categoryOf(value: unknown): string {
  const key = typeof value === "string" ? value : "";
  if (!CATEGORY_KEYS.has(key)) throw new Error("Выберите категорию");
  return key;
}

export function reasonOf(value: unknown): string {
  const key = typeof value === "string" ? value : "";
  if (!REASON_KEYS.has(key)) throw new Error("Выберите причину");
  return key;
}

export function ticketStatusOf(value: unknown): (typeof TICKET_STATUSES)[number] {
  const key = typeof value === "string" ? value : "";
  if (!STATUS_KEYS.has(key)) throw new Error("Некорректный статус");
  return key as (typeof TICKET_STATUSES)[number];
}

export function priorityOf(value: unknown): (typeof PRIORITIES)[number] {
  const key = typeof value === "string" ? value : "";
  if (!PRIORITY_KEYS.has(key)) throw new Error("Некорректный приоритет");
  return key as (typeof PRIORITIES)[number];
}

export function targetOf(value: unknown): (typeof TARGETS)[number] {
  const key = typeof value === "string" ? value : "";
  if (!TARGET_KEYS.has(key)) throw new Error("Объект жалобы не найден");
  return key as (typeof TARGETS)[number];
}

export function sanctionOf(value: unknown): (typeof SANCTIONS)[number] {
  const key = typeof value === "string" ? value : "";
  if (!SANCTION_KEYS.has(key)) throw new Error("Такой меры нет");
  return key as (typeof SANCTIONS)[number];
}

export function snapshotOf(value: unknown): string {
  return clipText(value, 280);
}

export function subjectOf(value: unknown): string {
  const text = clipText(value, 120);
  if (text.length < 3) throw new Error("Тема слишком короткая");
  return text;
}

export function bodyOf(value: unknown, min = 2): string {
  // eslint-disable-next-line no-control-regex -- Strip forbidden control bytes from untrusted input.
  const text = typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 4000) : "";
  if (text.length < min) throw new Error("Напишите подробнее");
  return text;
}

export function daysOf(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 30) throw new Error("Срок от 1 до 30 дней");
  return n;
}

export function pageOf(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isInteger(n) || n < 0 || n > 200) return 0;
  return n;
}

export function spanOf(value: unknown): 1 | 7 | 30 {
  if (value === 1 || value === 7 || value === 30) return value;
  return 7;
}

export function canReopen(status: string): boolean {
  return status === "solved" || status === "closed";
}

export function reportAllowed(recent: number, duplicateOpen: boolean): string | null {
  if (duplicateOpen) return "Вы уже отправили жалобу на это";
  if (recent >= REPORT_HOUR_LIMIT) return "Слишком много жалоб за час. Подождите.";
  return null;
}

export function ticketAllowed(today: number): string | null {
  if (today >= TICKET_DAY_LIMIT) return "Слишком много обращений за сутки";
  return null;
}

export function sanctionFits(kind: string, targetType: string): boolean {
  if (kind === "dismiss" || kind === "warn" || kind === "suspend" || kind === "ban" || kind === "lift" || kind === "limit_posts") return true;
  if (kind === "hide_post" || kind === "delete_post") return targetType === "post";
  return false;
}

export function imagePayload(mime: unknown, data: unknown): { mime: "image/jpeg" | "image/png" | "image/webp"; data: string } | null {
  if (mime !== "image/jpeg" && mime !== "image/png" && mime !== "image/webp") return null;
  if (typeof data !== "string") return null;
  const clean = data.replace(/\s/g, "");
  if (clean.length < 24 || clean.length > 280_000 || !/^[A-Za-z0-9+/=]+$/.test(clean)) return null;
  const mark = clean.slice(0, 16);
  if (mime === "image/jpeg" && !mark.startsWith("/9j/")) return null;
  if (mime === "image/png" && !mark.startsWith("iVBORw0KGgo")) return null;
  if (mime === "image/webp" && !mark.startsWith("UklGR")) return null;
  return { mime, data: clean };
}

export function labelOf(list: readonly (readonly [string, string])[], key: string): string {
  return list.find((item) => item[0] === key)?.[1] ?? key;
}
