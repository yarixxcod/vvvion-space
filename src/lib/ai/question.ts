export const Q_LANG = "vvvion-question";

export type QOption = { id: string; label: string; hint?: string };

export type QStep = {
  id: string;
  title: string;
  subtitle?: string;
  type: "single" | "multi" | "text";
  options?: QOption[];
  allowCustom?: boolean;
  customPlaceholder?: string;
  min?: number;
  max?: number;
  optional?: boolean;
};

export type QBlock = { v: 1; steps: QStep[] };

export type QStepAnswer = {
  stepId: string;
  picked: string[];
  labels: string[];
  custom?: string;
  skipped?: boolean;
};

export type QAnswer = { qid: string; steps: QStepAnswer[]; skippedAll?: boolean };

export const LIMITS = {
  steps: 4,
  options: 8,
  label: 60,
  hint: 100,
  title: 140,
  subtitle: 140,
  custom: 300,
  json: 6000,
  answerText: 1000,
} as const;

const ID_RE = /^[a-z0-9_-]{1,32}$/i;

function clip(value: unknown, max: number) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function parseQuestionBlock(raw: string): QBlock | null {
  if (raw.length > LIMITS.json) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    try {
      parsed = JSON.parse(raw.replace(/,\s*([}\]])/g, "$1"));
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object") return null;
  const body = parsed as { v?: unknown; steps?: unknown };
  if (body.v !== 1 || !Array.isArray(body.steps) || body.steps.length === 0) return null;
  const seen = new Set<string>();
  const steps: QStep[] = [];
  for (const item of body.steps.slice(0, LIMITS.steps)) {
    if (!item || typeof item !== "object") return null;
    const row = item as Record<string, unknown>;
    const wanted = typeof row.id === "string" ? row.id : "";
    const id = ID_RE.test(wanted) && !seen.has(wanted) ? wanted : `s${steps.length + 1}`;
    seen.add(id);
    const type = row.type === "multi" || row.type === "text" ? row.type : "single";
    const title = clip(row.title, LIMITS.title);
    if (!title) return null;
    let options: QOption[] | undefined;
    if (type !== "text") {
      const ids = new Set<string>();
      const source = Array.isArray(row.options) ? row.options : [];
      options = source.slice(0, LIMITS.options).flatMap((option, index) => {
        if (!option || typeof option !== "object") return [];
        const entry = option as Record<string, unknown>;
        const label = clip(entry.label, LIMITS.label);
        if (!label) return [];
        const rawId = typeof entry.id === "string" ? entry.id : "";
        const oid = ID_RE.test(rawId) && !ids.has(rawId) ? rawId : `o${index + 1}`;
        ids.add(oid);
        const hint = clip(entry.hint, LIMITS.hint);
        return [{ id: oid, label, hint: hint || undefined }];
      });
      if (!options || options.length < 2) return null;
    }
    const max = type === "multi" ? Math.min(Math.max(Number(row.max) || options!.length, 1), options!.length) : undefined;
    const min = type === "multi" ? Math.min(Math.max(Number(row.min) || 1, 0), max!) : undefined;
    steps.push({
      id,
      title,
      subtitle: clip(row.subtitle, LIMITS.subtitle) || undefined,
      type,
      options,
      allowCustom: type === "text" ? true : Boolean(row.allowCustom),
      customPlaceholder: clip(row.customPlaceholder, 60) || "Свой вариант…",
      min,
      max,
      optional: Boolean(row.optional),
    });
  }
  if (!steps.length) return null;
  return { v: 1, steps };
}

export function questionId(block: QBlock): string {
  const text = JSON.stringify(block);
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

export function formatAnswerText(block: QBlock, answer: QAnswer): string {
  if (answer.skippedAll) return "Пропускаю вопрос — выбери разумные значения сам и продолжай.";
  const one = block.steps.length === 1 && answer.steps[0]?.labels.length === 1 && !answer.steps[0].custom;
  if (one) return answer.steps[0]!.labels[0]!.slice(0, LIMITS.answerText);
  return answer.steps
    .map((step, index) => {
      const source = block.steps[index];
      if (!source) return "";
      if (step.skipped) return `• ${source.title} — пропущено`;
      const parts = [...step.labels, ...(step.custom ? [`своё: «${step.custom}»`] : [])];
      return `• ${source.title} — ${parts.join("; ")}`;
    })
    .filter(Boolean)
    .join("\n")
    .slice(0, LIMITS.answerText);
}

export type QuestionPiece =
  | { kind: "md"; text: string }
  | { kind: "ask"; raw: string; closed: boolean; interactive: boolean };

export function splitQuestionText(input: string): QuestionPiece[] {
  const parts: QuestionPiece[] = [];
  const fence = /```vvvion-question[^\n]*\n([\s\S]*?)```/gi;
  let last = 0;
  let interactive = true;
  for (const match of input.matchAll(fence)) {
    const index = match.index ?? 0;
    parts.push({ kind: "md", text: input.slice(last, index) });
    parts.push({ kind: "ask", raw: match[1] ?? "", closed: true, interactive });
    interactive = false;
    last = index + match[0].length;
  }
  const rest = input.slice(last);
  const open = /```vvvion-question[^\n]*\n([\s\S]*)$/i.exec(rest);
  if (open && open.index != null) {
    parts.push({ kind: "md", text: rest.slice(0, open.index) });
    parts.push({ kind: "ask", raw: open[1] ?? "", closed: false, interactive });
  } else parts.push({ kind: "md", text: rest });
  return parts.filter((part) => part.kind !== "md" || part.text.trim());
}
