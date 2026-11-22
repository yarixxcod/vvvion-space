import { useEffect, useState } from "react";
import { getMemoryAdminStats } from "@/lib/memory/api";
export function MemoryAdmin() {
  const [state, setState] = useState<Awaited<ReturnType<typeof getMemoryAdminStats>> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    getMemoryAdminStats()
      .then((s) => {
        if (live) setState(s);
      })
      .catch(() => {
        if (live) setError("Метрики памяти недоступны");
      });
    return () => {
      live = false;
    };
  }, []);
  return (
    <section className="mt-4 rounded-3xl border border-line bg-elev p-4">
      <h3 className="text-lg font-medium">Память VVVion · статистика</h3>
      <p className="mt-1 text-xs text-muted">
        Только агрегаты. Содержимое личных записей не загружается в админку.
      </p>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : state === null ? (
        <p className="mt-3 animate-pulse text-sm text-muted">Загрузка метрик…</p>
      ) : !state.available ? (
        <p className="mt-3 text-sm text-muted">
          Серверный feature flag выключен. Новая память не используется.
        </p>
      ) : "aggregatesAvailable" in state && !state.aggregatesAvailable ? (
        <p className="mt-3 text-sm text-muted">Память хранится зашифрованно в S3. Числовые агрегаты не собираются: админка не перечисляет и не читает личные объекты аккаунтов.</p>
      ) : (
        <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {[
            ["Пользователей с памятью", state.users],
            ["Записей", state.records],
            ["В среднем на владельца", state.average.toFixed(1)],
            ["Ошибок за 30 дней", state.errors],
            ["Извлечение, среднее", `${state.extractionMs.toFixed(1)} мс`],
            ["Вызовов ИИ / стоимость", `${state.aiCalls} / $${state.costUsd.toFixed(6)}`],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl bg-subtle p-3">
              <dt className="text-xs text-muted">{label}</dt>
              <dd className="mt-1 break-words font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="mt-3 text-[11px] text-muted">
        Извлечение работает по консервативным правилам без платных запросов ИИ. Метрики ошибок во
        время полной недоступности базы могут быть неполными.
      </p>
    </section>
  );
}
