import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, Gauge, Radio, RotateCw, Square } from "lucide-react";
import { measureSpeed, type SpeedPhase, type SpeedResult } from "@/lib/speed/measure";
import { useTx } from "@/lib/lang";

const empty: SpeedResult = { download: null, upload: null, ping: null, jitter: null };
const value = (n: number | null) =>
  n === null ? "—" : n.toLocaleString("ru-RU", { maximumFractionDigits: 1 });
export function SpeedTest({ onBack }: { onBack: () => void }) {
  const tx = useTx();
  const [result, setResult] = useState<SpeedResult>(empty);
  const [phase, setPhase] = useState<SpeedPhase | "done" | null>(null);
  const [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);
  const busy = phase === "ping" || phase === "download" || phase === "upload";
  useEffect(
    () => () => {
      abort.current?.abort();
    },
    [],
  );
  async function start() {
    if (abort.current) return;
    const controller = new AbortController();
    abort.current = controller;
    setError("");
    setResult(empty);
    setPhase("ping");
    try {
      const next = await measureSpeed(
        AbortSignal.any([controller.signal, AbortSignal.timeout(45000)]),
        (step, next) => {
          setPhase(step);
          setResult(next);
        },
      );
      if (!controller.signal.aborted) {
        setResult(next);
        setPhase("done");
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(
          tx({
            ru: "Не удалось завершить тест. Проверьте соединение и попробуйте снова.",
            en: "The test could not finish. Check your connection and try again.",
            kk: "Тест аяқталмады. Байланысты тексеріп, қайталаңыз.",
          }),
        );
        setPhase(null);
      }
    } finally {
      if (abort.current === controller) abort.current = null;
    }
  }
  const label =
    phase === "ping"
      ? tx({ ru: "Проверяем задержку", en: "Measuring latency", kk: "Кідірісті өлшеу" })
      : phase === "download"
        ? tx({ ru: "Измеряем загрузку", en: "Measuring download", kk: "Жүктеуді өлшеу" })
        : phase === "upload"
          ? tx({ ru: "Измеряем отдачу", en: "Measuring upload", kk: "Жіберуді өлшеу" })
          : phase === "done"
            ? tx({ ru: "Измерение завершено", en: "Test complete", kk: "Өлшеу аяқталды" })
            : tx({
                ru: "Проверьте своё соединение",
                en: "Check your connection",
                kk: "Байланысты тексеріңіз",
              });
  const current = phase === "upload" ? result.upload : result.download;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-3 pt-3">
        <button
          type="button"
          onClick={onBack}
          className="press inline-flex h-11 items-center gap-1 rounded-xl px-2 text-sm text-muted"
        >
          <ChevronLeft className="size-4" />
          {tx({ ru: "Сервисы", en: "Services", kk: "Сервистер" })}
        </button>
        <h3 className="font-serif text-xl">
          {tx({ ru: "Скорость интернета", en: "Internet speed", kk: "Интернет жылдамдығы" })}
        </h3>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        <div className="speed-panel mx-auto max-w-lg rounded-3xl border border-line p-5 text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-subtle px-3 py-1 text-xs text-muted">
            <Radio className="size-3" />
            Cloudflare Edge
          </span>
          <div className="relative mx-auto mt-6 grid size-52 place-items-center rounded-full border border-line bg-elev shadow-[inset_0_0_40px_color-mix(in_oklab,var(--accent)_10%,transparent)]">
            <svg
              viewBox="0 0 200 200"
              className="absolute inset-0 size-full -rotate-90"
              aria-hidden="true"
            >
              <circle cx="100" cy="100" r="92" fill="none" stroke="var(--line)" strokeWidth="5" />
              <circle
                cx="100"
                cy="100"
                r="92"
                fill="none"
                stroke="var(--accent)"
                strokeWidth="5"
                strokeLinecap="round"
                strokeDasharray="578"
                strokeDashoffset={
                  busy
                    ? 578 * (1 - Math.min(0.96, Math.log10((current || 0) + 1) / 3))
                    : phase === "done"
                      ? 0
                      : 578
                }
                className="transition-[stroke-dashoffset] duration-500"
              />
            </svg>
            <div>
              <Gauge className="mx-auto mb-2 size-6 text-accent" />
              <p className="font-serif text-5xl tabular-nums">{value(current)}</p>
              <span className="text-xs text-muted">
                {tx({ ru: "Мбит/с", en: "Mbps", kk: "Мбит/с" })}
              </span>
            </div>
          </div>
          <p className="mt-5 text-sm" role="status" aria-live="polite">
            {label}
          </p>
          <div className="mt-5 grid grid-cols-2 gap-2 text-left">
            {[
              [
                ArrowDown,
                tx({ ru: "Загрузка", en: "Download", kk: "Жүктеу" }),
                result.download,
                "Мбит/с",
              ],
              [ArrowUp, tx({ ru: "Отдача", en: "Upload", kk: "Жіберу" }), result.upload, "Мбит/с"],
              [Radio, "Ping", result.ping, "ms"],
              [Gauge, "Jitter", result.jitter, "ms"],
            ].map(([Icon, title, n, unit]) => {
              const Mark = Icon as typeof Gauge;
              return (
                <div key={String(title)} className="rounded-2xl bg-subtle p-3">
                  <span className="flex items-center gap-1.5 text-xs text-muted">
                    <Mark className="size-3.5" />
                    {String(title)}
                  </span>
                  <p className="mt-1 text-xl tabular-nums">
                    {value(n as number | null)}{" "}
                    <span className="text-xs text-faint">{String(unit)}</span>
                  </p>
                </div>
              );
            })}
          </div>
          {error ? (
            <p className="mt-4 text-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}
          <button
            type="button"
            className="press mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-accent px-4 font-medium text-accent-fg"
            onClick={() => {
              if (busy) {
                abort.current?.abort();
                abort.current = null;
                setPhase(null);
              } else void start();
            }}
          >
            {busy ? <Square className="size-4" /> : <RotateCw className="size-4" />}
            {busy
              ? tx({ ru: "Остановить", en: "Stop", kk: "Тоқтату" })
              : tx({
                  ru: phase === "done" ? "Проверить ещё раз" : "Начать проверку",
                  en: "Start test",
                  kk: "Тексеруді бастау",
                })}
          </button>
        </div>
        <p className="mx-auto mt-4 max-w-lg text-xs leading-relaxed text-muted">
          {tx({
            ru: "Экспресс-тест до узла Cloudflare: загрузка, отдача и задержка. До 13 МБ трафика, без сохранения результатов. VPN, Wi-Fi и расстояние до сервера влияют на результат.",
            en: "Quick test to Cloudflare: download, upload and latency. Up to 13 MB of data; results are not saved. VPN, Wi-Fi and distance affect the result.",
            kk: "Cloudflare торабына экспресс-тест. 13 МБ дейін трафик, нәтиже сақталмайды. VPN, Wi-Fi және қашықтық нәтижеге әсер етеді.",
          })}
        </p>
      </div>
    </div>
  );
}
