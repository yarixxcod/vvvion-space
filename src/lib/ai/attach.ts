import type { ChatFile } from "@/lib/ai/types";

const TEXT_EXT = /\.(txt|md|markdown|json|csv|ts|tsx|js|jsx|py|css|html|xml|yml|yaml|sql|log|sh|go|rs|java|c|cpp|h|php|toml)$/i;
export const CHAT_FILE_MAX = 200 * 1024 * 1024;
export const CHAT_FILE_COUNT = 8;

function safeName(name: string) {
  return name.replace(/[^\p{L}\p{N}._ ()\-]+/gu, "").trim().slice(0, 80) || "файл";
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("Файл не удалось прочитать"));
    reader.readAsDataURL(blob);
  });
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Картинка не читается"));
    };
    img.src = url;
  });
}

function canvasJpeg(img: HTMLImageElement, max: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("Не удалось подготовить картинку"));
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Не удалось сжать картинку"))),
      "image/jpeg",
      quality,
    );
  });
}

async function fitPreview(file: Blob): Promise<{ blob: Blob; dataUrl: string }> {
  const img = await loadImage(file);
  const steps: [number, number][] = [
    [1280, 0.72],
    [1024, 0.62],
    [800, 0.54],
    [640, 0.46],
    [480, 0.4],
    [360, 0.34],
    [280, 0.3],
  ];
  let blob: Blob | null = null;
  let dataUrl = "";
  for (const [max, quality] of steps) {
    blob = await canvasJpeg(img, max, quality);
    dataUrl = await blobToDataUrl(blob);
    if (dataUrl.length <= 150_000) return { blob, dataUrl };
  }
  if (!blob || !dataUrl || dataUrl.length > 180_000) throw new Error("Картинка слишком большая");
  return { blob, dataUrl };
}

function pdfText(bytes: Uint8Array): string {
  const raw = new TextDecoder("latin1").decode(bytes);
  const bits: string[] = [];
  const re = /\((?:\\\)|[^)]){2,180}\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) && bits.join(" ").length < 20_000) {
    const piece = match[0]
      .slice(1, -1)
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "")
      .replace(/\\[()\\]/g, (ch) => ch.slice(1));
    if (/[A-Za-zА-Яа-яЁё]/.test(piece)) bits.push(piece);
  }
  return bits.join(" ").replace(/[^\S\n]+/g, " ").trim().slice(0, 20_000);
}

export async function readChatFile(file: File): Promise<ChatFile> {
  const name = safeName(file.name);
  if (file.size > CHAT_FILE_MAX) throw new Error("Файл больше 200 МБ");
  const mime = file.type || "application/octet-stream";
  if (file.type.startsWith("image/") && file.size <= 12_000_000) {
    const preview = await fitPreview(file);
    return {
      id: crypto.randomUUID(),
      name,
      mime: "image/jpeg",
      kind: "image",
      dataUrl: preview.dataUrl,
      size: preview.blob.size,
    };
  }
  const looksText = file.type.startsWith("text/") || TEXT_EXT.test(file.name) || file.type === "application/json";
  if ((file.type === "application/pdf" || name.toLowerCase().endsWith(".pdf")) && file.size <= 8_000_000) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const text = pdfText(bytes);
    return {
      id: crypto.randomUUID(),
      name,
      mime: "application/pdf",
      kind: "text",
      size: file.size,
      text: text || "Текст из PDF не удалось прочитать.",
    };
  }
  if (looksText && file.size <= 2_000_000) {
    const text = await file.text();
    if (!text.includes("\u0000")) {
      return { id: crypto.randomUUID(), name, mime: file.type || "text/plain", kind: "text", size: file.size, text: text.slice(0, 60_000) };
    }
  }
  return { id: crypto.randomUUID(), name, mime, kind: "file", size: file.size };
}
