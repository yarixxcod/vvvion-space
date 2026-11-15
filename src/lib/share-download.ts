export type DownloadProgress = { got: number; total: number; pct: number | null; speed: number };
export type FileSink = {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
};

export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  const units = ["КБ", "МБ", "ГБ", "ТБ"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} ${units[unit]}`;
}

/** A single stream is used for progress and saving; incomplete files are never committed. */
export async function downloadShared(
  url: string,
  bytes: number,
  signal: AbortSignal,
  onProgress: (value: DownloadProgress) => void,
  sink: FileSink | null = null,
  fetchImpl: typeof fetch = fetch,
): Promise<Blob | null> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    signal.throwIfAborted();
    const response = await fetchImpl(url, { signal, cache: "no-store" });
    if (!response.ok || !response.body)
      throw new Error("Не удалось скачать файл. Ссылка могла истечь.");
    const length = response.headers.get("content-encoding")
      ? 0
      : Number(response.headers.get("content-length"));
    const total = Number.isFinite(length) && length > 0 ? length : Math.max(0, bytes);
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let got = 0;
    let painted = 0;
    const start = performance.now();
    onProgress({ got, total, pct: total > 0 ? 0 : null, speed: 0 });
    while (true) {
      signal.throwIfAborted();
      const step = await reader.read();
      signal.throwIfAborted();
      if (step.done) break;
      if (sink) await sink.write(step.value.slice());
      else chunks.push(step.value.slice());
      got += step.value.byteLength;
      const now = performance.now();
      if (now - painted > 150) {
        painted = now;
        onProgress({
          got,
          total,
          pct: total > 0 ? Math.min(99, Math.round((got / total) * 100)) : null,
          speed: got / Math.max(0.25, (now - start) / 1000),
        });
      }
    }
    if (total > 0 && got !== total) throw new Error("Загрузка прервалась. Скачайте файл ещё раз.");
    if (sink) await sink.close();
    onProgress({
      got,
      total: total || got,
      pct: 100,
      speed: got / Math.max(0.25, (performance.now() - start) / 1000),
    });
    return sink
      ? null
      : new Blob(chunks as BlobPart[], {
          type: response.headers.get("content-type") || "application/octet-stream",
        });
  } catch (error) {
    await reader?.cancel().catch(() => undefined);
    await sink?.abort().catch(() => undefined);
    throw error;
  } finally {
    reader?.releaseLock();
  }
}
