import { useEffect, useRef, useState } from "react";
import { getServiceStatus } from "@/lib/social/service-status";
import { RELEASE } from "@/lib/release";

export function ServiceStatus() {
  const [open, setOpen] = useState(false);
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof getServiceStatus>> | null>(null);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  useEffect(() => {
    const change = () => setOnline(navigator.onLine);
    change();
    window.addEventListener("online", change);
    window.addEventListener("offline", change);
    return () => {
      sequence.current++;
      window.removeEventListener("online", change);
      window.removeEventListener("offline", change);
    };
  }, []);
  async function refresh() {
    const run = ++sequence.current;
    setBusy(true);
    setError("");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const row = await Promise.race([
        getServiceStatus(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Сервер не ответил за 10 секунд")), 10000);
        }),
      ]);
      if (sequence.current === run) setResult(row);
    } catch (err) {
      if (sequence.current === run) {
        setResult(null);
        setError(
          err instanceof Error
            ? /Unauthorized/i.test(err.message)
              ? "Войдите в аккаунт для проверки сервиса"
              : err.message
            : "Проверка недоступна",
        );
      }
    } finally {
      clearTimeout(timer);
      if (sequence.current === run) setBusy(false);
    }
  }
  return (
    <section className="mt-3 rounded-xl border border-line p-3">
      <button
        type="button"
        aria-expanded={open}
        className="press flex min-h-10 w-full items-center justify-between text-left text-sm"
        onClick={() => {
          setOpen(!open);
          if (!open && !result && !busy) void refresh();
        }}
      >
        Состояние сервиса{" "}
        <span className="text-xs text-muted">{open ? "Свернуть" : "Проверить"}</span>
      </button>
      {open ? (
        <div className="mt-2 text-xs leading-relaxed">
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-2">
            <dt className="text-muted">Версия приложения</dt>
            <dd>{RELEASE}</dd>
            <dt className="text-muted">Сеть устройства</dt>
            <dd>{online ? "Подключена" : "Нет сети"}</dd>
            {result ? (
              <>
                <dt className="text-muted">Версия сервера</dt>
                <dd>
                  {result.version}
                  {result.commit ? ` · ${result.commit}` : ""}
                </dd>
                <dt className="text-muted">База данных</dt>
                <dd>{result.database ? "Отвечает" : "Не ответила"}</dd>
                <dt className="text-muted">Каталог моделей</dt>
                <dd>{result.models == null ? "Не проверен" : `${result.models} моделей`}</dd>
                <dt className="text-muted">Метаданные диска</dt>
                <dd>{result.disk ? "Доступны" : "Недоступны"}</dd>
                <dt className="text-muted">Мегадиск</dt>
                <dd>
                  {result.mega?.active
                    ? result.mega.status === "ready"
                      ? "Настроен"
                      : "Узел не готов"
                    : "Не подключён"}
                </dd>
              </>
            ) : null}
          </dl>
          {result?.version !== undefined && result.version !== RELEASE ? (
            <p role="status" className="mt-3 text-accent">
              Доступна другая версия. Сохраните черновики перед обновлением страницы.
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="mt-3 text-danger">
              {error}
            </p>
          ) : null}
          <p className="mt-3 text-faint">
            Проверка не отправляет запрос ИИ и не списывает вубли. Статус Мегадиска взят из
            настроек; передача файлов отдельно не проверяется.
          </p>
          {result ? (
            <time className="mt-2 block text-faint" dateTime={result.checkedAt}>
              Проверено: {new Date(result.checkedAt).toLocaleTimeString("ru-RU")}
            </time>
          ) : null}
          <button
            type="button"
            disabled={busy}
            className="press mt-3 min-h-10 rounded-xl border border-line px-3 disabled:opacity-40"
            onClick={() => void refresh()}
          >
            {busy ? "Проверяем…" : "Проверить снова"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
