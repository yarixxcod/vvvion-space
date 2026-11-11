import { getBearerToken } from "@/lib/auth/client";
import { MEGA_CHUNK } from "@/lib/social/mega-plan";

type Reply = { id?: string; received?: number; message?: string };

function headers(): Record<string, string> {
  const token = getBearerToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function aborted(signal?: AbortSignal) {
  return Boolean(signal?.aborted);
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hardFail(message: string) {
  return /войти|не действует|не хватает|Нужно|почту|отменена|пуст|2 ГБ|уже есть|не найден/i.test(message);
}

async function post(body: Record<string, unknown>, tries: number, signal?: AbortSignal, timeout = 20_000): Promise<Reply> {
  let last = "Не удалось отправить файл";
  for (let attempt = 0; attempt < tries; attempt += 1) {
    if (aborted(signal)) throw new Error("Загрузка отменена");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    const stop = () => ctrl.abort();
    signal?.addEventListener("abort", stop, { once: true });
    try {
      const res = await fetch("/api/mega", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...headers() },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const data = (await res.json().catch(() => ({}))) as Reply;
      if (!res.ok) {
        last = data.message || last;
        if (hardFail(last) || (res.status < 500 && res.status !== 408 && res.status !== 429)) {
          throw Object.assign(new Error(last), { hard: true });
        }
      } else {
        return data;
      }
    } catch (error) {
      if (aborted(signal)) throw new Error("Загрузка отменена");
      if (error && typeof error === "object" && "hard" in error) throw error;
      last = error instanceof Error && error.name !== "AbortError" ? error.message : last;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
    }
    if (attempt + 1 >= tries) break;
    await wait(400 * (attempt + 1));
  }
  throw new Error(last);
}

function payloadOf(bytes: Blob | Uint8Array): Blob | ArrayBuffer {
  if (bytes instanceof Uint8Array) {
    const copy = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(copy).set(bytes);
    return copy;
  }
  return bytes;
}

function payloadSize(bytes: Blob | Uint8Array) {
  return bytes instanceof Uint8Array ? bytes.byteLength : bytes.size;
}

function sendChunk(
  id: string,
  offset: number,
  bytes: Blob | Uint8Array,
  onWire?: (loaded: number, total: number) => void,
  extra?: Record<string, string>,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error("Загрузка отменена"), { hard: true }));
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/mega");
    xhr.withCredentials = true;
    xhr.timeout = 120_000;
    xhr.setRequestHeader("content-type", "application/octet-stream");
    xhr.setRequestHeader("x-mega-id", id);
    xhr.setRequestHeader("x-mega-offset", String(offset));
    if (extra) {
      for (const [key, value] of Object.entries(extra)) xhr.setRequestHeader(key, value);
    }
    const token = getBearerToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    const stop = () => xhr.abort();
    signal?.addEventListener("abort", stop, { once: true });
    xhr.upload.onprogress = (event) => {
      if (onWire && event.lengthComputable) onWire(event.loaded, event.total);
    };
    const fail = (message: string, hard = false) => {
      signal?.removeEventListener("abort", stop);
      reject(Object.assign(new Error(message), { hard }));
    };
    xhr.onerror = () => fail("Сеть пропала, повторяю кусок");
    xhr.ontimeout = () => fail("Сеть замерла, повторяю кусок");
    xhr.onabort = () => fail("Загрузка отменена", true);
    xhr.onload = () => {
      signal?.removeEventListener("abort", stop);
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      let message = "Не удалось отправить файл";
      try {
        const parsed = JSON.parse(xhr.responseText) as { message?: string };
        if (parsed.message) message = parsed.message;
      } catch {
        /* keep the fallback */
      }
      fail(message, xhr.status < 500 && xhr.status !== 408 && xhr.status !== 429);
    };
    xhr.send(payloadOf(bytes));
  });
}

async function receivedOf(id: string): Promise<number | null> {
  try {
    const row = await post({ op: "status", id }, 3);
    return typeof row.received === "number" ? row.received : null;
  } catch {
    return null;
  }
}

async function sendChunkRetry(
  id: string,
  offset: number,
  bytes: Blob | Uint8Array,
  onWire?: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  let last = "Не удалось отправить файл";
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (aborted(signal)) throw new Error("Загрузка отменена");
    try {
      await sendChunk(id, offset, bytes, onWire, undefined, signal);
      return;
    } catch (error) {
      if (aborted(signal)) throw new Error("Загрузка отменена");
      const hard = Boolean(error && typeof error === "object" && "hard" in error && (error as { hard?: boolean }).hard);
      const message = error instanceof Error ? error.message : last;
      if (hard && hardFail(message)) throw new Error(message);
      const got = await receivedOf(id);
      if (got != null && got >= offset + payloadSize(bytes)) return;
      if (got != null && got > offset && got < offset + payloadSize(bytes)) {
        throw Object.assign(new Error("resync"), { received: got });
      }
      last = hard ? message : "Сеть пропала, повторяю кусок";
      if (attempt + 1 >= 4) break;
      await wait(500 * (attempt + 1));
    }
  }
  throw new Error(last);
}

