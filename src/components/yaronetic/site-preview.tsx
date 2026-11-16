import { useCircleNest } from "@/lib/circle-history";
import { useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, Monitor, Smartphone, RefreshCw } from "lucide-react";
import { BackButton } from "./back-button";
import { buildSite, type SiteFile } from "@/lib/files/site-bundle";
export type SiteSource = {
  path: string;
  url: string;
  bytes: number;
  mime: string;
  read?: () => Promise<Uint8Array>;
};
export async function fetchSiteFiles(sources: SiteSource[], signal: AbortSignal) {
  const relevant = sources.filter((file) =>
    /\.(html?|css|[mc]?js|json|txt|csv|md|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|otf)$/i.test(
      file.path,
    ),
  );
  if (relevant.length > 100 || relevant.reduce((sum, x) => sum + x.bytes, 0) > 12 * 1024 * 1024)
    throw new Error("Для предпросмотра поддерживается до 100 файлов и 12 МБ");
  const result: SiteFile[] = [];
  let total = 0;
  for (let i = 0; i < relevant.length; i += 4)
    await Promise.all(
      relevant.slice(i, i + 4).map(async (file) => {
        if (file.read) {
          const bytes = await file.read();
          total += bytes.length;
          if (bytes.length > 3 * 1024 * 1024 || total > 12 * 1024 * 1024)
            throw new Error("Ресурсы сайта превышают лимит предпросмотра");
          result.push({ path: file.path, mime: file.mime, bytes });
          return;
        }
        const response = await fetch(file.url, {
          credentials: "same-origin",
          cache: "no-store",
          signal,
        });
        if (!response.ok || !response.body) throw new Error(`Не загрузился ${file.path}`);
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        const max = /\.(html?|css|[mc]?js|json|txt|csv|md|svg)$/i.test(file.path)
          ? 1024 * 1024
          : 4 * 1024 * 1024;
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.length;
            total += part.value.length;
            if (size > max || total > 12 * 1024 * 1024)
              throw new Error("Ресурсы сайта превышают лимит предпросмотра");
            chunks.push(part.value);
          }
        } finally {
          await reader.cancel().catch(() => undefined);
        }
        const bytes = new Uint8Array(size);
        let at = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, at);
          at += chunk.length;
        }
        const mime = /\.css$/i.test(file.path)
          ? "text/css"
          : /\.js$/i.test(file.path)
            ? "text/javascript"
            : /\.svg$/i.test(file.path)
              ? "image/svg+xml"
              : /\.woff2$/i.test(file.path)
                ? "font/woff2"
                : /\.woff$/i.test(file.path)
                  ? "font/woff"
                  : file.mime;
        result.push({ path: file.path, mime, bytes });
      }),
    );
  return result;
}
export function SitePreview({
  name,
  entry,
  load,
  onClose,
}: {
  name: string;
  entry?: string;
  load: (signal: AbortSignal) => Promise<SiteSource[]>;
  onClose: () => void;
}) {
  const [files, setFiles] = useState<SiteFile[] | null>(null),
    [error, setError] = useState(""),
    [page, setPage] = useState(entry ?? ""),
    [mobile, setMobile] = useState(false),
    [revision, setRevision] = useState(0);
  useCircleNest(true,onClose);
  const frame = useRef<HTMLIFrameElement>(null);
  const loader = useRef(load);
  loader.current = load;
  useEffect(() => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45000);
    setFiles(null);
    setError("");
    void loader
      .current(ctrl.signal)
      .then((sources) => fetchSiteFiles(sources, ctrl.signal))
      .then((next) => {
        if (ctrl.signal.aborted) return;
        const pages = next.filter((x) => /\.html?$/i.test(x.path)).map((x) => x.path);
        const first = pages.find((x) => /^index\.html?$/i.test(x)) ?? pages[0];
        if (!first) throw new Error("В папке нет HTML-файла");
        setPage((current) => (pages.includes(current) ? current : first));
        setFiles(next);
      })
      .catch((err) => {
        if (!ctrl.signal.aborted)
          setError(err instanceof Error ? err.message : "Не удалось собрать сайт");
        else setError("Загрузка остановлена или диск отвечает слишком долго");
      })
      .finally(() => clearTimeout(timer));
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [revision]);
  const built = useMemo(() => {
    if (!files || !page) return null;
    try {
      return buildSite(files, page);
    } catch {
      return null;
    }
  }, [files, page]);
  useEffect(() => {
    const listen = (event: MessageEvent) => {
      if (
        event.source === frame.current?.contentWindow &&
        event.data?.type === "vvvion-site-page" &&
        built?.pages.includes(event.data.path)
      )
        setPage(event.data.path);
    };
    window.addEventListener("message", listen);
    return () => window.removeEventListener("message", listen);
  }, [built]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Предпросмотр сайта"
      className="fixed inset-0 z-[92] flex flex-col bg-bg text-fg sm:inset-3 sm:rounded-3xl sm:border sm:border-line"
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-line p-3">
        <BackButton onClick={onClose} label="Назад" />
        <button
          type="button"
          onClick={onClose}
          className="hidden min-h-11 rounded-xl border border-line px-3 text-sm md:block"
        >
          Закрыть
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-medium">{name}</h2>
          <p className="text-xs text-muted">Изолированный предпросмотр папки</p>
        </div>
        <button
          aria-label="Перезагрузить сайт"
          className="press grid size-11 place-items-center rounded-xl border border-line"
          onClick={() => setRevision((x) => x + 1)}
        >
          <RefreshCw className="size-4" />
        </button>
        <button
          aria-label={mobile ? "Широкий экран" : "Мобильный экран"}
          className="press grid size-11 place-items-center rounded-xl border border-line"
          onClick={() => setMobile((x) => !x)}
        >
          {mobile ? <Monitor className="size-4" /> : <Smartphone className="size-4" />}
        </button>
        {built ? (
          <select
            aria-label="Страница сайта"
            value={page}
            onChange={(event) => setPage(event.target.value)}
            className="min-h-11 max-w-full rounded-xl border border-line bg-elev px-3 text-sm"
          >
            {built.pages.map((path) => (
              <option key={path}>{path}</option>
            ))}
          </select>
        ) : null}
      </header>
      <p className="px-4 py-2 text-xs text-muted">
        HTML, CSS, JavaScript и локальные ресурсы. Сервер, npm-сборка и внешние API здесь не
        запускаются.
      </p>
      {error ? (
        <p role="alert" className="m-4 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {built?.missing.length ? (
        <details className="mx-4 mb-2 text-xs text-muted">
          <summary>Не подключено ресурсов: {built.missing.length}</summary>
          <p className="max-h-24 overflow-auto break-words">
            {built.missing.slice(0, 10).join(" · ")}
          </p>
        </details>
      ) : null}
      <div className="flex min-h-0 flex-1 justify-center overflow-hidden bg-subtle p-1 sm:p-3">
        {built ? (
          <iframe
            key={revision}
            ref={frame}
            title={`Сайт: ${page}`}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            srcDoc={built.html}
            className="h-full min-w-0 bg-white"
            style={{ width: mobile ? "390px" : "100%", maxWidth: "100%" }}
          />
        ) : !error ? (
          <div role="status" className="grid place-content-center gap-3 text-center text-muted">
            <LoaderCircle className="mx-auto size-6 animate-spin" />
            Собираем файлы сайта…
          </div>
        ) : null}
      </div>
    </div>
  );
}
