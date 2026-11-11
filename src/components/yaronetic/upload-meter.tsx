export type UploadView = {
  name: string;
  ratio: number;
  loaded: number;
  total: number;
  speed: number;
};

export function sizeLabel(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 Б";
  if (bytes < 1024) return `${Math.round(bytes)} Б`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} МБ`;
}

export function speedLabel(bytesPerSecond: number) {
  return `${sizeLabel(bytesPerSecond)}/с`;
}

export function UploadMeter({ view }: { view: UploadView }) {
  const pct = Math.max(0, Math.min(100, Math.round((Number.isFinite(view.ratio) ? view.ratio : 0) * 100)));
  return (
    <div className="px-1 py-1">
      <div className="flex items-center justify-between gap-3 text-xs">
        <p className="min-w-0 truncate">{view.name}</p>
        <p className="shrink-0 tabular-nums text-muted">{pct}%</p>
      </div>
      <div
        className="mt-1.5 h-2 overflow-hidden rounded-full bg-subtle"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={view.name}
      >
        <div className="h-full rounded-full bg-accent transition-[width] duration-150 ease-out" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-xs tabular-nums text-faint">
        {sizeLabel(view.loaded)} из {sizeLabel(view.total)} · {speedLabel(view.speed)}
      </p>
    </div>
  );
}
