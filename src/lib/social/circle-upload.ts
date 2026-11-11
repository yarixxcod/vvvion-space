import { getBearerToken } from "@/lib/auth/client";

const CHUNK = 1_500_000;
export const CIRCLE_MAX_BYTES = 200 * 1024 * 1024;

async function pushBytes(
  id: string,
  file: File,
  onProgress?: (tick: UploadTick) => void,
  signal?: AbortSignal,
): Promise<void> {
  const startedAt = performance.now();
  let offset = 0;
  let index = 0;
  onProgress?.(tick(0, file.size, startedAt));
  while (offset < file.size) {
    if (signal?.aborted) throw new Error("Загрузка отменена");
    const slice = file.slice(offset, offset + CHUNK);
    const raw = new Uint8Array(await slice.arrayBuffer());
    const from = offset;
    await post({ op: "chunk", id, index, data: bytesToBase64(raw) }, (loaded, total) => {
      const part = total ? loaded / total : 0;
      onProgress?.(tick(from + part * raw.length, file.size, startedAt));
    }, signal);
    offset += raw.length;
    index += 1;
    onProgress?.(tick(offset, file.size, startedAt));
  }
}

type UploadReply = { message?: string; id?: string; messageId?: string };

async function post(body: unknown, onWire?: (loaded: number, total: number) => void, signal?: AbortSignal): Promise<UploadReply> {
  if (signal?.aborted) throw new Error("Загрузка отменена");
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/circle-file");
    xhr.withCredentials = true;
    xhr.timeout = 60_000;
    xhr.setRequestHeader("content-type", "application/json");
    const token = getBearerToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    const stop = () => xhr.abort();
    signal?.addEventListener("abort", stop, { once: true });
    xhr.upload.onprogress = (event) => {
      if (onWire && event.lengthComputable) onWire(event.loaded, event.total);
    };
    xhr.onerror = () => reject(new Error("Не удалось отправить файл"));
    xhr.ontimeout = () => reject(new Error("Не удалось отправить файл"));
    xhr.onabort = () => reject(new Error("Загрузка отменена"));
    xhr.onload = () => {
      signal?.removeEventListener("abort", stop);
      let parsed: UploadReply | null = null;
      try {
        parsed = xhr.responseText ? (JSON.parse(xhr.responseText) as UploadReply) : null;
      } catch {
        parsed = null;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(parsed?.message || "Не удалось отправить файл"));
        return;
      }
      resolve(parsed ?? {});
    };
    xhr.send(payload);
  });
}

export type UploadTick = { ratio: number; loaded: number; total: number; speed: number };

function tick(loaded: number, total: number, started: number): UploadTick {
  const seconds = Math.max(0.25, (performance.now() - started) / 1000);
  return { ratio: total ? loaded / total : 1, loaded, total, speed: loaded / seconds };
}

function bytesToBase64(bytes: Uint8Array): string {
  let text = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    text += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(text);
}

export async function uploadCircleFile(options: {
  roomId: string;
  file: File;
  body?: string;
  messageId?: string;
  onProgress?: (tick: UploadTick) => void;
  signal?: AbortSignal;
}): Promise<{ messageId: string }> {
  if (options.file.size < 1) throw new Error("Файл пустой");
  if (options.file.size > CIRCLE_MAX_BYTES) throw new Error("Файл больше 200 МБ");
  const started = await post({
    op: "start",
    roomId: options.roomId,
    name: options.file.name,
    mime: options.file.type || "application/octet-stream",
    size: options.file.size,
  }, undefined, options.signal);
  const id = typeof started.id === "string" ? started.id : "";
  if (!id) throw new Error("Не удалось начать загрузку");
  try {
    await pushBytes(id, options.file, options.onProgress, options.signal);
    const done = await post({
      op: "finish",
      id,
      body: options.messageId ? "" : options.body || "",
      messageId: options.messageId || "",
    }, undefined, options.signal);
    const messageId = typeof done.messageId === "string" ? done.messageId : "";
    if (!messageId) throw new Error("Не удалось отправить файл");
    return { messageId };
  } catch (error) {
    await post({ op: "cancel", id }).catch(() => undefined);
    throw error;
  }
}

export async function uploadChatFile(file: File, onProgress?: (tick: UploadTick) => void, signal?: AbortSignal): Promise<{ id: string }> {
  if (file.size < 1) throw new Error("Файл пустой");
  if (file.size > CIRCLE_MAX_BYTES) throw new Error("Файл больше 200 МБ");
  const started = await post({
    op: "start",
    scope: "chat",
    name: file.name,
    mime: file.type || "application/octet-stream",
    size: file.size,
  }, undefined, signal);
  const id = typeof started.id === "string" ? started.id : "";
  if (!id) throw new Error("Не удалось начать загрузку");
  try {
    await pushBytes(id, file, onProgress, signal);
    await post({ op: "finish", id, scope: "chat" }, undefined, signal);
    return { id };
  } catch (error) {
    await post({ op: "cancel", id }).catch(() => undefined);
    throw error;
  }
}

export async function fetchCircleBlob(id: string): Promise<string> {
  const head = new Headers();
  const token = getBearerToken();
  if (token) head.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`/api/circle-file/${id}`, { headers: head, credentials: "same-origin" });
  if (!response.ok) throw new Error("Файл не открывается");
  return URL.createObjectURL(await response.blob());
}
