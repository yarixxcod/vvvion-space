import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AudioLines, MicOff, Play, Square, X } from "lucide-react";
import { VoiceCall, EMPTY_CALL, type CallPhase, type VoiceReply } from "@/lib/ai/voice-call";
import { pushBackLayer } from "@/lib/app-back";
import { ModelFace, type FaceVariant } from "./model-face";
import { CatalogArt } from "./catalog-art";

const STATUS: Record<CallPhase, string> = {
  ready: "Голосовой разговор",
  connecting: "Подключаю микрофон…",
  listening: "Слушаю вас",
  transcribing: "Распознаю речь…",
  thinking: "Обдумываю ответ…",
  speaking: "Говорю",
  paused: "Микрофон на паузе",
  playback: "Нажмите, чтобы услышать ответ",
  error: "Нужна ваша помощь",
  ended: "Звонок завершён",
};
export function VoiceCallDialog({
  name,
  model,
  face,
  personaId,
  userName,
  userImage,
  onTurn,
  onStop,
  onClose,
}: {
  name: string;
  model: string;
  face: FaceVariant;
  personaId?: string | null;
  userName: string;
  userImage?: string | null;
  onTurn: (text: string) => Promise<VoiceReply | undefined>;
  onStop: () => void;
  onClose: () => void;
}) {
  const [state, setState] = useState(EMPTY_CALL);
  const [seconds, setSeconds] = useState(0);
  const [details, setDetails] = useState(false);
  const engine = useRef<VoiceCall | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onTurn, onStop, onClose });
  callbacks.current = { onTurn, onStop, onClose };
  const [active, setActive] = useState(false);
  useEffect(() => {
    const prior = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    const unback = pushBackLayer(() => callbacks.current.onClose());
    const visibility = () => engine.current?.visibility();
    document.addEventListener("visibilitychange", visibility);
    const onPageHide = () => {
      engine.current?.close();
      callbacks.current.onClose();
    };
    window.addEventListener("pagehide", onPageHide);
    const boot = window.setTimeout(() => start(), 0);
    return () => {
      window.clearTimeout(boot);
      engine.current?.close();
      engine.current = null;
      unback();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", onPageHide);
      document.body.style.overflow = bodyOverflow;
      prior?.focus();
    };
  }, []);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setSeconds((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  function start() {
    engine.current?.close();
    engine.current = new VoiceCall(
      (next) => {
        setState(next);
        if (next.phase === "error") setActive(false);
      },
      (text) => callbacks.current.onTurn(text),
      () => callbacks.current.onStop(),
    );
    setState(EMPTY_CALL);
    setSeconds(0);
    setActive(true);
    void engine.current.start();
  }
  const busy = ["transcribing", "thinking", "speaking", "playback"].includes(state.phase);
  const canStart = state.phase === "ready" || state.phase === "error";
  return createPortal(
    <div
      ref={dialog}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby="voice-call-title"
      className="voice-call fixed inset-0 z-[110] flex flex-col overflow-hidden bg-bg text-fg outline-none"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          callbacks.current.onClose();
        }
        if (event.key === "Tab") {
          const buttons = [
            ...(dialog.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled), [href], [tabindex="0"]',
            ) ?? []),
          ];
          const first = buttons[0],
            last = buttons[buttons.length - 1];
          if (
            event.shiftKey &&
            (document.activeElement === first || document.activeElement === dialog.current)
          ) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-5 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-8">
        <div className="flex min-w-0 items-center gap-2">
          {userImage ? <img src={userImage} alt="" className="size-8 shrink-0 rounded-full object-cover" /> : null}
          <div className="min-w-0">
          <h2 id="voice-call-title" className="truncate font-medium">
            {name}
          </h2>
          <p className="truncate text-sm text-muted">
            {model} · {userName || "Вы"}
            {active ? ` · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : ""}
          </p>
          </div>
        </div>
        <button
          type="button"
          aria-label="Закрыть звонок"
          className="press grid size-11 shrink-0 place-items-center rounded-full border border-line"
          onClick={onClose}
        >
          <X className="size-5" />
        </button>
      </header>
      <main className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col items-center justify-center gap-6 overflow-y-auto px-5 py-6 sm:gap-8">
        <div
          className="voice-call-portrait relative grid size-44 shrink-0 place-items-center rounded-full sm:size-60"
          data-phase={state.phase}
          style={{ "--voice-level": state.level } as React.CSSProperties}
        >
          <div
            className="voice-call-halo absolute inset-0 rounded-full border border-accent/40"
            aria-hidden
          />
          <div className="relative grid size-36 place-items-center overflow-hidden rounded-full bg-elev shadow-[var(--shadow)] sm:size-48">
            {personaId ? (
              <CatalogArt
                kind="personas"
                id={personaId}
                alt={name}
                className="size-full rounded-full"
              />
            ) : (
              <div className="voice-call-face">
                <ModelFace
                  name={name}
                  variant={face}
                  size={176}
                  mood={
                    state.phase === "speaking"
                      ? "talk"
                      : state.phase === "thinking" || state.phase === "transcribing"
                        ? "think"
                        : state.phase === "error"
                          ? "oops"
                          : "idle"
                  }
                />
              </div>
            )}
          </div>
        </div>
        <div className="text-center">
          <p aria-live="polite" role="status" className="text-xl font-medium sm:text-2xl">
            {STATUS[state.phase]}
          </p>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
            {state.phase === "ready"
              ? "Говорите, делайте паузу — ответ прозвучит автоматически. Текст беседы останется в этом чате."
              : state.phase === "listening"
                ? "Закончите фразу и сделайте паузу"
                : state.phase === "paused"
                  ? "Включите микрофон, когда будете готовы"
                  : state.phase === "speaking"
                    ? "Можно прервать ответ и продолжить"
                    : state.phase === "transcribing"
                      ? "Превращаю вашу реплику в текст"
                      : state.phase === "thinking"
                        ? "Ответ появится и в чате"
                        : "Разговор продолжается"}
          </p>
        </div>
        {state.error ? (
          <p
            role="alert"
            className="max-w-md rounded-2xl border border-danger/30 bg-danger/5 px-4 py-3 text-center text-sm text-danger"
          >
            {state.error}
          </p>
        ) : null}
        {state.phase === "playback" ? (
          <button
            type="button"
            className="press flex min-h-11 items-center gap-2 rounded-full bg-accent px-5 text-accent-fg"
            onClick={() => engine.current?.resumeAudio()}
          >
            <Play className="size-4" />
            Воспроизвести ответ
          </button>
        ) : null}
        {state.text || state.reply ? (
          <div className="w-full max-w-xl">
            <button
              type="button"
              aria-expanded={details}
              className="press mx-auto block min-h-11 rounded-xl px-4 text-sm text-muted"
              onClick={() => setDetails((v) => !v)}
            >
              {details ? "Скрыть реплики" : "Показать реплики"}
            </button>
            {details ? (
              <div className="max-h-40 space-y-3 overflow-y-auto rounded-2xl border border-line bg-elev p-4 text-sm sm:max-h-52">
                {state.text ? (
                  <p>
                    <span className="font-medium">Вы: </span>
                    {state.text}
                  </p>
                ) : null}
                {state.reply ? (
                  <p className="whitespace-pre-wrap">
                    <span className="font-medium">{name}: </span>
                    {state.reply}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </main>
      <footer className="shrink-0 px-6 pt-2 pb-[max(1.75rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-center gap-16">
          {busy ? (
            <button
              type="button"
              className="press grid size-20 shrink-0 place-items-center rounded-full border border-line bg-elev text-fg outline-none focus-visible:outline-none"
              aria-label="Прервать ответ"
              onClick={() => engine.current?.interrupt()}
            >
              <Square className="size-6" />
            </button>
          ) : (
            <button
              type="button"
              className="press grid size-20 shrink-0 place-items-center rounded-full border border-line bg-elev text-fg outline-none focus-visible:outline-none"
              aria-pressed={state.muted}
              aria-label={canStart ? "Подключиться снова" : state.muted ? "Включить микрофон" : "Выключить микрофон"}
              onClick={() => {
                if (canStart) start();
                else engine.current?.toggleMute();
              }}
            >
              {state.muted ? <MicOff className="size-7" /> : <AudioLines className="size-7" />}
            </button>
          )}
          <button
            type="button"
            className="press grid size-20 shrink-0 place-items-center rounded-full border border-[#e11d48] bg-[#e11d48] text-white outline-none focus-visible:outline-none"
            aria-label="Завершить звонок"
            onClick={onClose}
          >
            <X className="size-7" />
          </button>
        </div>
      </footer>
    </div>,
    document.body,
  );
}
