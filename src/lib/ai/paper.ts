export const PREF_PAPER = "yaronetic.paper";

export const PAPERS = [
  { id: "plain", label: "Ровный", hint: "Без рисунка" },
  { id: "warm", label: "Тепло", hint: "Тёплый ровный фон" },
  { id: "edge", label: "Кромка", hint: "Полоска сбоку, текст чистый" },
  { id: "mesh", label: "Туман", hint: "Мягкие пятна" },
] as const;

export type PaperId = (typeof PAPERS)[number]["id"];

export function readStoredPaper(value: string | null): PaperId {
  if (value === "dots") return "warm";
  if (value === "hatch") return "edge";
  if (value === "plain" || value === "warm" || value === "edge" || value === "mesh") return value;
  return "plain";
}

export function isPaper(value: string | null): value is PaperId {
  return value === "plain" || value === "warm" || value === "edge" || value === "mesh";
}

export function applyPaper(paper: PaperId) {
  if (typeof document === "undefined") return;
  if (paper === "plain") delete document.documentElement.dataset.paper;
  else document.documentElement.dataset.paper = paper;
}
