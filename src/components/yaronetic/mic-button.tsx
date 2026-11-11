import { useEffect, useRef, useState } from "react";
import { Mic } from "lucide-react";
import { toast } from "sonner";
import type { ChatFile } from "@/lib/ai/types";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";

const MAX_MS = 90_000;
const SPEECH_LANG = { ru: "ru-RU", en: "en-US", kk: "kk-KZ" } as const;

type SpeechAlt = { transcript?: string };
type SpeechHit = { isFinal: boolean; 0?: SpeechAlt };
type SpeechEvent = { results: ArrayLike<SpeechHit> };
type SpeechRec = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function mimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  return types.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function speechCtor(): (new () => SpeechRec) | null {
  if (typeof window === "undefined") return null;
  const host = window as Window & { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
  return host.SpeechRecognition || host.webkitSpeechRecognition || null;
}

function joinText(base: string, said: string) {
  const left = base.trim();
  const right = said.replace(/\s+/g, " ").trim();
  if (!left) return right;
  if (!right) return left;
  return `${left} ${right}`;
}

export function MicButton({
  value,
  onChange,
  onVoice,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  onVoice?: (file: ChatFile) => void;
  disabled?: boolean;
}) {
  const lang = useLang();
  const [phase, setPhase] = useState<"idle" | "rec" | "work">("idle");
  const [seconds, setSeconds] = useState(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const tickRef = useRef(0);
  const capRef = useRef(0);
  const partialRef = useRef(0);
  const valueRef = useRef(value);
  const phaseRef = useRef(phase);
  const baseRef = useRef("");
  const saidRef = useRef("");
  const engineRef = useRef<"speech" | "whisper">("whisper");
  const speechRef = useRef<SpeechRec | null>(null);
  const partialBusy = useRef(false);
  valueRef.current = value;
  phaseRef.current = phase;

  function release() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  function clearTimers() {
    window.clearInterval(tickRef.current);
    window.clearTimeout(capRef.current);
    window.clearInterval(partialRef.current);
  }

  function paint(said: string) {
    saidRef.current = said;
    onChange(joinText(baseRef.current, said));
  }

  useEffect(() => {
    return () => {
      clearTimers();
      const speech = speechRef.current;
      speechRef.current = null;
      if (speech) {
        speech.onend = null;
        speech.onresult = null;
        try {
          speech.stop();
        } catch {
          /* already stopped */
        }
      }
      const rec = recRef.current;
      recRef.current = null;
      if (rec && rec.state !== "inactive") {
        rec.onstop = null;
        rec.stop();
      }
      release();
    };
  }, []);

  useEffect(() => {
    if (disabled && phaseRef.current === "rec") stop();
    // stop only touches refs and the recorder that is already running.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);

  function stop() {
    clearTimers();
    const speech = speechRef.current;
    speechRef.current = null;
    if (speech) {
      speech.onend = null;
      try {
        speech.stop();
      } catch {
        /* already stopped */
      }
    }
    const rec = recRef.current;
    if (!rec || rec.state === "inactive") {
      release();
      setPhase("idle");
      setSeconds(0);
      return;
    }
    setPhase("work");
    rec.stop();
  }

  async function transcribe(blob: Blob, partial: boolean): Promise<string> {
    const body = new FormData();
    body.set("file", new File([blob], "voice.webm", { type: blob.type || "audio/webm" }));
    const res = await fetch("/api/transcribe", {
      method: "POST",
      body,
      credentials: "same-origin",
      headers: partial ? { "x-vvvion-partial": "1" } : undefined,
      signal: AbortSignal.timeout(partial ? 20_000 : 60_000),
    });
    const data = (await res.json().catch(() => ({}))) as { text?: string; message?: string };
    if (!res.ok) {
      if (partial) return "";
      throw new Error(data.message || "Не удалось расшифровать запись");
    }
    return typeof data.text === "string" ? data.text.trim() : "";
  }

  async function pushPartial() {
    if (partialBusy.current || phaseRef.current !== "rec" || engineRef.current !== "whisper") return;
    const blob = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type || "audio/webm" });
    if (blob.size < 1200) return;
    partialBusy.current = true;
    try {
      const text = await transcribe(blob, true);
      if (text && phaseRef.current === "rec") paint(text);
    } catch {
      /* the next slice will try again */
    } finally {
      partialBusy.current = false;
    }
  }

  async function upload(blob: Blob) {
    setPhase("work");
    try {
      if (blob.size < 400) {
        if (!saidRef.current.trim()) toast("Запись слишком короткая");
        return;
      }
      const type = blob.type || "audio/webm";
      const file = new File([blob], "voice.webm", { type });
      const saved = await fetch("/api/disk", {
        method: "POST",
        body: (() => {
          const body = new FormData();
          body.set("file", file);
          return body;
        })(),
        credentials: "same-origin",
      });
      const info = (await saved.json().catch(() => ({}))) as { url?: string; name?: string; mime?: string; message?: string };
      if (saved.ok && info.url && onVoice) {
        onVoice({
          id: crypto.randomUUID(),
          name: info.name || "voice.webm",
          mime: info.mime || type.split(";")[0] || "audio/webm",
          kind: "audio",
          url: info.url,
        });
      } else if (saved.status === 409) {
        toast.error(info.message || "На диске нет места, голос не сохранился");
      }
      if (engineRef.current === "speech" && saidRef.current.trim()) return;
      const text = await transcribe(file, false);
      if (!text) {
        if (!saidRef.current.trim()) toast.error("В записи не разобрать слов");
        return;
      }
      paint(text);
    } catch (error) {
      if (!saidRef.current.trim()) toast.error(error instanceof Error ? error.message : "Не удалось расшифровать запись");
    } finally {
      setPhase("idle");
      setSeconds(0);
    }
  }

  function armSpeech() {
    const Ctor = speechCtor();
    if (!Ctor) return false;
    const recog = new Ctor();
    recog.lang = SPEECH_LANG[lang] || "ru-RU";
    recog.continuous = true;
    recog.interimResults = true;
    recog.onresult = (event) => {
      let finalText = "";
      let interim = "";
      for (let i = 0; i < event.results.length; i += 1) {
        const hit = event.results[i];
        const piece = hit?.[0]?.transcript || "";
        if (hit?.isFinal) finalText += piece;
        else interim += piece;
      }
      paint(`${finalText} ${interim}`);
    };
    recog.onerror = (event) => {
      const code = event.error || "";
      if (code === "not-allowed" || code === "service-not-allowed") {
        toast.error("Нет доступа к микрофону");
        stop();
        return;
      }
      if (code === "network" || code === "audio-capture") {
        engineRef.current = "whisper";
        if (speechRef.current === recog) speechRef.current = null;
        recog.onend = null;
        try {
          recog.stop();
        } catch {
          /* already stopped */
        }
        window.clearInterval(partialRef.current);
        partialRef.current = window.setInterval(() => void pushPartial(), 2800);
      }
    };
    recog.onend = () => {
      if (speechRef.current !== recog || phaseRef.current !== "rec") return;
      const committed = saidRef.current.trim();
      if (committed) {
        baseRef.current = joinText(baseRef.current, committed);
        saidRef.current = "";
      }
      try {
        recog.start();
      } catch {
        engineRef.current = "whisper";
      }
    };
    try {
      speechRef.current = recog;
      recog.start();
    } catch {
      speechRef.current = null;
      return false;
    }
    return true;
  }

  async function start() {
    if (phaseRef.current !== "idle" || disabled) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast.error("В этом браузере нет микрофона");
      return;
    }
    const canSpeak = Boolean(speechCtor());
    if (!canSpeak) {
      try {
        const status = await fetch("/api/transcribe", { credentials: "same-origin" });
        const info = (await status.json().catch(() => ({}))) as { ready?: boolean; message?: string };
        if (!info.ready) {
          toast.error(info.message || "Расшифровка ещё не подключена");
          return;
        }
      } catch {
        toast.error("Расшифровка сейчас недоступна");
        return;
      }
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") toast.error("Нет доступа к микрофону");
      else if (name === "NotFoundError" || name === "OverconstrainedError") toast.error("Микрофон не найден");
      else toast.error("Не удалось включить микрофон");
      return;
    }

    baseRef.current = valueRef.current;
    saidRef.current = "";
    engineRef.current = armSpeech() ? "speech" : "whisper";
    const mime = mimeType();
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    chunksRef.current = [];
    rec.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    rec.onstop = () => {
      release();
      const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
      chunksRef.current = [];
      void upload(blob);
    };
    streamRef.current = stream;
    recRef.current = rec;
    rec.start(250);
    setPhase("rec");
    setSeconds(0);
    tickRef.current = window.setInterval(() => setSeconds((n) => n + 1), 1000);
    if (engineRef.current === "whisper") partialRef.current = window.setInterval(() => void pushPartial(), 2800);
    capRef.current = window.setTimeout(() => {
      if (recRef.current === rec && rec.state === "recording") stop();
    }, MAX_MS);
  }

  const label = phase === "rec" ? "Остановить и оставить текст" : phase === "work" ? "Дописываю текст" : "Голосовой ввод";
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <button
      type="button"
      className={cn(
        "mic-btn press relative inline-flex h-10 items-center justify-center rounded-2xl border",
        phase === "rec" ? "mic-live w-[4.5rem] gap-1.5 border-accent bg-accent/15 text-accent" : "size-10 border-line text-muted",
        phase === "work" && "mic-wait",
      )}
      aria-label={label}
      title={label}
      aria-pressed={phase === "rec"}
      disabled={disabled || phase === "work"}
      onClick={() => {
        if (phase === "rec") stop();
        else void start();
      }}
    >
      {phase === "rec" ? <span className="mic-ring" aria-hidden /> : null}
      {phase === "rec" ? (
        <>
          <span className="mic-bars" aria-hidden>
            <span />
            <span />
            <span />
            <span />
          </span>
          <span className="text-xs tabular-nums">{clock}</span>
        </>
      ) : (
        <Mic className="size-4" />
      )}
    </button>
  );
}
