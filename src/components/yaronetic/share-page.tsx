import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Download, FileText, Folder, Music2 } from "lucide-react";
import { toast } from "sonner";
import { Mark } from "@/components/yaronetic/mark";
import { Wordmark } from "@/components/yaronetic/wordmark";
import type { ShareEntry, SharePageData } from "@/lib/share-view";

const CACHE = "vvvion-share";
const CACHE_LIMIT = 48 * 1024 * 1024;

type Pull = { id: string; label: string; pct: number };

function sizeLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} МБ`;
  return `${(bytes / (1024 * 1024 * 1024)).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} ГБ`;
}

function speedLabel(bytesPerSec: number) {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec < 1024) return `${Math.max(0, Math.round(bytesPerSec))} Б/с`;
  if (bytesPerSec < 1024 * 1024) return `${Math.max(1, Math.round(bytesPerSec / 1024))} КБ/с`;
  return `${(bytesPerSec / (1024 * 1024)).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} МБ/с`;
}

function tick(got: number, total: number, started: number): { label: string; pct: number } {
  const secs = Math.max(0.25, (performance.now() - started) / 1000);
  const speed = speedLabel(got / secs);
  if (total > 0) {
    const pct = Math.min(99, Math.round((got / total) * 100));
    return { label: `${pct}% · ${speed}`, pct };
  }
  return { label: `${sizeLabel(got)} · ${speed}`, pct: 0 };
}

function saveBlob(blob: Blob, name: string) {
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = name;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 120_000);
}

type FileSink = { write(chunk: Uint8Array): Promise<void>; close(): Promise<void> };

async function openSink(name: string): Promise<FileSink | "cancel" | null> {
  const picker = window.matchMedia("(pointer: fine)").matches
    ? (window as unknown as { showSaveFilePicker?: (options: { suggestedName: string }) => Promise<{ createWritable: () => Promise<FileSink> }> }).showSaveFilePicker
    : undefined;
  if (!picker) return null;
  try {
    const handle = await picker({ suggestedName: name });
    return await handle.createWritable();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return "cancel";
    return null;
  }
}

async function saveShared(url: string, name: string, bytes: number, onPull: (pull: { label: string; pct: number } | null) => void): Promise<boolean> {
  const abs = new URL(url, window.location.origin).toString();
  if (bytes > 0 && bytes <= CACHE_LIMIT && "caches" in window) {
    try {
      const hit = await (await caches.open(CACHE)).match(abs);
      if (hit) {
        onPull({ label: "Из кэша", pct: 100 });
        saveBlob(await hit.blob(), name);
        return true;
      }
    } catch {
      /* cache is optional */
    }
  }
  const sink = await openSink(name);
  if (sink === "cancel") return false;
  onPull({ label: "0% · 0 КБ/с", pct: 0 });
  const fresh = await fetch(abs);
  if (!fresh.ok || !fresh.body) throw new Error("Не скачалось");
  const total = Number(fresh.headers.get("content-length") || bytes || 0);
  const reader = fresh.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  const started = performance.now();
  let painted = 0;
  while (true) {
    const step = await reader.read();
    if (step.done) break;
    if (sink) await sink.write(step.value.slice());
    else chunks.push(step.value.slice());
    got += step.value.byteLength;
    const now = performance.now();
    if (now - painted > 180) {
      painted = now;
      const next = tick(got, total, started);
      onPull(next);
    }
  }
  const done = tick(got, total || got, started);
  onPull({ label: `100% · ${done.label.split(" · ")[1] || done.label}`, pct: 100 });
  if (sink) {
    await sink.close();
    return true;
  }
  const type = fresh.headers.get("content-type") || "application/octet-stream";
  const blob = new Blob(chunks as BlobPart[], { type });
  saveBlob(blob, name);
  if (blob.size > 0 && blob.size <= CACHE_LIMIT && "caches" in window) {
    void caches.open(CACHE).then((cache) => cache.put(abs, new Response(blob.slice(), { headers: { "content-type": type } }))).catch(() => undefined);
  }
  return true;
}

export function SharePage({ token, data }: { token: string; data: SharePageData }) {
  const navigate = useNavigate();
  const [opened, setOpened] = useState<string | null>(data.file?.id ?? null);
  const [pull, setPull] = useState<Pull | null>(null);
  const file = data.file ?? data.entries.find((entry) => entry.id === opened && entry.kind === "file") ?? null;
  const folders = data.file ? [] : data.entries.filter((entry) => entry.kind === "folder");
  const images = data.file ? [] : data.entries.filter((entry) => entry.kind === "file" && entry.media === "image");
  const rest = data.file ? [] : data.entries.filter((entry) => entry.kind === "file" && entry.media !== "image");
  const count = data.file ? 1 : data.entries.filter((entry) => entry.kind === "file").length;

  function openFolder(id: string) {
    setOpened(null);
    void navigate({
      to: "/d/$token",
      params: { token },
      search: { f: id === data.rootId ? undefined : id },
    });
  }

  async function save(entry: ShareEntry) {
    if (!entry.download || pull) return;
    setPull({ id: entry.id, label: "0% · 0 КБ/с", pct: 0 });
    try {
      const saved = await saveShared(entry.download, entry.name, entry.bytes, (next) => {
        setPull(next ? { id: entry.id, ...next } : null);
      });
      if (saved) toast("Файл сохранён");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не скачалось");
    } finally {
      setPull(null);
    }
  }

  return (
    <div className="min-h-dvh">
      <div className="mx-auto flex w-full max-w-3xl flex-col px-5 pt-6 pb-16 sm:px-8">
        <header className="flex items-center justify-between gap-4">
          <Link to="/" className="press flex min-w-0 items-center gap-2.5">
            <Mark size={28} />
            <Wordmark />
          </Link>
          <Link to="/" className="shrink-0 text-sm text-muted">
            На сайт
          </Link>
        </header>
        <div className="mt-12">
          <p className="text-[11px] font-medium tracking-[0.18em] text-faint uppercase">Общий доступ</p>
          <h1 className="mt-2 font-serif text-4xl tracking-tight text-balance">{data.title}</h1>
          <p className="mt-2 text-sm text-muted">{count === 0 ? "Пока пусто" : count === 1 ? "1 файл" : `${count} файлов`}</p>
        </div>
        {data.crumbs.length > 1 ? (
          <nav className="mt-6 flex flex-wrap items-center gap-1 text-sm text-muted">
            {data.crumbs.map((crumb, index) => (
              <button key={crumb.id} type="button" className="press max-w-48 truncate" onClick={() => openFolder(crumb.id)}>
                {index > 0 ? <span className="text-faint"> / </span> : null}
                {crumb.name}
              </button>
            ))}
          </nav>
        ) : null}
        {file ? <Preview entry={file} pull={pull?.id === file.id ? pull : null} onSave={() => void save(file)} /> : null}
        {folders.length ? (
          <ul className="mt-8 divide-y divide-line border-y border-line">
            {folders.map((entry) => (
              <li key={entry.id}>
                <button type="button" className="press flex w-full items-center gap-3 py-3 text-left" onClick={() => openFolder(entry.id)}>
                  <Folder className="size-4 shrink-0 text-muted" />
                  <span className="truncate text-sm">{entry.name}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {images.length ? (
          <div className="mt-8 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {images.map((entry) => (
              <div key={entry.id} className="group relative aspect-square overflow-hidden rounded-2xl bg-subtle">
                <button type="button" className="absolute inset-0" onClick={() => setOpened(entry.id)} aria-label={entry.name}>
                  <img src={entry.view} alt="" className="h-full w-full object-cover" />
                </button>
                <SaveMark entry={entry} pull={pull?.id === entry.id ? pull : null} onSave={() => void save(entry)} />
              </div>
            ))}
          </div>
        ) : null}
        {rest.length ? (
          <ul className="mt-6 divide-y divide-line border-y border-line">
            {rest.map((entry) => {
              const live = pull?.id === entry.id ? pull : null;
              return (
                <li key={entry.id} className="py-3">
                  <div className="flex items-center gap-3">
                    <button type="button" className="press flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setOpened(entry.id)}>
                      {entry.media === "audio" ? <Music2 className="size-4 shrink-0 text-muted" /> : <FileText className="size-4 shrink-0 text-muted" />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{entry.name}</span>
                        <span className="block text-xs tabular-nums text-faint">{live ? live.label : sizeLabel(entry.bytes)}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="press grid size-10 shrink-0 place-items-center rounded-full text-muted hover:bg-subtle"
                      aria-label={`Сохранить ${entry.name}`}
                      disabled={Boolean(live)}
                      onClick={() => void save(entry)}
                    >
                      <Download className="size-4" />
                    </button>
                  </div>
                  {live ? (
                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-line">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(live.pct, 4)}%` }} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
        {!data.file && data.entries.length === 0 ? <p className="mt-16 text-center text-sm text-faint">Папка пустая</p> : null}
      </div>
    </div>
  );
}

