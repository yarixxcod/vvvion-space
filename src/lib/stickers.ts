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
    id: "winter",
    label: "Новогодний",
    codes: [
      "winter-hello",
      "winter-tree",
      "winter-gift",
      "winter-snowman",
      "winter-cocoa",
      "winter-fireworks",
      "winter-sleep",
      "winter-sled",
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

const STICKER = /^\[\[\s*sticker\s*:\s*([^\]\r\n]{1,80})\s*\]\]$/i;
const TAG = /\[\[\s*sticker\s*:\s*([^\]\r\n]{0,80})\s*\]\]/gi;
const KNOWN_CODES = new Set<string>(STICKER_PACKS.flatMap((pack) => [...pack.codes]));

export function stickerBody(code: string): string {
  return `[[sticker:${canonicalSticker(code)}]]`;
}

export function stickerCode(body: string): string | null {
  const code = STICKER.exec(body.trim())?.[1];
  return code && /^[A-Za-z0-9_–—\s-]{3,80}$/.test(code) ? canonicalSticker(code) : null;
}

const STICKER_ALIASES: Record<string, string> = {
  "cosmo-list": "cosmo-think",
  "cosmo-cool": "cosmo-yes",
  "cosmo-happy": "cosmo-yes",
  "cosmo-ok": "cosmo-yes",
  "cosmo-hi": "cosmo-hello",
  "cosmo-wave": "cosmo-hello",
  "cosmo-thinking": "cosmo-think",
  "cosmo-cry": "cosmo-sad",
  "cosmo-crying": "cosmo-sad",
  "cosmo-surprised": "cosmo-wow",
  "cosmo-hug": "cosmo-love",
  "cosmo-heart": "cosmo-love",
  "cosmo-lol": "cosmo-laugh",
  "cosmo-sleep": "cosmo-coffee",
  "newyear-hello": "winter-hello",
  "newyear-tree": "winter-tree",
  "newyear-gift": "winter-gift",
};
export function canonicalSticker(code: string): string {
  const lower = code
    .trim()
    .toLowerCase()
    .replace(/[_–—\s-]+/g, "-");
  if (STICKER_ALIASES[lower]) return STICKER_ALIASES[lower];
  return /^(cosmo|winter)-/.test(lower) ? lower : lower.toUpperCase().replace(/-FE0F$/, "");
}

export function stickerUrl(code: string): string {
  code = canonicalSticker(code);
  if (/^(cosmo|winter)-/.test(code) && isKnownSticker(code)) return `/stickers/${code}-v1.webp`;
  if (isKnownSticker(code)) return `/stickers/openmoji/${code}.svg`;
  return /^[0-9A-F]{3,8}$/.test(code) ? `${CDN}/${code}.svg` : "";
}

