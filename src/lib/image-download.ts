const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
};
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
  const stem = clean.replace(/\.(png|jpe?g|webp|gif|avif|svg|bmp)$/i, "");
  return `${stem}.${ext}`;
}
export async function fetchImageFile(
  url: string,
  name: string,
  signal: AbortSignal,
): Promise<File> {
  const res = await fetch(url, { signal, credentials: "same-origin" });
  if (!res.ok || !res.body) throw Error("Не удалось загрузить оригинал изображения");
  const mime = res.headers.get("content-type")?.split(";")[0].trim() || "";
  const filename = imageDownloadName(name, mime);
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
      if (size > max) throw Error("Оригинал большой — откройте его по ссылке ниже");
      chunks.push(part.value.slice());
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (!size) throw Error("Изображение оказалось пустым");
  return new File(chunks as BlobPart[], filename, { type: mime });
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
