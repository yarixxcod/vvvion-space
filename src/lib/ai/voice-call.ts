import { voiceBoundary, voiceText } from "./voice-turn";

export type CallPhase =
  | "ready"
  | "connecting"
  | "listening"
  | "transcribing"
  | "thinking"
  | "speaking"
  | "paused"
  | "playback"
  | "error"
  | "ended";
export type CallState = {
  phase: CallPhase;
  text: string;
  reply: string;
  error: string;
  level: number;
  muted: boolean;
};
export const EMPTY_CALL: CallState = {
  phase: "ready",
  text: "",
  reply: "",
  error: "",
  level: 0,
  muted: false,
};
export type VoiceReply = { text: string; error?: string };

/** One microphone, one recorder and one turn at a time. Never records the TTS output. */
export class VoiceCall {
  private state = { ...EMPTY_CALL };
  private stream?: MediaStream;
  private context?: AudioContext;
  private source?: MediaStreamAudioSourceNode;
  private analyser?: AnalyserNode;
  private recorder?: MediaRecorder;
  private audio?: HTMLAudioElement;
  private url = "";
  private tick = 0;
  private epoch = 0;
  private ended = false;
  private abort = new AbortController();
  private resumeAfter?: () => void;
  private pendingTurn?: Promise<VoiceReply | undefined>;
  private started = 0;
  private lastSpeech = 0;
  private voiced = 0;
  private samples = new Float32Array(512);
  constructor(
    private publish: (state: CallState) => void,
    private turn: (text: string) => Promise<VoiceReply | undefined>,
    private stopTurn: () => void,
  ) {}
  private patch(next: Partial<CallState>) {
    this.state = { ...this.state, ...next };
    if (!this.ended) this.publish(this.state);
  }
  async start() {
    if (this.state.phase !== "ready") return;
    this.patch({ phase: "connecting", error: "" });
    const epoch = this.epoch;
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined")
        throw Error("В этом браузере недоступен микрофон. Откройте сайт в Chrome или Safari.");
      // Created during the start gesture, before awaiting permission/network.
      this.context = new AudioContext();
      const resume = this.context.resume();
      this.audio = new Audio();
      this.audio.setAttribute("playsinline", "true");
      this.audio.src =
        "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
      void this.audio.play().catch(() => undefined);
      const streamPromise = navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      void streamPromise
        .then((stream) => {
          if (this.ended || epoch !== this.epoch) stream.getTracks().forEach((t) => t.stop());
        })
        .catch(() => undefined);
      await resume;
      if (this.ended) {
        void streamPromise
          .then((stream) => stream.getTracks().forEach((t) => t.stop()))
          .catch(() => undefined);
        return;
      }
      const stream = await streamPromise;
      if (this.ended || epoch !== this.epoch) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;
      stream.getAudioTracks().forEach((t) => {
        t.enabled = false;
      });
      stream.getAudioTracks().forEach((t) => {
        t.onended = () => {
          if (!this.ended) this.fail("Микрофон отключён. Завершите звонок и подключитесь снова.");
        };
      });
      const statuses = await Promise.all([
        fetch("/api/transcribe", {
          signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(12_000)]),
        }),
        fetch("/api/tts", {
          signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(12_000)]),
        }),
      ]);
      const info = await Promise.all(statuses.map((r) => r.json()));
      if (this.ended) return;
      if (!statuses[0].ok || !info[0].ready)
        throw Error("Whisper не подключён. Проверьте расшифровку в администрировании.");
      if (!statuses[1].ok || !info[1].ready)
        throw Error("TTS не подключён. Добавьте модель голоса в администрировании.");
      this.source = this.context.createMediaStreamSource(stream);
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 512;
      this.source.connect(this.analyser);
      this.listen();
    } catch (error) {
      if (this.ended) return;
      const name = error instanceof Error ? error.name : "";
      this.fail(
        name === "NotAllowedError"
          ? "Разрешите микрофон для звонка в настройках браузера или приложения."
          : name === "NotFoundError"
            ? "Микрофон не найден."
            : error instanceof Error
              ? error.message
              : "Не удалось подключить звонок.",
      );
    }
  }
  private fail(error: string) {
    this.epoch++;
    this.abort.abort();
    if (this.state.phase === "thinking") this.stopTurn();
    this.silence();
    this.stream?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    this.source?.disconnect();
    void this.context?.close().catch(() => undefined);
    this.audio?.pause();
    this.patch({ phase: "error", error, level: 0 });
  }
  private silence() {
    window.clearInterval(this.tick);
    this.tick = 0;
    const rec = this.recorder;
    this.recorder = undefined;
    if (rec && rec.state !== "inactive") {
      rec.onstop = null;
      rec.stop();
    }
  }
  private listen() {
    if (this.ended) return;
    if (this.state.muted || document.hidden) {
      this.patch({ phase: "paused", level: 0 });
      return;
    }
    if (!this.stream || !this.analyser) return;
    try {
      this.stream.getAudioTracks().forEach((t) => {
        t.enabled = true;
      });
      const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg"].find((t) =>
        MediaRecorder.isTypeSupported(t),
      );
      const rec = new MediaRecorder(this.stream, {
        ...(mime ? { mimeType: mime } : {}),
        audioBitsPerSecond: 48000,
      });
      this.recorder = rec;
      const parts: Blob[] = [];
      const epoch = this.epoch;
      rec.ondataavailable = (e) => {
        if (e.data.size) parts.push(e.data);
      };
      rec.onerror = () => {
        if (epoch === this.epoch && !this.ended)
          this.fail("Запись прервалась. Подключитесь снова.");
      };
      rec.onstop = () => {
        if (epoch !== this.epoch || this.ended) return;
        const blob = new Blob(parts, { type: rec.mimeType || "audio/webm" });
        if (this.voiced < 240 || blob.size < 400) {
          this.listen();
          return;
        }
        void this.process(blob, epoch);
      };
      this.started = this.lastSpeech = performance.now();
      this.voiced = 0;
      this.patch({ phase: "listening", level: 0 });
      rec.start(200);
      let last = this.started;
      this.tick = window.setInterval(() => {
        if (!this.analyser || rec.state !== "recording") return;
        this.analyser.getFloatTimeDomainData(this.samples);
        const rms = Math.sqrt(this.samples.reduce((s, v) => s + v * v, 0) / this.samples.length);
        const now = performance.now();
        if (rms > 0.018) {
          this.lastSpeech = now;
          this.voiced += Math.min(now - last, 160);
        }
        last = now;
        this.patch({ level: Math.min(1, rms * 9) });
        if (voiceBoundary(now, this.started, this.lastSpeech, this.voiced) !== "wait")
          this.finishPhrase();
      }, 80);
    } catch (error) {
      this.fail(error instanceof Error ? error.message : "Не удалось начать запись.");
    }
  }
  finishPhrase() {
    const rec = this.recorder;
    if (!rec || rec.state !== "recording") return;
    window.clearInterval(this.tick);
    this.tick = 0;
    this.stream?.getAudioTracks().forEach((t) => {
      t.enabled = false;
    });
    this.patch({ level: 0 });
    rec.stop();
  }
  private async process(blob: Blob, epoch: number) {
    try {
      this.patch({ phase: "transcribing", error: "" });
      const body = new FormData();
      body.set(
        "file",
        new File([blob], blob.type.includes("mp4") ? "call.m4a" : "call.webm", { type: blob.type }),
      );
      const res = await fetch("/api/transcribe", {
        method: "POST",
        body,
        headers: { "x-vvvion-call": "1" },
        signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(65_000)]),
      });
      const data = await res.json();
      if (this.ended || epoch !== this.epoch) return;
      if (res.status === 422) {
        this.listen();
        return;
      }
      if (!res.ok) throw Error(data.message || "Whisper не ответил.");
      const text = typeof data.text === "string" ? data.text.trim() : "";
      if (!text) {
        this.listen();
        return;
      }
      this.patch({ phase: "thinking", text });
      const pending = this.turn(text);
      this.pendingTurn = pending;
      const reply = await pending;
      if (this.pendingTurn === pending) this.pendingTurn = undefined;
      if (this.ended || epoch !== this.epoch) return;
      if (!reply || reply.error)
        throw Error(reply?.error || "Модель не ответила. Проверьте доступ к выбранной модели.");
      const spoken = voiceText(reply.text);
      this.patch({ reply: reply.text });
      if (!spoken) {
        this.listen();
        return;
      }
      this.patch({ phase: "speaking" });
      const speech = await fetch("/api/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: spoken }),
        signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(50_000)]),
      });
      if (!speech.ok) {
        const err = await speech.json().catch(() => ({}));
        throw Error(err.message || "Не удалось озвучить ответ.");
      }
      const audio = await speech.blob();
      if (this.ended || epoch !== this.epoch) return;
      if (this.url) URL.revokeObjectURL(this.url);
      this.url = URL.createObjectURL(audio);
      this.audio!.src = this.url;
      this.audio!.onended = () => {
        if (epoch === this.epoch && !this.ended) this.listen();
      };
      this.audio!.onerror = () => {
        if (!this.ended && epoch === this.epoch) this.fail("Не удалось воспроизвести голос.");
      };
      this.resumeAfter = () => {
        void this.audio
          ?.play()
          .then(() => this.patch({ phase: "speaking" }))
          .catch(() => this.patch({ phase: "playback" }));
      };
      try {
        await this.audio!.play();
      } catch {
        this.patch({ phase: "playback" });
      }
    } catch (error) {
      if (this.ended || epoch !== this.epoch) return;
      this.fail(error instanceof Error ? error.message : "Звонок прервался.");
    }
  }
  toggleMute() {
    const muted = !this.state.muted;
    this.patch({ muted });
    if (muted && this.state.phase === "listening") {
      this.silence();
      this.stream?.getTracks().forEach((t) => {
        t.enabled = false;
      });
      this.patch({ phase: "paused", level: 0 });
    } else if (!muted && this.state.phase === "paused") this.listen();
  }
  interrupt() {
    if (this.ended) return;
    this.epoch++;
    this.abort.abort();
    this.abort = new AbortController();
    this.silence();
    this.audio?.pause();
    this.resumeAfter = undefined;
    this.stopTurn();
    this.patch({ error: "", phase: "paused", level: 0 });
    const epoch = this.epoch;
    if (this.pendingTurn)
      void this.pendingTurn
        .catch(() => undefined)
        .then(() => {
          if (!this.ended && epoch === this.epoch) this.listen();
        });
    else this.listen();
  }
  resumeAudio() {
    this.resumeAfter?.();
  }
  visibility() {
    if (document.hidden && this.state.phase === "listening") {
      this.silence();
      this.stream?.getTracks().forEach((t) => {
        t.enabled = false;
      });
      this.patch({ phase: "paused", level: 0 });
    } else if (!document.hidden && this.state.phase === "paused" && !this.state.muted) {
      void this.context?.resume();
      this.listen();
    }
  }
  close() {
    if (this.ended) return;
    this.ended = true;
    this.epoch++;
    this.abort.abort();
    this.silence();
    if (this.state.phase === "thinking") this.stopTurn();
    this.audio?.pause();
    if (this.audio) {
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio.src = "";
    }
    this.stream?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    this.source?.disconnect();
    void this.context?.close().catch(() => undefined);
    if (this.url) URL.revokeObjectURL(this.url);
  }
}
