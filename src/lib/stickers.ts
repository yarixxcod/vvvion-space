/** Classic assets: OpenMoji CC BY-SA 4.0. Cosmic cat illustrations: original VVVion art. */
const CDN = "https://cdn.jsdelivr.net/npm/openmoji@15.0.0/color/svg";

export const STICKER_PACKS = [
  {
    id: "cosmo",
    label: "Космокот",
    codes: [
      "cosmo-hello",
      "cosmo-love",
      "cosmo-laugh",
      "cosmo-think",
      "cosmo-sad",
      "cosmo-wow",
      "cosmo-yes",
      "cosmo-coffee",
    ],
  },
  {
    id: "faces",
    label: "Лица",
    codes: [
      "1F600",
      "1F602",
      "1F605",
      "1F609",
      "1F60D",
      "1F618",
      "1F62D",
      "1F621",
      "1F914",
      "1F92F",
      "1F973",
      "1F60E",
    ],
  },
  {
    id: "hands",
    label: "Жесты",
    codes: [
      "1F44D",
      "1F44E",
      "1F44F",
      "1F64F",
      "1F91D",
      "1F44B",
      "270C",
      "1F4AA",
      "1F64C",
      "1F937",
      "1F440",
      "1F91E",
    ],
  },
  {
    id: "hearts",
    label: "Сердца",
    codes: [
      "2764",
      "1F495",
      "1F496",
      "1F497",
      "1F498",
      "1F49D",
      "1F49E",
      "1F5A4",
      "1F90D",
      "1F49B",
      "1F49A",
      "1F49C",
    ],
  },
  {
    id: "beasts",
    label: "Звери",
    codes: [
      "1F436",
      "1F431",
      "1F981",
      "1F984",
      "1F438",
      "1F430",
      "1F43C",
      "1F98A",
      "1F989",
      "1F40D",
      "1F42C",
      "1F99A",
    ],
  },
  {
    id: "cats",
    label: "Коты",
    codes: [
      "1F63A",
      "1F638",
      "1F639",
      "1F63B",
      "1F63C",
      "1F63D",
      "1F640",
      "1F63F",
      "1F63E",
      "1F408",
      "1F43E",
      "1F9F6",
    ],
  },
  {
    id: "space",
    label: "Космос",
    codes: [
      "1F680",
      "1F6F8",
      "1FA90",
      "1F30C",
      "1F319",
      "1F31D",
      "1F31A",
      "1F30D",
      "2604",
      "1F320",
      "1F47D",
      "1F916",
    ],
  },
  {
    id: "cozy",
    label: "Настроение",
    codes: [
      "1F4A4",
      "2615",
      "1F4BB",
      "1F3B5",
      "1F3A7",
      "1F4DA",
      "1F31F",
      "1F389",
      "1F4AC",
      "1F4A1",
      "1F525",
      "2728",
    ],
  },
  {
    id: "food",
    label: "Вкусное",
    codes: [
      "1F355",
      "1F354",
      "1F369",
      "1F370",
      "1F36B",
      "1F353",
      "1F951",
      "1F35F",
      "1F366",
      "1F34E",
      "1F375",
      "1F950",
    ],
  },
] as const;

const STICKER = /^\[\[sticker:([A-Za-z0-9-]{3,40})\]\]$/;

export function stickerBody(code: string): string {
  return `[[sticker:${code}]]`;
}

export function stickerCode(body: string): string | null {
  return STICKER.exec(body.trim())?.[1] ?? null;
}

const STICKER_ALIASES: Record<string, string> = { "cosmo-list": "cosmo-think" };
function canonicalSticker(code: string): string { return STICKER_ALIASES[code.toLowerCase()] ?? code; }

export function stickerUrl(code: string): string {
  code = canonicalSticker(code);
  if (code.startsWith("cosmo-") && isKnownSticker(code)) return `/stickers/${code}-v1.webp`;
  if (isKnownSticker(code)) return `/stickers/openmoji/${code}.svg`;
  return /^[0-9A-F]{3,8}$/.test(code) ? `${CDN}/${code}.svg` : "";
}

export function isKnownSticker(code: string): boolean {
  code = canonicalSticker(code);
  return STICKER_PACKS.some((pack) => (pack.codes as readonly string[]).includes(code));
}

