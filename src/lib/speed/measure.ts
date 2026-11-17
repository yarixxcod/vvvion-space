export type SpeedResult = {
  download: number | null;
  upload: number | null;
  ping: number | null;
  jitter: number | null;
};
export type SpeedPhase = "ping" | "download" | "upload";
export function median(values: number[]): number {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
export function mbps(bytes: number, milliseconds: number): number {
  return bytes > 0 && milliseconds > 0 ? (bytes * 8) / milliseconds / 1000 : 0;
}
// A short, bounded test to Cloudflare's measurement edge. Never runs automatically.
export async function measureSpeed(
  signal: AbortSignal,
  onProgress: (phase: SpeedPhase, result: SpeedResult) => void,
): Promise<SpeedResult> {
  const result: SpeedResult = { download: null, upload: null, ping: null, jitter: null };
  const origin = "https://speed.cloudflare.com";
  const request = async (path: string, init: RequestInit = {}) => {
    signal.throwIfAborted();
    const response = await fetch(
      `${origin}${path}${path.includes("?") ? "&" : "?"}nonce=${crypto.randomUUID()}`,
      {
        ...init,
        cache: "no-store",
        credentials: "omit",
        signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
      },
    );
    if (!response.ok) throw new Error("Сервер измерения сейчас не отвечает. Попробуйте ещё раз.");
    return response;
  };
  const pings: number[] = [];
  for (let i = 0; i < 6; i++) {
    const start = performance.now();
    await (await request("/__down?bytes=0")).arrayBuffer();
    if (i > 0) pings.push(performance.now() - start); // exclude DNS/TLS warm-up
    result.ping = pings.length ? median(pings) : null;
    result.jitter =
      pings.length > 1
        ? pings.slice(1).reduce((sum, value, at) => sum + Math.abs(value - pings[at]), 0) /
          (pings.length - 1)
        : null;
    onProgress("ping", { ...result });
  }
  for (const phase of ["download", "upload"] as const) {
    const rates: number[] = [];
    for (const bytes of [100000, 1000000, 5000000]) {
      const payload = phase === "upload" ? new Uint8Array(bytes) : undefined;
      if (payload)
        for (let i = 0; i < payload.length; i += 65536)
          crypto.getRandomValues(payload.subarray(i, Math.min(i + 65536, payload.length)));
      const start = performance.now();
      const response = await request(
        phase === "download" ? `/__down?bytes=${bytes}` : "/__up",
        payload ? { method: "POST", headers: { "content-type": "text/plain" }, body: payload } : {},
      );
      const body = await response.arrayBuffer();
      const elapsed = performance.now() - start;
      if (phase === "download" && body.byteLength !== bytes)
        throw new Error("Измерение прервано: сервер вернул неполный ответ.");
      rates.push(mbps(bytes, elapsed));
      result[phase] = rates[rates.length - 1];
      onProgress(phase, { ...result });
      if (elapsed > 1500) break;
    }
  }
  return result;
}
