import { useRef, useState, type FormEvent } from "react";
import { ChevronLeft, Download } from "lucide-react";
import { toast } from "sonner";
import { getBearerToken } from "@/lib/auth/client";
import { useTx } from "@/lib/lang";
import type { Grabbed } from "@/lib/social/grab";
import { downloadMegaFile, megaFileUrl } from "@/lib/social/mega-upload";

type Pull = { label: string; pct: number };
type Tick = { type: "progress"; phase: "open" | "fetch" | "save"; pct: number; loaded: number; total: number };

function sizeLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / (1024 * 1024)).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} МБ`;
}

function speedLabel(bytesPerSec: number) {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec < 1024) return `${Math.max(0, Math.round(bytesPerSec))} Б/с`;
  if (bytesPerSec < 1024 * 1024) return `${Math.max(1, Math.round(bytesPerSec / 1024))} КБ/с`;
  return `${(bytesPerSec / (1024 * 1024)).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} МБ/с`;
}

export function Grabber({ onBack }: { onBack: () => void }) {
  const tx = useTx();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [pull, setPull] = useState<Pull | null>(null);
  const [saving, setSaving] = useState<Pull & { id: string } | null>(null);
  const [files, setFiles] = useState<Grabbed[]>([]);
  const started = useRef(0);

  function labelOf(tick: Tick): Pull {
    if (tick.phase === "open") return { label: tx({ ru: "Открываю ссылку", en: "Opening the link", kk: "Сілтемені ашамын" }), pct: tick.pct };
    if (tick.phase === "save") return { label: tx({ ru: "Сохраняю", en: "Saving", kk: "Сақтаймын" }), pct: Math.max(tick.pct, 90) };
    const secs = Math.max(0.25, (performance.now() - started.current) / 1000);
    const speed = speedLabel((tick.loaded || 0) / secs);
    if (tick.total > 0) return { label: `${tick.pct}% · ${speed}`, pct: tick.pct };
    if (tick.loaded > 0) return { label: `${sizeLabel(tick.loaded)} · ${speed}`, pct: Math.max(tick.pct, 12) };
    return { label: tx({ ru: "Скачиваю", en: "Downloading", kk: "Жүктеп жатырмын" }), pct: Math.max(tick.pct, 12) };
  }

  async function run(event: FormEvent) {
    event.preventDefault();
    if (busy || !url.trim()) return;
    setBusy(true);
    setFiles([]);
    setSaving(null);
    started.current = performance.now();
    setPull({ label: tx({ ru: "Открываю ссылку", en: "Opening the link", kk: "Сілтемені ашамын" }), pct: 6 });
    try {
      const token = getBearerToken();
      const res = await fetch("/api/grab", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ url: url.trim() }),
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(data?.message || tx({ ru: "Не скачалось", en: "It did not download", kk: "Жүктелмеді" }));
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let doneFiles: Grabbed[] | null = null;
      let failed = "";
      while (true) {
        const step = await reader.read();
        if (step.done) break;
        buf += decoder.decode(step.value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as Tick | { type: "done"; files: Grabbed[] } | { type: "error"; message: string };
          if (event.type === "progress") setPull(labelOf(event));
          else if (event.type === "done") doneFiles = event.files;
          else if (event.type === "error") failed = event.message;
        }
      }
      if (failed) throw new Error(failed);
      if (!doneFiles?.length) throw new Error(tx({ ru: "Не скачалось", en: "It did not download", kk: "Жүктелмеді" }));
      setPull({ label: "100%", pct: 100 });
      setFiles(doneFiles);
      toast(tx({
        ru: doneFiles.length > 1 ? `${doneFiles.length} файла на мегадиске пять минут` : "Файл на мегадиске пять минут",
        en: doneFiles.length > 1 ? `${doneFiles.length} files stay on the megadisk for five minutes` : "The file stays on the megadisk for five minutes",
        kk: doneFiles.length > 1 ? `${doneFiles.length} файл мегадискте бес минут тұрады` : "Файл мегадискте бес минут тұрады",
      }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tx({ ru: "Не скачалось", en: "It did not download", kk: "Жүктелмеді" }));
    } finally {
      setBusy(false);
      setPull(null);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-3 pt-3">
        <button type="button" className="press inline-flex h-10 items-center gap-1 rounded-xl px-2 text-sm text-muted" onClick={onBack}>
          <ChevronLeft className="size-4" />
          {tx({ ru: "Сервисы", en: "Services", kk: "Сервистер" })}
        </button>
        <h3 className="font-serif text-xl tracking-tight">{tx({ ru: "Загрузчик", en: "Downloader", kk: "Жүктеуіш" })}</h3>
      </div>
      <form className="flex gap-2 px-4 pt-3" onSubmit={(event) => void run(event)}>
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder={tx({ ru: "Ссылка на пост, сторис или ролик", en: "Link to a post, story or clip", kk: "Пост, сторис немесе ролик сілтемесі" })}
          className="field"
          inputMode="url"
          aria-label={tx({ ru: "Ссылка", en: "Link", kk: "Сілтеме" })}
        />
        <button
          type="submit"
          disabled={busy || !url.trim()}
          className="press h-11 shrink-0 rounded-2xl bg-accent px-3 text-sm font-medium text-accent-fg disabled:opacity-40"
        >
          {tx({ ru: "Скачать", en: "Download", kk: "Жүктеу" })}
        </button>
      </form>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <p className="max-w-md text-sm text-muted">
          {tx({
            ru: "Instagram, YouTube, TikTok, Pinterest и VK. Видео, фото и сторис ложатся на мегадиск и сами исчезают через пять минут.",
            en: "Instagram, YouTube, TikTok, Pinterest and VK. Video, photos and stories land on the megadisk and disappear after five minutes.",
            kk: "Instagram, YouTube, TikTok, Pinterest және VK. Видео, фото және сторис мегадискке түседі де, бес минуттан кейін жоғалады.",
          })}
        </p>
        {pull ? (
          <div className="mt-4 rounded-[1.6rem] border border-line bg-elev p-4">
            <p className="text-sm">{pull.label}</p>
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-line">
              <div className="h-full bg-accent transition-[width] duration-200" style={{ width: `${Math.max(pull.pct, 4)}%` }} />
            </div>
          </div>
        ) : null}
        {files.map((file) => {
          const src = megaFileUrl(file.id, "view");
          const mine = saving?.id === file.id ? saving : null;
          return (
            <div key={file.id} className="mt-4 rounded-[1.6rem] border border-line bg-elev p-4">
              {file.mime.startsWith("image/") ? <img src={src} alt="" className="max-h-[28rem] w-full rounded-2xl bg-black object-contain" /> : null}
              {file.mime.startsWith("video/") ? <video src={src} controls playsInline preload="metadata" className="max-h-[28rem] w-full rounded-2xl bg-black" /> : null}
              {file.mime.startsWith("audio/") ? <audio src={src} controls className="w-full" /> : null}
              <p className="mt-3 truncate font-serif text-2xl tracking-tight">{file.name.replace(/\.(mp4|jpe?g|png|webp|gif|webm|m4a)$/i, "")}</p>
              <p className="mt-1 text-xs text-faint">
                {tx({ ru: "Пять минут, затем файл удаляется сам.", en: "Five minutes, then the file deletes itself.", kk: "Бес минут, содан кейін файл өзі жойылады." })}
              </p>
              {mine ? (
                <div className="mt-3">
                  <p className="text-xs text-muted">{mine.label}</p>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-line">
                    <div className="h-full bg-accent" style={{ width: `${Math.max(mine.pct, 4)}%` }} />
                  </div>
                </div>
              ) : null}
              <button
                type="button"
                disabled={Boolean(mine)}
                className="press mt-3 inline-flex h-10 items-center gap-1.5 rounded-xl bg-accent px-3 text-sm font-medium text-accent-fg disabled:opacity-40"
                onClick={() => {
                  const at = performance.now();
                  setSaving({ id: file.id, label: tx({ ru: "Сохраняю к себе", en: "Saving a copy", kk: "Өзіне сақтап жатырмын" }), pct: 4 });
                  void downloadMegaFile(file.id, file.name, file.bytes, (tick) => {
                    const secs = Math.max(0.25, (performance.now() - at) / 1000);
                    const pct = Math.min(99, Math.round((tick.ratio || 0) * 100));
                    setSaving({ id: file.id, label: `${pct}% · ${speedLabel(tick.speed || tick.loaded / secs)}`, pct });
                  })
                    .then(() => setSaving(null))
                    .catch((err: unknown) => {
                      setSaving(null);
                      toast.error(err instanceof Error ? err.message : tx({ ru: "Не удалось скачать", en: "Could not download", kk: "Жүктелмеді" }));
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