function Preview({ entry, pull, onSave }: { entry: ShareEntry; pull: Pull | null; onSave: () => void }) {
  return (
    <figure className="mt-8 overflow-hidden rounded-[1.75rem] border border-line bg-elev">
      {entry.media === "image" ? <img src={entry.view} alt={entry.name} className="max-h-[70dvh] w-full bg-subtle object-contain" /> : null}
      {entry.media === "video" ? <video controls preload="metadata" src={entry.view} className="max-h-[70dvh] w-full bg-black" /> : null}
      {entry.media === "audio" ? (
        <div className="flex items-center gap-3 px-5 py-6">
          <Music2 className="size-5 shrink-0 text-muted" />
          <audio controls preload="metadata" src={entry.view} className="h-10 w-full" />
        </div>
      ) : null}
      {entry.media === "pdf" ? <iframe title={entry.name} src={entry.view} className="h-[70dvh] w-full bg-white" /> : null}
      {entry.media === "file" ? (
        <div className="grid place-items-center px-5 py-14 text-muted">
          <FileText className="size-8" />
        </div>
      ) : null}
      <figcaption className="flex items-center gap-3 border-t border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm">{entry.name}</p>
          <p className="text-xs tabular-nums text-faint">{pull ? pull.label : sizeLabel(entry.bytes)}</p>
        </div>
        <button type="button" disabled={Boolean(pull)} className="press inline-flex h-10 items-center gap-1.5 rounded-full bg-accent px-4 text-sm font-medium text-accent-fg disabled:opacity-40" onClick={onSave}>
          <Download className="size-4" />
          Сохранить
        </button>
      </figcaption>
    </figure>
  );
}

function SaveMark({ entry, pull, onSave }: { entry: ShareEntry; pull: Pull | null; onSave: () => void }) {
  return (
    <button
      type="button"
      aria-label={pull?.label || `Сохранить ${entry.name}`}
      disabled={Boolean(pull)}
      className="press absolute top-2 right-2 grid min-w-9 place-items-center rounded-full bg-black/55 px-2 text-[10px] text-white backdrop-blur-sm"
      onClick={onSave}
    >
      {pull ? pull.label : <Download className="size-4" />}
    </button>
  );
}