export async function stampMegaFile(id: string, header: Uint8Array): Promise<void> {
  let last = "Не удалось записать теги";
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await sendChunk(id, 0, header, undefined, { "x-mega-stamp": "1" });
      return;
    } catch (error) {
      last = error instanceof Error ? error.message : last;
      if (hardFail(last)) throw new Error(last);
      if (attempt + 1 >= 4) break;
      await wait(400 * (attempt + 1));
    }
  }
  throw new Error(last);
}

export class MegaFinishError extends Error {
  id: string;
  constructor(id: string) {
    super("Не удалось сохранить файл");
    this.name = "MegaFinishError";
    this.id = id;
  }
}

const QUOTA = 2 * 1024 * 1024 * 1024;

export async function finishMegaClient(id: string): Promise<void> {
  await post({ op: "finish", id }, 2, undefined, 45_000);
}

export type MegaTick = { ratio: number; loaded: number; total: number; speed: number };

export async function uploadMegaFile(
  file: File,
  parent: string | null,
  onProgress?: (tick: MegaTick) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (aborted(signal)) throw new Error("Загрузка отменена");
  if (file.size < 1 || file.size > QUOTA) throw new Error("Файл пустой или больше 2 ГБ");
  const started = performance.now();
  const report = (loaded: number) => {
    const seconds = Math.max(0.25, (performance.now() - started) / 1000);
    onProgress?.({ ratio: file.size ? loaded / file.size : 1, loaded, total: file.size, speed: loaded / seconds });
  };
  const startedRow = await post({ op: "start", name: file.name, parent, mime: file.type || "application/octet-stream", size: file.size }, 4, signal);
  const id = startedRow.id;
  if (!id) throw new Error("Файл не открылся");
  report(0);
  try {
    let offset = 0;
    while (offset < file.size) {
      if (aborted(signal)) throw new Error("Загрузка отменена");
      const slice = file.slice(offset, Math.min(file.size, offset + MEGA_CHUNK));
      const from = offset;
      const size = slice.size;
      try {
        await sendChunkRetry(id, offset, slice, (loaded, total) => {
          const part = total ? loaded / total : 0;
          report(from + part * size);
        }, signal);
      } catch (error) {
        const jump = error && typeof error === "object" && "received" in error ? Number((error as { received?: number }).received) : NaN;
        if (Number.isFinite(jump) && jump > offset && jump <= file.size) {
          offset = jump;
          report(offset);
          continue;
        }
        throw error;
      }
      offset += size;
      report(offset);
    }
    try {
      await post({ op: "finish", id }, 2, signal, 45_000);
    } catch (error) {
      if (aborted(signal)) throw new Error("Загрузка отменена");
      throw new MegaFinishError(id);
    }
  } catch (error) {
    if (error instanceof MegaFinishError) throw error;
    await post({ op: "cancel", id }, 2).catch(() => undefined);
    if (aborted(signal)) throw new Error("Загрузка отменена");
    throw error;
  }
}

const CACHE = "vvvion-mega";
const CACHE_LIMIT = 48 * 1024 * 1024;
const MEMORY_CAP = 256 * 1024 * 1024;

export function megaFileUrl(id: string, mode: "view" | "file", room = false): string {
  const query = new URLSearchParams();
  query.set(mode === "view" ? "view" : "dl", "1");
  if (room) query.set("room", "1");
  const token = getBearerToken();
  if (token) query.set("t", token);
  return `/api/mega/${id}?${query}`;
}

export function megaAuthHeaders(): HeadersInit {
  return headers();
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function pace(started: number, loaded: number, total: number): MegaTick {
  const seconds = Math.max(0.25, (performance.now() - started) / 1000);
  return { ratio: total > 0 ? loaded / total : 1, loaded, total: total || loaded, speed: loaded / seconds };
}

const RANGE = 2 * 1024 * 1024;

async function remember(id: string, blob: Blob) {
  if (blob.size > CACHE_LIMIT || typeof caches === "undefined") return;
  const cache = await caches.open(CACHE);
  await cache.put(new Request(`${location.origin}/__vvvion_mega/${id}`), new Response(blob));
}

export async function downloadMegaFile(id: string, name: string, total: number, onProgress?: (tick: MegaTick) => void): Promise<"file" | "cache"> {
  if (total > MEMORY_CAP) {
    const link = document.createElement("a");
    link.href = megaFileUrl(id, "file");
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    return "file";
  }
  const started = performance.now();
  const parts: Blob[] = [];
  let offset = 0;
  const size = Math.max(0, total);
  while (offset < size) {
    const end = Math.min(size, offset + RANGE) - 1;
    const res = await fetch(megaFileUrl(id, "file"), {
      credentials: "same-origin",
      headers: { ...headers(), Range: `bytes=${offset}-${end}` },
    });
    if (!res.ok && res.status !== 206) throw new Error("Не удалось скачать");
    const blob = await res.blob();
    if (blob.size < 1) throw new Error("Не удалось скачать");
    parts.push(blob);
    offset += blob.size;
    onProgress?.(pace(started, offset, size));
  }
  const blob = new Blob(parts);
  try {
    await remember(id, blob);
  } catch {
    /* the cache is full */
  }
  const apple = /iPad|iPhone|iPod/.test(navigator.userAgent);
  if (apple && typeof navigator.share === "function") {
    try {
      const file = new File([blob], name);
      if (!navigator.canShare || navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });
        return "file";
      }
    } catch {
      return "cache";
    }
  }
  saveBlob(blob, name);
  return "file";
}
