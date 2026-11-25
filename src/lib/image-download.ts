const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  "image/heic": "heic",
  "image/heif": "heif",
};
const localBlobs = new Map<string, Blob>();

/** Circle and chat photos are already in memory as blob: URLs. A second fetch of those URLs throws "Failed to fetch" in Chrome, especially once a service worker controls the page. */
export function rememberImageBlob(url: string, blob: Blob) {
  if (url.startsWith("blob:")) localBlobs.set(url, blob);
}
export function forgetImageBlob(url: string) {
  localBlobs.delete(url);
}

export function imageDownloadName(name: string, type: string) {
  const ext = EXTENSIONS[type.split(";")[0].toLowerCase()];
  if (!ext) throw Error("Сервер вернул файл вместо изображения");
  const clean =
    Array.from(name, (char) => (char.charCodeAt(0) < 32 ? "_" : char))
      .join("")
      .replace(/[<>:"/\\|?*]/g, "_")
      .trim()
      .replace(/[. ]+$/g, "")
      .slice(0, 100) || "vvvion-image";
  const stem = clean.replace(/\.(png|jpe?g|webp|gif|avif|svg|bmp|heic|heif)$/i, "");
  return `${stem}.${ext}`;
}

function sniffImage(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return "image/webp";
  return null;
}

function mimeOf(declared: string, bytes: Uint8Array) {
  const header = declared.split(";")[0].trim().toLowerCase();
  return header.startsWith("image/") ? header : sniffImage(bytes) || header;
}

function fileFromBytes(bytes: Uint8Array, declared: string, name: string) {
  const mime = mimeOf(declared, bytes);
  return new File([bytes as BlobPart], imageDownloadName(name, mime), { type: mime });
}

function fileFromDataUrl(url: string, name: string) {
  const comma = url.indexOf(",");
  if (comma < 5) throw new Error("Не удалось загрузить оригинал изображения");
  const meta = url.slice(5, comma);
  const payload = url.slice(comma + 1);
  let bytes: Uint8Array;
  if (/;base64/i.test(meta)) {
    let bin = "";
    try {
      bin = atob(payload.replace(/\s/g, ""));
    } catch {
      throw new Error("Не удалось загрузить оригинал изображения");
    }
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  } else {
    bytes = new TextEncoder().encode(decodeURIComponent(payload));
  }
  if (!bytes.byteLength) throw new Error("Изображение оказалось пустым");
  return fileFromBytes(bytes, meta.split(";")[0] || "", name);
}

async function fileFromBlob(blob: Blob, name: string) {
  if (blob.size > 40 * 1024 * 1024) throw new Error("Оригинал большой — откройте его по ссылке ниже");
  if (!blob.size) throw new Error("Изображение оказалось пустым");
  const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  return fileFromBytes(new Uint8Array(await blob.arrayBuffer()), blob.type || mimeOf("", head), name);
}

export async function fetchImageFile(
  url: string,
  name: string,
  signal: AbortSignal,
): Promise<File> {
  if (url.startsWith("data:")) return fileFromDataUrl(url, name);
  const remembered = url.startsWith("blob:") ? localBlobs.get(url) : undefined;
  if (remembered) return fileFromBlob(remembered, name);
  const local = url.startsWith("blob:");
  let res: Response;
  try {
    res = await fetch(url, { signal, credentials: local ? "omit" : "same-origin", cache: "no-store" });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    throw new Error("Не удалось загрузить оригинал изображения");
  }
  if (!res.ok || !res.body) throw new Error("Не удалось загрузить оригинал изображения");
  const header = res.headers.get("content-type")?.split(";")[0].trim().toLowerCase() || "";
  const max = 40 * 1024 * 1024;
  const reader = res.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      signal.throwIfAborted();
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > max) throw new Error("Оригинал большой — откройте его по ссылке ниже");
      chunks.push(part.value.slice());
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (!size) throw new Error("Изображение оказалось пустым");
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return fileFromBytes(bytes, header, name);
}
export function saveImageFile(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
  // Android's blob bridge and Safari may read the data after click returns.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
