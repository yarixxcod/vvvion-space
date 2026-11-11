/** OpenMoji, CC BY-SA 4.0. Served from the jsDelivr CDN, not bundled. */
const CDN = "https://cdn.jsdelivr.net/npm/openmoji@15.0.0/color/svg";

export const STICKER_PACKS = [
  {
    id: "faces",
    label: "Лица",
    codes: ["1F600", "1F602", "1F605", "1F609", "1F60D", "1F618", "1F62D", "1F621", "1F914", "1F92F", "1F973", "1F60E"],
  },
  {
    id: "hands",
    label: "Жесты",
    codes: ["1F44D", "1F44E", "1F44F", "1F64F", "1F91D", "1F44B", "270C", "1F4AA", "1F64C", "1F937", "1F440", "1F91E"],
  },
  {
    id: "hearts",
    label: "Сердца",
    codes: ["2764", "1F495", "1F496", "1F497", "1F498", "1F49D", "1F49E", "1F5A4", "1F90D", "1F49B", "1F49A", "1F49C"],
  },
  {
    id: "beasts",
    label: "Звери",
    codes: ["1F436", "1F431", "1F981", "1F984", "1F438", "1F430", "1F43C", "1F98A", "1F989", "1F40D", "1F42C", "1F99A"],
  },
] as const;

const STICKER = /^\[\[sticker:([0-9A-F]{3,8})\]\]$/;

export function stickerBody(code: string): string {
  return `[[sticker:${code}]]`;
}

export function stickerCode(body: string): string | null {
  return STICKER.exec(body.trim())?.[1] ?? null;
}

export function stickerUrl(code: string): string {
  return `${CDN}/${code}.svg`;
}

export function isKnownSticker(code: string): boolean {
  return STICKER_PACKS.some((pack) => (pack.codes as readonly string[]).includes(code));
}
