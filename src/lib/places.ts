import { SITE } from "@/lib/release";

export type CircleTab = "chat" | "feed" | "play" | "services" | "disk" | "bank" | "shop" | "admin";

const CIRCLE_TABS: readonly CircleTab[] = ["chat", "feed", "play", "services", "disk", "bank", "shop", "admin"];

export function isCircleTab(value: unknown): value is CircleTab {
  return typeof value === "string" && (CIRCLE_TABS as readonly string[]).includes(value);
}

export type Place = {
  slug: string;
  tab: CircleTab;
  name: string;
  title: string;
  description: string;
  lead: string;
};

export const PLACES: Place[] = [
  {
    slug: "messages",
    tab: "chat",
    name: "Сообщения",
    title: "Сообщения — круг vvvion.space",
    description: "Личные диалоги, группы, голосовые, стикеры и файлы до 200 МБ. Переписка круга vvvion.space.",
    lead: "Друзья, группы и файлы в одной переписке. Голосовые можно расшифровать, картинку открыть крупно. Файл в сообщении — до 200 МБ.",
  },
  {
    slug: "feed",
    tab: "feed",
    name: "Лента",
    title: "Лента — круг vvvion.space",
    description: "Записи и ответы круга vvvion.space: текст, картинки и обсуждение.",
    lead: "Короткие записи тех, с кем вы в круге. Ответ виден под записью, а не в отдельном чате.",
  },
  {
    slug: "play",
    tab: "play",
    name: "Развлечения",
    title: "Читальня, смотрельня и игры — vvvion.space",
    description: "Книги, ролики и игра «Прилавок» внутри vvvion.space. Заказы на прилавке платят вублями, не больше 60 в сутки.",
    lead: "Читальня держит общую полку: EPUB, FB2, TXT и PDF. Смотрельня показывает ролики по ссылке. В играх — прилавок: одинаковые вещи соединяются, заказы сдаются за вубли.",
  },
  {
    slug: "services",
    tab: "services",
    name: "Сервисы",
    title: "Погода, новости, курсы и VPN — vvvion.space",
    description: "Погода, новости, курсы и подписка VVVION VPN для Happ, Incy и Karing.",
    lead: "Погода, новости, курсы и VPN.",
  },
  {
    slug: "disk",
    tab: "disk",
    name: "Диск",
    title: "Диск — картинки и голосовые — vvvion.space",
    description: "Личный диск vvvion.space: картинки моделей, голосовые, общая ссылка и архив.",
    lead: "Сюда сами складываются рисунки и голос из чата. Место можно докупить, архив скачивается целиком.",
  },
  {
    slug: "bank",
    tab: "bank",
    name: "Банк",
    title: "Банк вублей — vvvion.space",
    description: "Внутренние вубли vvvion.space: карта, перевод другу или по номеру и приглашения. Это не деньги.",
    lead: "Вубли — внутренняя мелочь сервиса, не рубли и не электронные деньги. Карта, перевод другу или по номеру.",
  },
  {
    slug: "shop",
    tab: "shop",
    name: "Магазин",
    title: "Магазин — vvvion.space",
    description: "Подписка VVVION PREMIUM, место на диске, дополнительные запросы и персонажи для чата.",
    lead: "Подписка на 30 дней, место на диске и персонажи. Вубли — внутренняя мелочь, не деньги.",
  },
];

export function placeBySlug(slug: string): Place | undefined {
  return PLACES.find((place) => place.slug === slug);
}

export function placePath(slug: string): string {
  return `/c/${slug}`;
}

export function absoluteUrl(path: string): string {
  return `${SITE}${path.startsWith("/") ? path : `/${path}`}`;
}