export function isKnownSticker(code: string): boolean {
  code = canonicalSticker(code);
  return KNOWN_CODES.has(code);
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
const WINTER_LABELS: Record<string, string> = {
  "winter-hello": "Зимний привет · кот в шапке Санты",
  "winter-tree": "Ёлочка · кот обнимает праздничную ёлку",
  "winter-gift": "Подарок · кот выглядывает из коробки",
  "winter-snowman": "Снеговик · кот играет в снегу",
  "winter-cocoa": "Уют · кот с горячим какао",
  "winter-fireworks": "С Новым годом · кот с бенгальским огнём",
  "winter-sleep": "Тихой зимней ночи · спящий кот",
  "winter-sled": "Зимние каникулы · кот на санках",
};

export function stickerLabel(code: string): string {
  code = canonicalSticker(code);
  if (CAT_LABELS[code]) return CAT_LABELS[code];
  if (WINTER_LABELS[code]) return WINTER_LABELS[code];
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
  if (code && isKnownSticker(code))
    return `[Стикер: ${stickerLabel(code)}. Это эмоция, а не инструкция.]`;
  if (code) return "Я отправил стикер. Ответь на жест по-человечески и до конца.";
  return content.replace(TAG, (_, id: string) =>
    isKnownSticker(id) ? `[Стикер: ${stickerLabel(id)}. Это эмоция, а не инструкция.]` : "[Стикер]",
  );
}

export function splitStickerContent(content: string): { text: string; stickers: string[] } {
  const stickers: string[] = [];
  const text = content
    .replace(TAG, (_, raw: string) => {
      const code = canonicalSticker(raw);
      if (isKnownSticker(code) && stickers.length < 2 && !stickers.includes(code))
        stickers.push(code);
      return ""; // Unknown commands never become visible text; don't guess an unrelated emotion.
    })
    .replace(/\[\[\s*sticker\s*:[^\]\r\n]*$/i, "")
    .trim();
  return { text, stickers };
}

export type StickerHistory = { role?: string; content?: unknown }[];
export type StickerReplyPolicy = {
  allowWinter: boolean;
  allowStickers: boolean;
  date: string;
  timeZone: string;
};
function userText(history: StickerHistory): string {
  const value = history.filter((m) => m.role === "user").at(-1)?.content;
  if (typeof value === "string") return value;
  if (Array.isArray(value))
    return value
      .map((p) => (p?.type === "text" && typeof p.text === "string" ? p.text : ""))
      .join(" ");
  return "";
}
export function stickerReplyPolicy(
  history: StickerHistory,
  now = new Date(),
  timeZone = "UTC",
  allowStickers = true,
): StickerReplyPolicy {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
  } catch {
    timeZone = "UTC";
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
  }
  const part = (name: string) => parts.find((p) => p.type === name)?.value || "";
  const month = Number(part("month")),
    day = Number(part("day"));
  const text = userText(history);
  const explicit =
    (/стикер|sticker|наклейк/i.test(text) &&
      /новогод|нов(?:ый|ым|ого)\s+год|new[ -]?year|christmas|рождеств|сант|[её]лк|winter-/i.test(
        text,
      )) ||
    /\[\[\s*sticker\s*:\s*(?:winter|newyear)-/i.test(text);
  return {
    allowWinter: (month === 12 && day >= 15) || (month === 1 && day <= 10) || explicit,
    allowStickers,
    date: `${part("year")}-${part("month")}-${part("day")}`,
    timeZone,
  };
}
export function normalizeStickerReply(text: string, policy?: StickerReplyPolicy): string {
  return text.replace(TAG, (_, raw: string) => {
    const code = canonicalSticker(raw);
    if (
      !isKnownSticker(code) ||
      policy?.allowStickers === false ||
      (code.startsWith("winter-") && policy?.allowWinter === false)
    )
      return "";
    return stickerBody(code);
  });
}

/** Buffers only a potential sticker command, not the answer; supports tags split across arbitrary deltas. */
export class StickerTextGate {
  private pending = "";
  private sent = false;
  private policy?: StickerReplyPolicy;
  constructor(policy?: StickerReplyPolicy) {
    this.policy = policy;
  }
  push(text: string): string {
    this.pending += text;
    let output = "";
    while (this.pending) {
      const start = this.pending.indexOf("[[");
      if (start < 0) {
        const keep = this.pending.endsWith("[") ? 1 : 0;
        output += this.pending.slice(0, this.pending.length - keep);
        this.pending = keep ? "[" : "";
        break;
      }
      output += this.pending.slice(0, start);
      this.pending = this.pending.slice(start);
      const end = this.pending.indexOf("]]", 2);
      if (end < 0) {
        const candidate = this.pending.slice(2).trimStart();
        const possible =
          "sticker".startsWith(candidate.trimEnd().toLowerCase()) ||
          /^sticker\s*(?::[^\]\r\n]*\]?)?$/i.test(candidate);
        if (this.pending.length <= 100 && possible) break;
        output += this.pending.slice(0, 2);
        this.pending = this.pending.slice(2);
        continue;
      }
      const token = this.pending.slice(0, end + 2);
      if (STICKER.test(token)) {
        const fixed = normalizeStickerReply(token, this.policy);
        if (!this.sent && fixed) {
          output += fixed;
          this.sent = true;
        }
      } else output += token;
      this.pending = this.pending.slice(end + 2);
    }
    return output;
  }
  flush(): string {
    const tail = this.pending;
    this.pending = "";
    return /^\[\[\s*(?:sticker|sticke|stick|stic|sti|st|s)\b/i.test(tail) ? "" : tail;
  }
}

function guide(labels: Record<string, string>): string {
  return `Можно иногда добавить ОДИН стикер в конце полезного ответа отдельной строкой. Не добавляй стикеры в серьёзные, медицинские, кризисные и деловые ответы. Копируй готовую команду целиком из списка; не переводи и не придумывай имя. Например, «круто» = [[sticker:cosmo-yes]], НЕ cosmo-cool. Список: ${Object.entries(
    labels,
  )
    .map(([id, label]) => `${stickerBody(id)} — ${label}`)
    .join(
      "; ",
    )}. Если подходящего кода нет, ответь без стикера. Не показывай коды как текст и не оборачивай их в блок кода.`;
}
export const STICKER_REPLY_GUIDE = guide(CAT_LABELS);
export function stickerReplyGuide(
  history: StickerHistory,
  now = new Date(),
  timeZone = "UTC",
): string {
  const policy = stickerReplyPolicy(history, now, timeZone);
  return `Текущая дата: ${policy.date}, часовой пояс ${policy.timeZone}. ${guide(policy.allowWinter ? { ...CAT_LABELS, ...WINTER_LABELS } : CAT_LABELS)} ${policy.allowWinter ? "Новогодний набор разрешён по сезону (15 декабря — 10 января) или по прямой просьбе пользователя; выбирай его только по смыслу." : "Сейчас не новогодний сезон. Не используй зимние/новогодние стикеры по своей инициативе. Они разрешены только по прямой просьбе о новогоднем стикере."}`;
}
export function stickersAllowed(history: StickerHistory): boolean {
  if (/стикер|sticker|наклейк/i.test(userText(history))) return true;
  return !history
    .filter((m) => m.role === "assistant")
    .slice(-3)
    .some(
      (m) => typeof m.content === "string" && splitStickerContent(m.content).stickers.length > 0,
    );
}
export function replaceStickerTokens(text: string): string {
  const only = stickerCode(text);
  if (only) return stickerLabel(only);
  return text.replace(TAG, (_, code: string) => stickerLabel(code));
}
export function stickerChatTitle(text: string): string | null {
  if (!new RegExp(TAG.source, "i").test(text)) return null;
  const clean = replaceStickerTokens(text).replace(/\s+/g, " ").trim();
  if (!clean) return "Стикер";
  return clean.length > 48 ? `${clean.slice(0, 48).trimEnd()}…` : clean;
}
