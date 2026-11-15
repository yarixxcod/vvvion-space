export const PREF_PAPER = "yaronetic.paper";

export const PAPERS = [
  { id: "plain", label: "Ровный", hint: "Без рисунка" },
  { id: "warm", label: "Тепло", hint: "Тёплый ровный фон" },
  { id: "edge", label: "Кромка", hint: "Полоска сбоку, текст чистый" },
  { id: "mesh", label: "Туман", hint: "Мягкие пятна" },
  { id: "cosmos", label: "Космос", hint: "Орбиты и звёзды" },
  { id: "aurora", label: "Аврора", hint: "Северное сияние" },
  { id: "ocean", label: "Океан", hint: "Глубокий синий" },
  { id: "dusk", label: "Закат", hint: "Розовый и лиловый" },
  { id: "graphite", label: "Графит", hint: "Сдержанный минимализм" },
] as const;

export type PaperId = (typeof PAPERS)[number]["id"];

export function readStoredPaper(value: string | null): PaperId {
  if (value === "dots") return "warm";
  if (value === "hatch") return "edge";
  if (PAPERS.some((paper) => paper.id === value)) return value as PaperId;
  return "plain";
}

export function isPaper(value: string | null): value is PaperId {
  return PAPERS.some((paper) => paper.id === value);
}

export function applyPaper(paper: PaperId) {
  if (typeof document === "undefined") return;
  if (paper === "plain") delete document.documentElement.dataset.paper;
  else document.documentElement.dataset.paper = paper;
}
