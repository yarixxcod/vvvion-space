import { useEffect, useRef, useState, type FormEvent } from "react";
import { ChevronLeft, ClipboardPaste, Download, Link, LoaderCircle, X } from "lucide-react";
import { toast } from "sonner";
import { FileVideo } from "@/components/yaronetic/fit-video";
import { getBearerToken } from "@/lib/auth/client";
import { useTx } from "@/lib/lang";
import { clipHost } from "@/lib/social/grab-url";
import { normalizeGrabUrl, type GrabMode } from "@/lib/social/grab-options";
import { readGrabStream } from "@/lib/social/grab-stream";
import type { Grabbed } from "@/lib/social/grab";
import { downloadMegaFile, megaFileUrl } from "@/lib/social/mega-upload";

type Pull = { label: string; pct: number };
type Tick = {
  type: "progress";
  phase: "open" | "fetch" | "save";
  pct: number;
  loaded: number;
  total: number;
};

function sizeLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / (1024 * 1024)).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} МБ`;
}

function speedLabel(bytesPerSec: number) {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec < 1024)
    return `${Math.max(0, Math.round(bytesPerSec))} Б/с`;
  if (bytesPerSec < 1024 * 1024) return `${Math.max(1, Math.round(bytesPerSec / 1024))} КБ/с`;
  return `${(bytesPerSec / (1024 * 1024)).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} МБ/с`;
}

export function Grabber({ onBack }: { onBack: () => void }) {
  const tx = useTx();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [pull, setPull] = useState<Pull | null>(null);
  const [saving, setSaving] = useState<(Pull & { id: string }) | null>(null);
  const [files, setFiles] = useState<Grabbed[]>([]);
  const started = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const [mode, setMode] = useState<GrabMode>("video");
  const [error, setError] = useState("");
  const [stage, setStage] = useState<Tick["phase"]>("open");
  const isYoutube = /(?:youtube\.com|youtu\.be|youtube-nocookie\.com)/i.test(url);
  const host = (() => {
    try {
      return clipHost(normalizeGrabUrl(url));
    } catch {
      return null;
    }
  })();
  const hostName =
    host === "youtube"
      ? "YouTube"
      : host === "instagram"
        ? "Instagram"
        : host === "tiktok"
          ? "TikTok"
          : host === "pinterest"
            ? "Pinterest"
            : host === "vk"
              ? "VK"
              : "";
  useEffect(() => () => abort.current?.abort(), []);

  function applyPaste(text: string) {
    try {
      setUrl(normalizeGrabUrl(text));
      setError("");
    } catch (err) {
      const clean = text.replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").trim().slice(0, 4000);
      setUrl(clean);
      setError(
        err instanceof Error
          ? err.message
          : tx({ ru: "Нужна ссылка", en: "A link is required", kk: "Сілтеме керек" }),
      );
    }
  }

  function labelOf(tick: Tick): Pull {
    if (tick.phase === "open")
      return {
        label: tx({ ru: "Открываю ссылку", en: "Opening the link", kk: "Сілтемені ашамын" }),
        pct: tick.pct,
      };
    if (tick.phase === "save")
      return {
        label: tx({ ru: "Сохраняю", en: "Saving", kk: "Сақтаймын" }),
        pct: Math.max(tick.pct, 90),
      };
    const secs = Math.max(0.25, (performance.now() - started.current) / 1000);
    const speed = speedLabel((tick.loaded || 0) / secs);
    if (tick.total > 0) return { label: `${tick.pct}% · ${speed}`, pct: tick.pct };
    if (tick.loaded > 0)
      return { label: `${sizeLabel(tick.loaded)} · ${speed}`, pct: Math.max(tick.pct, 12) };
    return {
      label: tx({ ru: "Скачиваю", en: "Downloading", kk: "Жүктеп жатырмын" }),
      pct: Math.max(tick.pct, 12),
    };
  }

  async function run(event: FormEvent) {
    event.preventDefault();
    if (busy || !url.trim()) return;
    let link = "";
    try {
      link = normalizeGrabUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Нужна ссылка");
      return;
    }
    const controller = new AbortController();
    abort.current = controller;
    setError("");
    setStage("open");
    setBusy(true);
    setFiles([]);
    setSaving(null);
    started.current = performance.now();
    setPull({
      label: tx({ ru: "Открываю ссылку", en: "Opening the link", kk: "Сілтемені ашамын" }),
      pct: 6,
    });
    try {
      const token = getBearerToken();
      const res = await fetch("/api/grab", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ url: link, mode: clipHost(link) === "youtube" ? mode : "video" }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(
          data?.message || tx({ ru: "Не скачалось", en: "It did not download", kk: "Жүктелмеді" }),
        );
      }
      let doneFiles: Grabbed[] | null = null;
      let failed = "";
      await readGrabStream<Grabbed>(res.body, (event) => {
        if (event.type === "progress") {
          setStage(event.phase);
          setPull(labelOf(event));
        } else if (event.type === "done") doneFiles = event.files;
        else if (event.type === "error") failed = event.message;
      });
      if (failed) throw new Error(failed);
      const completed = doneFiles as Grabbed[] | null;
      if (!completed?.length)
        throw new Error(tx({ ru: "Не скачалось", en: "It did not download", kk: "Жүктелмеді" }));
      setPull({ label: "100%", pct: 100 });
      setFiles(completed);
      toast(
        tx({
          ru:
            completed.length > 1
              ? `${completed.length} файла на мегадиске пять минут`
              : "Файл на мегадиске пять минут",
          en:
            completed.length > 1
              ? `${completed.length} files stay on the megadisk for five minutes`
              : "The file stays on the megadisk for five minutes",
          kk:
            completed.length > 1
              ? `${completed.length} файл мегадискте бес минут тұрады`
              : "Файл мегадискте бес минут тұрады",
        }),
      );
    } catch (err) {
      if (!controller.signal.aborted)
        setError(
          err instanceof Error
            ? err.message
            : tx({ ru: "Не скачалось", en: "It did not download", kk: "Жүктелмеді" }),
        );
    } finally {
      if (abort.current === controller) {
        abort.current = null;
        setBusy(false);
        setPull(null);
      }
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-3 pt-3">
        <button
          type="button"
          className="press inline-flex h-11 items-center gap-1 rounded-xl px-2 text-sm text-muted"
          onClick={onBack}
        >
          <ChevronLeft className="size-4" />
          {tx({ ru: "Сервисы", en: "Services", kk: "Сервистер" })}
        </button>
        <h3 className="font-serif text-xl">
          {tx({ ru: "Загрузчик", en: "Downloader", kk: "Жүктеуіш" })}
        </h3>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      <form className="space-y-3 rounded-3xl border border-line bg-elev p-3" onSubmit={(event) => void run(event)}>
        <div className="flex items-center gap-2 rounded-2xl border border-line bg-bg px-3">
          <Link className="size-4 shrink-0 text-faint" aria-hidden="true" />
          <input
            disabled={busy}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={4000}
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              if (error) setError("");
            }}
            placeholder={tx({
              ru: "Ссылка на пост, сторис или ролик",
              en: "Link to a post, story or clip",
              kk: "Пост, сторис немесе ролик сілтемесі",
            })}
            className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none"
            inputMode="url"
            aria-label={tx({ ru: "Ссылка", en: "Link", kk: "Сілтеме" })}
            onPaste={(event) => {
              const text = event.clipboardData.getData("text/plain");
              if (!text.trim()) return;
              event.preventDefault();
              applyPaste(text);
            }}
          />
          <button
            type="button"
            disabled={busy}
            className="press grid size-11 shrink-0 place-items-center rounded-xl text-muted"
            aria-label={tx({ ru: "Вставить ссылку", en: "Paste link", kk: "Сілтемені қою" })}
            onClick={() =>
              void navigator.clipboard.readText().then(applyPaste).catch(() =>
                setError(
                  tx({
                    ru: "Вставьте ссылку в поле вручную",
                    en: "Paste the link into the field",
                    kk: "Сілтемені өріске қойыңыз",
                  }),
                ),
              )
            }
          >
            <ClipboardPaste className="size-4" />
          </button>
        </div>
        {hostName ? (
          <p className="px-1 text-xs text-muted">
            {hostName}
            {isYoutube
              ? tx({ ru: " · можно выбрать формат", en: " · pick a format", kk: " · форматты таңдаңыз" })
              : ""}
          </p>
        ) : null}
        {isYoutube ? (
          <div
            className="grid grid-cols-3 gap-1 rounded-2xl bg-subtle p-1"
            role="group"
            aria-label={tx({ ru: "Формат YouTube", en: "YouTube format", kk: "YouTube форматы" })}
          >
            {(
              [
                ["video", tx({ ru: "Видео", en: "Video", kk: "Видео" }), "720p"],
                ["small", tx({ ru: "Меньше", en: "Smaller", kk: "Ықшам" }), "360p"],
                ["audio", tx({ ru: "Аудио", en: "Audio", kk: "Аудио" }), "M4A"],
              ] as const
            ).map(([id, title, hint]) => (
              <button
                key={id}
                type="button"
                disabled={busy}
                aria-pressed={mode === id}
                onClick={() => setMode(id)}
                className={
                  mode === id
                    ? "press rounded-xl bg-elev px-2 py-2 text-center shadow-sm"
                    : "press rounded-xl px-2 py-2 text-center text-muted"
                }
              >
                <span className="block text-xs font-medium">{title}</span>
                <span className="text-[10px] text-faint">{hint}</span>
              </button>
            ))}
          </div>
        ) : null}
        <button
          type="submit"
          disabled={busy || !url.trim()}
          className="press inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-accent px-3 text-sm font-medium text-accent-fg disabled:opacity-40"
        >
          {busy ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Download className="size-4" />
          )}
          {tx({
            ru: busy ? "Загружаем…" : "Скачать",
            en: busy ? "Downloading…" : "Download",
            kk: busy ? "Жүктелуде…" : "Жүктеу",
          })}
        </button>
      </form>
        {error ? (
          <div className="mt-4 rounded-2xl border border-danger/30 bg-danger/5 p-4" role="alert">
            <p className="text-sm text-danger">{error}</p>
            <p className="mt-2 text-xs text-muted">
              {tx({
                ru: "Ролик должен быть открытым. Для YouTube можно сменить формат и повторить.",
                en: "The clip has to be public. On YouTube you can change the format and retry.",
                kk: "Видео ашық болуы керек. YouTube форматын өзгертіп, қайталаңыз.",
              })}
            </p>
          </div>
        ) : null}
        {!busy && !files.length && !error ? (
          <div className="mt-4 rounded-3xl border border-line p-4">
            <p className="text-sm font-medium">
              {tx({ ru: "Что можно прислать", en: "What you can send", kk: "Қандай сілтеме жарайды" })}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {["YouTube", "Instagram", "TikTok", "Pinterest", "VK"].map((name) => (
                <span key={name} className="rounded-full border border-line px-3 py-1 text-xs text-muted">
                  {name}
                </span>
              ))}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted">
              {tx({
                ru: "Вставьте ссылку целиком, даже если рядом есть текст из приложения. Файл до 40 МБ лежит на мегадиске пять минут, потом удаляется сам.",
                en: "Paste the whole share, even if the app added text around the link. A file up to 40 MB stays on the megadisk for five minutes, then deletes itself.",
                kk: "Қолданба мәтінімен бірге сілтемені қойыңыз. 40 МБ-қа дейінгі файл мегадискте бес минут тұрады да, өзі жойылады.",
              })}
            </p>
          </div>
        ) : null}
        {pull ? (
          <div className="mt-4 rounded-[1.6rem] border border-line bg-elev p-4">
            <div className="mb-4 flex gap-2">
              {(["open", "fetch", "save"] as const).map((step, i) => (
                <span
                  key={step}
                  className={
                    ["open", "fetch", "save"].indexOf(stage) >= i
                      ? "h-1 flex-1 rounded bg-accent"
                      : "h-1 flex-1 rounded bg-line"
                  }
                />
              ))}
            </div>
            <p className="flex items-center gap-2 text-sm" role="status">
              <LoaderCircle className="size-4 animate-spin text-accent" />
              {pull.label}
            </p>
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-line">
              <div
                className="h-full bg-accent transition-[width] duration-200"
                style={{ width: `${Math.max(pull.pct, 4)}%` }}
              />
            </div>
            <button
              type="button"
              className="press mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-xs text-muted"
              onClick={() => {
                abort.current?.abort();
                abort.current = null;
                setBusy(false);
                setPull(null);
              }}
            >
              <X className="size-3.5" />
              {tx({ ru: "Отменить", en: "Cancel", kk: "Бас тарту" })}
            </button>
          </div>
        ) : null}
        {files.map((file) => {
          const src = megaFileUrl(file.id, "view");
          const mine = saving?.id === file.id ? saving : null;
          return (
            <div key={file.id} className="mt-4 rounded-[1.6rem] border border-line bg-elev p-4">
              {file.mime.startsWith("image/") ? (
                <img
                  src={src}
                  alt=""
                  className="max-h-[28rem] w-full rounded-2xl bg-black object-contain"
                />
              ) : null}
              {file.mime.startsWith("video/") ? <FileVideo src={src} name={file.name} /> : null}
              {file.mime.startsWith("audio/") ? (
                <audio src={src} controls className="w-full" />
              ) : null}
              <p className="mt-3 truncate text-base font-medium">
                {file.name.replace(/\.(mp4|jpe?g|png|webp|gif|webm|m4a)$/i, "")}
              </p>
              <p className="mt-1 text-xs text-faint">
                {sizeLabel(file.bytes)} ·
                {tx({
                  ru: "Пять минут, затем файл удаляется сам.",
                  en: "Five minutes, then the file deletes itself.",
                  kk: "Бес минут, содан кейін файл өзі жойылады.",
                })}
              </p>
              {mine ? (
                <div className="mt-3">
                  <p className="text-xs text-muted">{mine.label}</p>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-line">
                    <div
                      className="h-full bg-accent"
                      style={{ width: `${Math.max(mine.pct, 4)}%` }}
                    />
                  </div>
                </div>
              ) : null}
              <button
                type="button"
                disabled={Boolean(mine)}
                className="press mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-accent px-3 text-sm font-medium text-accent-fg disabled:opacity-40"
                onClick={() => {
                  const at = performance.now();
                  setSaving({
                    id: file.id,
                    label: tx({
                      ru: "Сохраняю к себе",
                      en: "Saving a copy",
                      kk: "Өзіне сақтап жатырмын",
                    }),
                    pct: 4,
                  });
                  void downloadMegaFile(file.id, file.name, file.bytes, (tick) => {
                    const secs = Math.max(0.25, (performance.now() - at) / 1000);
                    const pct = Math.min(99, Math.round((tick.ratio || 0) * 100));
                    setSaving({
                      id: file.id,
                      label: `${pct}% · ${speedLabel(tick.speed || tick.loaded / secs)}`,
                      pct,
                    });
                  })
                    .then(() => setSaving(null))
                    .catch((err: unknown) => {
                      setSaving(null);
                      toast.error(
                        err instanceof Error
                          ? err.message
                          : tx({
                              ru: "Не удалось скачать",
                              en: "Could not download",
                              kk: "Жүктелмеді",
                            }),
                      );
                    });
                }}
              >
                <Download className="size-4" />
                {tx({ ru: "Сохранить к себе", en: "Save a copy", kk: "Өзіне сақтау" })}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
