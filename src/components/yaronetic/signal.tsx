import { useEffect, useState } from "react";

type Props = {
  kind: "builtin" | "custom";
  baseUrl: string;
  model: string;
  image: boolean;
  imageModel: string;
};

type Tone = "idle" | "ok" | "mid" | "bad";

function toneOf(ready: boolean, ok: boolean, ms: number | null): Tone {
  if (!ready) return "idle";
  if (!ok || ms == null) return "bad";
  if (ms < 200) return "ok";
  if (ms < 500) return "mid";
  return "bad";
}

function litBars(tone: Tone) {
  if (tone === "ok") return 4;
  if (tone === "mid") return 3;
  if (tone === "bad") return 1;
  return 0;
}

export function SignalPing({ kind, baseUrl, model, image, imageModel }: Props) {
  const [ready, setReady] = useState(false);
  const [ok, setOk] = useState(false);
  const [ms, setMs] = useState<number | null>(null);

  useEffect(() => {
    let stop = false;
    const ctrl = new AbortController();
    async function pull() {
      try {
        const res = await fetch("/api/ping", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind, baseUrl, model, image, imageModel }),
          signal: ctrl.signal,
        });
        const data = (await res.json()) as { ok?: boolean; ms?: number | null };
        if (stop) return;
        const next = typeof data.ms === "number" && Number.isFinite(data.ms) ? Math.max(1, Math.round(data.ms)) : null;
        setMs(next);
        setOk(Boolean(data.ok) && next != null);
        setReady(true);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (stop) return;
        setOk(false);
        setMs(null);
        setReady(true);
      }
    }
    void pull();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void pull();
    }, 12000);
    return () => {
      stop = true;
      ctrl.abort();
      window.clearInterval(timer);
    };
  }, [kind, baseUrl, model, image, imageModel]);

  const tone = toneOf(ready, ok, ms);
  const lit = litBars(tone);
  const label = !ready ? "Пинг до API модели" : ok && ms != null ? `${ms} мс` : "API модели не отвечает";

  return (
    <p className={`signal signal-${tone} ml-auto flex shrink-0 items-center gap-1.5 text-xs tabular-nums`} title={label} aria-label={label}>
      <span className="signal-bars" aria-hidden="true">
        {[0, 1, 2, 3].map((index) => (
          <i key={index} className={index < lit ? "on" : "off"} />
        ))}
      </span>
    </p>
  );
}
