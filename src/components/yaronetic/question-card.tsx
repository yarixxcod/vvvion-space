import { useState } from "react";
import { formatAnswerText, questionId, type QAnswer, type QBlock, type QStepAnswer } from "@/lib/ai/question";
import { cn } from "@/lib/utils";

export function QuestionCard({
  block,
  live,
  interactive,
  answered,
  note,
  onSubmit,
}: {
  block: QBlock;
  live?: boolean;
  interactive?: boolean;
  answered?: boolean;
  note?: string;
  onSubmit?: (text: string) => void;
}) {
  const [step, setStep] = useState(0);
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [own, setOwn] = useState(false);
  const current = block.steps[step];
  const locked = Boolean(live) || !interactive || Boolean(answered);
  if (!current) return null;

  function chosen(id: string) {
    return picked[id] ?? [];
  }

  function toggle(id: string, option: string) {
    if (locked || current?.type === "text") return;
    if (typeof navigator !== "undefined" && window.matchMedia("(pointer: coarse)").matches && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      navigator.vibrate?.(8);
    }
    if (current?.type === "single") {
      const nextPicks = { ...picked, [id]: [option] };
      setPicked(nextPicks);
      setOwn(false);
      if (step >= block.steps.length - 1) {
        onSubmit?.(formatAnswerText(block, collect(nextPicks, custom)));
        return;
      }
      setStep((value) => value + 1);
      return;
    }
    setPicked((value) => {
      const list = value[id] ?? [];
      const next = list.includes(option) ? list.filter((item) => item !== option) : [...list, option];
      const max = current?.max ?? next.length;
      return { ...value, [id]: next.slice(0, max) };
    });
  }

  function collect(picks: Record<string, string[]>, texts: Record<string, string>): QAnswer {
    const steps: QStepAnswer[] = block.steps.map((item) => {
      const ids = picks[item.id] ?? [];
      const labels = (item.options ?? []).filter((option) => ids.includes(option.id)).map((option) => option.label);
      const extra = texts[item.id]?.trim();
      return { stepId: item.id, picked: ids, labels, custom: extra || undefined };
    });
    return { qid: questionId(block), steps };
  }

  function canSend() {
    if (!current) return false;
    const count = chosen(current.id).length;
    const extra = custom[current.id]?.trim() ?? "";
    if (current.type === "text") return extra.length > 0;
    if (current.type === "multi") return count >= (current.min ?? 1) || extra.length > 0;
    return count > 0 || extra.length > 0;
  }

  function finish() {
    if (!canSend() || !onSubmit) return;
    onSubmit(formatAnswerText(block, collect(picked, custom)));
  }

  function next() {
    if (!canSend()) return;
    if (step < block.steps.length - 1) {
      setStep((value) => value + 1);
      setOwn(false);
      return;
    }
    finish();
  }

  if (!live && (answered || !interactive)) {
    return (
      <div className="my-3 rounded-2xl border border-line bg-elev px-3 py-3">
        <p className="text-xs text-faint">{answered ? "Уточнение · отвечено" : "Уточнение"}</p>
        {block.steps.map((item) => (
          <p key={item.id} className="mt-2 text-sm text-fg">
            {item.title}
          </p>
        ))}
        {note ? <p className="mt-2 text-sm text-muted">{note}</p> : null}
      </div>
    );
  }

  return (
    <div className="my-3 rounded-2xl border border-line bg-elev px-3 py-3">
      <p className="text-xs text-faint">
        Вопрос {step + 1} из {block.steps.length}
      </p>
      <p className="mt-1 text-base font-medium text-fg">{current.title}</p>
      {current.subtitle ? <p className="mt-1 text-sm text-muted">{current.subtitle}</p> : null}
      {live ? <p className="mt-3 text-sm text-muted">Дописываю ответ…</p> : null}
      {!live && current.type !== "text" ? (
        <div className="mt-3 flex flex-col gap-2">
          {(current.options ?? []).map((option, index) => {
            const on = chosen(current.id).includes(option.id);
            return (
              <button
                key={option.id}
                type="button"
                disabled={locked}
                className={cn(
                  "press min-h-12 rounded-2xl border px-3 py-2 text-left disabled:opacity-50",
                  on ? "border-accent bg-subtle" : "border-line",
                )}
                onClick={() => toggle(current.id, option.id)}
              >
                <span className="text-sm text-fg">
                  {index + 1}. {option.label}
                </span>
                {option.hint ? <span className="mt-0.5 block text-xs text-muted">{option.hint}</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
      {!live && (current.allowCustom || current.type === "text") ? (
        <div className="mt-2">
          {current.type !== "text" && !own ? (
            <button type="button" className="press min-h-12 w-full rounded-2xl border border-dashed border-line px-3 text-left text-sm text-muted" onClick={() => setOwn(true)}>
              {current.customPlaceholder || "Свой вариант…"}
            </button>
          ) : (
            <input
              className="field"
              maxLength={300}
              placeholder={current.customPlaceholder || "Свой вариант…"}
              value={custom[current.id] ?? ""}
              onChange={(event) => setCustom((value) => ({ ...value, [current.id]: event.target.value }))}
              onKeyDown={(event) => {
                if (event.key === "Enter" && current.type !== "multi") {
                  event.preventDefault();
                  finish();
                }
              }}
            />
          )}
        </div>
      ) : null}
      {!live ? (
        <div className="mt-3 flex gap-2">
          {step > 0 ? (
            <button type="button" className="press h-12 flex-1 rounded-2xl border border-line text-sm" onClick={() => setStep((value) => value - 1)}>
              Назад
            </button>
          ) : current.optional ? (
            <button
              type="button"
              className="press h-12 flex-1 rounded-2xl border border-line text-sm text-muted"
              onClick={() => onSubmit?.(formatAnswerText(block, { qid: questionId(block), steps: [], skippedAll: true }))}
            >
              Пропустить
            </button>
          ) : null}
          <button type="button" disabled={!canSend()} className="press h-12 flex-1 rounded-2xl bg-accent text-sm font-medium text-accent-fg disabled:opacity-40" onClick={next}>
            {step < block.steps.length - 1 ? "Дальше" : "Отправить"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
