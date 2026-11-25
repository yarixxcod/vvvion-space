import type { ChatStats } from "@/lib/social/admin";
export function ProviderStats({ rows }: { rows: ChatStats["providers"] }) {
  const max = Math.max(1, ...rows.map((row) => row.requests));
  const num = (n: number) => n.toLocaleString("ru-RU");
  return (
    <section className="mt-4 rounded-3xl border border-line bg-elev p-4">
      <h4 className="text-sm font-semibold">Куда уходят запросы</h4>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        Реальные HTTP-попытки за 14 дней. Повторы и обращения инструментов считаются отдельно.
        «Принято» — HTTP 2xx, а не гарантия полного ответа. История собирается с этого обновления.
      </p>
      {!rows.length ? (
        <p className="mt-4 text-sm text-muted">Пока обращений к провайдерам нет.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {rows.map((p) => (
            <li
              key={`${p.model}:${p.id}:${p.host}:${p.upstream}:${p.source}`}
              className="rounded-2xl border border-line bg-bg p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">
                  {p.model} · провайдер {p.slot + 1}
                </span>
                <strong className="text-lg tabular-nums">{num(p.requests)}</strong>
              </div>
              <p className="mt-1 break-all text-sm text-muted">{p.host}</p>
              <p className="mt-1 break-all text-xs text-faint">
                {p.upstream} ·{" "}
                {p.source === "api" ? "API" : p.source === "telegram" ? "Telegram" : "Чат / звонок"}
              </p>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-subtle">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${Math.max(2, (p.requests / max) * 100)}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-muted">
                Принято: {num(p.accepted)} · Ошибки: {num(p.errors)} · До заголовков: {num(p.avgMs)}{" "}
                мс
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
