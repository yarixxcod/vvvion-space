import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { TONES, TOPICS, personalSuggestions, topicLabel, type ToneId } from "@/lib/ai/interest-topics";
import { saveInterests, type InterestProfile } from "@/lib/ai/interests";
import { cn } from "@/lib/utils";
import { BackButton } from "@/components/yaronetic/back-button";

export function InterestSurvey({
  open,
  initialTopics,
  initialTone,
  canDismiss,
  onClose,
  onSaved,
}: {
  open: boolean;
  initialTopics: string[];
  initialTone: string;
  canDismiss: boolean;
  onClose: () => void;
  onSaved: (profile: InterestProfile) => void;
}) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [topics, setTopics] = useState<string[]>(initialTopics);
  const [tone, setTone] = useState<ToneId>(TONES.some((item) => item.id === initialTone) ? (initialTone as ToneId) : "clear");
  const [busy, setBusy] = useState(false);

  useEffect(() => setNode(document.body), []);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setStep(1);
      setTopics(initialTopics);
      setTone(TONES.some((item) => item.id === initialTone) ? (initialTone as ToneId) : "clear");
    }
    wasOpen.current = open;
  }, [open, initialTopics, initialTone]);

  const preview = useMemo(() => personalSuggestions(topics, tone)[0], [topics, tone]);
  const names = topics.map(topicLabel).filter(Boolean);

  async function finish(skipped: boolean) {
    if (busy) return;
    if (skipped && canDismiss) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      const saved = await saveInterests({
        data: { topics: skipped ? [] : topics, tone, skipped },
      });
      onSaved(saved);
      toast(skipped ? "Хорошо, вопросы останутся общими" : "Запомнила. На новом чате будут ваши вопросы");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не получилось сохранить");
    } finally {
      setBusy(false);
    }
  }

  function toggle(id: string) {
    setTopics((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length >= 8) {
        toast("Восьми тем хватит — так вопросы будут точнее");
        return current;
      }
      return [...current, id];
    });
  }

  if (!open || !node) return null;

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/55 p-3 sm:items-center" role="dialog" aria-modal="true" aria-label="Интересы">
      <div className="flex max-h-[min(100dvh-1.5rem,40rem)] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-line bg-elev shadow-[var(--shadow)]">
        <div className="flex items-center justify-between px-5 pt-5">
          <div className="flex items-center gap-2">
            {canDismiss ? <BackButton onClick={() => void finish(true)} label="Назад" /> : null}
            <div className="flex gap-1.5" aria-hidden="true">
              <span className={cn("h-1.5 w-6 rounded-full", step === 1 ? "bg-accent" : "bg-line")} />
              <span className={cn("h-1.5 w-6 rounded-full", step === 2 ? "bg-accent" : "bg-line")} />
            </div>
          </div>
          <button type="button" className={cn("press h-10 px-2 text-sm text-muted", canDismiss && "hidden md:inline-flex")} onClick={() => void finish(true)}>
            {canDismiss ? "Закрыть" : "Пропустить"}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
          {step === 1 ? (
            <>
              <h2 className="font-serif text-3xl tracking-tight">Что вам близко?</h2>
              <p className="mt-2 text-sm text-muted">
                Отметьте несколько тем. На пустом чате, когда вы вошли, вместо общих вопросов будут ваши.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {TOPICS.map((topic) => {
                  const on = topics.includes(topic.id);
                  return (
                    <button
                      key={topic.id}
                      type="button"
                      aria-pressed={on}
                      className={cn(
                        "press h-10 rounded-full border px-3 text-sm",
                        on ? "border-accent bg-accent text-accent-fg" : "border-line bg-subtle text-fg",
                      )}
                      onClick={() => toggle(topic.id)}
                    >
                      {topic.label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-4 min-h-5 text-sm text-faint">
                {names.length ? `Сейчас: ${names.join(", ")}` : "Можно выбрать до восьми."}
              </p>
            </>
          ) : (
            <>
              <h2 className="font-serif text-3xl tracking-tight">Как отвечать?</h2>
              <p className="mt-2 text-sm text-muted">Это тон быстрых вопросов. Сам чат по-прежнему отвечает на вашем языке.</p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                {TONES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={tone === item.id}
                    className={cn(
                      "press rounded-2xl border px-3 py-3 text-left text-sm",
                      tone === item.id ? "border-accent bg-subtle text-fg" : "border-line text-muted",
                    )}
                    onClick={() => setTone(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              {preview ? (
                <div className="mt-4 rounded-2xl border border-line bg-bg/40 px-4 py-3">
                  <p className="text-xs text-faint">Так будет выглядеть карточка</p>
                  <p className="mt-1 text-sm font-medium">{preview.title}</p>
                  <p className="mt-1 line-clamp-3 text-xs text-muted">{preview.prompt}</p>
                </div>
              ) : null}
            </>
          )}
        </div>
        <div className="flex gap-2 border-t border-line px-5 py-4">
          {step === 2 ? (
            <button type="button" className="press h-11 rounded-2xl border border-line px-4 text-sm" onClick={() => setStep(1)}>
              Назад
            </button>
          ) : null}
          <button
            type="button"
            disabled={busy || (step === 1 && topics.length === 0)}
            className="press h-11 flex-1 rounded-2xl bg-accent text-sm font-medium text-accent-fg disabled:opacity-40"
            onClick={() => {
              if (step === 1) setStep(2);
              else void finish(false);
            }}
          >
            {busy ? "Секунду…" : step === 1 ? "Дальше" : "Запомнить"}
          </button>
        </div>
      </div>
    </div>,
    node,
  );
}