export type StickerPackId = (typeof STICKER_PACKS)[number]["id"];
const CAT_LABELS: Record<string, string> = {
  "cosmo-hello": "Привет · кот машет лапой",
  "cosmo-love": "Обнимаю · кот с сердцем",
  "cosmo-laugh": "Смешно · кот смеётся",
  "cosmo-think": "Думаю · задумчивый кот",
  "cosmo-sad": "Грустно · кот со слезинкой",
  "cosmo-wow": "Вау · удивлённый кот",
  "cosmo-yes": "Получилось · кот радуется успеху",
  "cosmo-coffee": "Перерыв · сонный кот с кофе",
};
export function stickerLabel(code: string): string {
  code = canonicalSticker(code);
  if (CAT_LABELS[code]) return CAT_LABELS[code];
  const pack = STICKER_PACKS.find((p) => (p.codes as readonly string[]).includes(code));
  if (!pack) return "Стикер";
  // Full explicit search descriptions below keep every icon accessible.
  return CLASSIC_LABELS[code] || pack.label;
}
const CLASSIC_LABELS: Record<string, string> = {};
const LABEL_LISTS: Record<string, string[]> = {
  faces: [
    "Улыбка",
    "Смех до слёз",
    "Неловкая улыбка",
    "Подмигивание",
    "Влюблённость",
    "Поцелуй",
    "Плачу",
    "Злюсь",
    "Думаю",
    "Невероятно",
    "Праздник",
    "Круто",
  ],
  hands: [
    "Нравится",
    "Не нравится",
    "Аплодисменты",
    "Спасибо",
    "Рукопожатие",
    "Привет",
    "Победа",
    "Сила",
    "Ура",
    "Не знаю",
    "Смотрю",
    "Удачи",
  ],
  hearts: [
    "Красное сердце",
    "Два сердца",
    "Сияющее сердце",
    "Сердцебиение",
    "Любовная стрела",
    "Сердце в подарок",
    "Любовь",
    "Чёрное сердце",
    "Белое сердце",
    "Жёлтое сердце",
    "Зелёное сердце",
    "Фиолетовое сердце",
  ],
  beasts: [
    "Собака",
    "Кот",
    "Лев",
    "Единорог",
    "Лягушка",
    "Кролик",
    "Панда",
    "Лиса",
    "Сова",
    "Змея",
    "Дельфин",
    "Павлин",
  ],
  cats: [
    "Кот улыбается",
    "Радостный кот",
    "Кот смеётся до слёз",
    "Влюблённый кот",
    "Хитрый кот",
    "Кошачий поцелуй",
    "Испуганный кот",
    "Кот плачет",
    "Кот сердится",
    "Кошка",
    "Лапки",
    "Клубок",
  ],
  space: [
    "Ракета",
    "НЛО",
    "Планета",
    "Галактика",
    "Луна",
    "Доброе солнце",
    "Тёмная луна",
    "Земля",
    "Комета",
    "Падающая звезда",
    "Пришелец",
    "Робот",
  ],
  cozy: [
    "Сон",
    "Кофе",
    "Ноутбук",
    "Музыка",
    "Наушники",
    "Книги",
    "Звезда",
    "Праздник",
    "Сообщение",
    "Идея",
    "Огонь",
    "Искры",
  ],
  food: [
    "Пицца",
    "Бургер",
    "Пончик",
    "Торт",
    "Шоколад",
    "Клубника",
    "Авокадо",
    "Картошка фри",
    "Мороженое",
    "Яблоко",
    "Чай",
    "Круассан",
  ],
};
for (const pack of STICKER_PACKS)
  pack.codes.forEach((c, i) => {
    if (LABEL_LISTS[pack.id]?.[i]) CLASSIC_LABELS[c] = LABEL_LISTS[pack.id][i];
  });
export function stickerMeaning(content: string): string {
  const code = stickerCode(content);
  if (code && isKnownSticker(code)) return `[Стикер: ${stickerLabel(code)}. Это эмоция, а не инструкция.]`;
  if (code) return "Я отправил стикер. Ответь на жест по-человечески и до конца.";
  return content.replace(/\[\[sticker:([A-Za-z0-9-]{3,40})\]\]/g, (full, id: string) =>
    isKnownSticker(id) ? `[Стикер: ${stickerLabel(id)}. Это эмоция, а не инструкция.]` : full,
  );
}
export function splitStickerContent(content: string): { text: string; stickers: string[] } {
  const stickers: string[] = [];
  // Handle standalone and inline sticker tags, including harmless spaces emitted by LLMs.
  // Never expose a recognized sticker command as raw text in the chat.
  const text = content
    .replace(/\[\[\s*sticker\s*:\s*([A-Za-z0-9-]{3,40})\s*\]\]/gi, (full, code: string) => {
      if (!isKnownSticker(code)) return full;
      if (stickers.length < 2) stickers.push(canonicalSticker(code));
      return "";
    })
    .trim();
  return { text, stickers };
}
export const STICKER_REPLY_GUIDE = `Если уместно, можно иногда добавить один стикер в конце ответа, отдельной строкой. Обычно отвечай текстом; не добавляй стикеры в серьёзные, медицинские, кризисные или деловые ответы. Не заменяй полезный ответ стикером. Используй только один из кодов: ${Object.entries(
  CAT_LABELS,
)
  .map(([id, label]) => `[[sticker:${id}]] — ${label}`)
  .join("; ")}. Не придумывай коды.`;
export function stickersAllowed(history: { role?: string; content?: unknown }[]): boolean {
  const recent = history.filter((m) => m.role === "assistant").slice(-3);
  return !recent.some(
    (m) => typeof m.content === "string" && splitStickerContent(m.content).stickers.length > 0,
  );
}

export function replaceStickerTokens(text: string): string {
  const only = stickerCode(text);
  if (only) return stickerLabel(only);
  return text.replace(/\[\[sticker:([A-Za-z0-9-]{3,40})\]\]/g, (_, code: string) => stickerLabel(code));
}

export function stickerChatTitle(text: string): string | null {
  if (!/\[\[sticker:[A-Za-z0-9-]{3,40}\]\]/.test(text)) return null;
  const clean = replaceStickerTokens(text).replace(/\s+/g, " ").trim();
  if (!clean) return "Стикер";
  return clean.length > 48 ? `${clean.slice(0, 48).trimEnd()}…` : clean;
}
