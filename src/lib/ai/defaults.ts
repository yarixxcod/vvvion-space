import type { Provider } from "@/lib/ai/types";
import type { Lang } from "@/lib/i18n";

export const BUILTIN_ID = "yaronetic";
export const DB_NAME = "yaronetic-ai";
export const PREF_THEME = "yaronetic.theme";
export const PREF_FACE = "yaronetic.face";
export const PREF_SEARCH = "yaronetic.searchEngine";
export const PREF_REASON = "yaronetic.reasoning";
export const PREF_PROVIDER = "yaronetic.activeProviderId";
export const PREF_NAME = "yaronetic.displayName";
export const PREF_CHAT = "yaronetic.activeChatId";
export const PREF_CHAT_OWNER = "yaronetic.chatOwner";

export const BUILTIN_MODELS = ["grok-4.5", "grok-4.6", "grok-4.7", "grok-4.3"];

export const DEFAULT_NAME = "vvvion.space";

export const SUGGESTIONS = [
  {
    title: "Сравнить подходы",
    prompt:
      "Сравни Zustand, Redux и локальный useState для среднего React-приложения. Коротко: таблица и вывод.",
  },
  {
    title: "Сравнить API",
    prompt:
      "Сравни REST, GraphQL и tRPC для небольшого продукта. Когда какой вариант спокойнее сопровождать?",
  },
  {
    title: "Сравнить стили",
    prompt:
      "Сравни CSS Modules, Tailwind и обычный CSS для командного интерфейса. Коротко: плюсы и когда не брать.",
  },
  {
    title: "Функция groupBy",
    prompt:
      "Напиши на TypeScript функцию groupBy с аккуратными типами и двумя примерами вызова.",
  },
  {
    title: "Функция debounce",
    prompt:
      "Напиши на TypeScript debounce: отмена предыдущего вызова, типы для аргументов и пример на поле поиска.",
  },
  {
    title: "Функция chunk",
    prompt:
      "Напиши на TypeScript функцию chunk, которая режет массив на куски заданного размера. Крайние случаи тоже.",
  },
  {
    title: "Разобрать ошибку",
    prompt:
      "Как отличить ошибку CORS от неверного API-ключа, когда чат ходит к OpenAI-совместимому серверу?",
  },
  {
    title: "429 или обрыв",
    prompt:
      "Модель отвечает 429, а иногда поток обрывается на полуслове. Как отличить лимит от сети и что повторять?",
  },
  {
    title: "Пустой ответ",
    prompt:
      "Чат показывает пустой ответ без ошибки. Какие причины проверить: стрим, прокси, max_tokens и формат SSE?",
  },
  {
    title: "Собрать план",
    prompt:
      "Составь спокойный план одностраничного AI-чата: экраны, состояния и что хранить только в браузере.",
  },
  {
    title: "План переноса",
    prompt:
      "Составь план переноса истории чата из браузера в аккаунт: что копировать, что не тащить и как не потерять диалог.",
  },
  {
    title: "План вечера",
    prompt:
      "Собери короткий план вечера на два часа: одна задача в коде, одна на отдых и как понять, что день закрыт.",
  },
] as const;

const SUGGESTIONS_EN = [
  { title: "Compare approaches", prompt: "Compare Zustand, Redux and local useState for a mid-size React app. Briefly: a table and a conclusion." },
  { title: "Compare APIs", prompt: "Compare REST, GraphQL and tRPC for a small product. When is each one calmer to maintain?" },
  { title: "Compare styles", prompt: "Compare CSS Modules, Tailwind and plain CSS for a team interface. Briefly: the upside and when not to use each." },
  { title: "groupBy function", prompt: "Write a TypeScript groupBy with careful types and two call examples." },
  { title: "debounce function", prompt: "Write a TypeScript debounce: cancel the previous call, types for the arguments, and an example on a search field." },
  { title: "chunk function", prompt: "Write a TypeScript chunk that splits an array into pieces of a given size. Cover the edge cases too." },
  { title: "Read an error", prompt: "How do you tell a CORS error from a bad API key when a chat calls an OpenAI-compatible server?" },
  { title: "429 or a drop", prompt: "The model answers 429, and sometimes the stream breaks mid-word. How do you tell a limit from the network, and what should be retried?" },
  { title: "Empty answer", prompt: "The chat shows an empty answer and no error. What should be checked: the stream, the proxy, max_tokens and the SSE format?" },
  { title: "Make a plan", prompt: "Draft a calm plan for a one-page AI chat: screens, states, and what stays only in the browser." },
  { title: "Move the history", prompt: "Plan moving chat history from the browser into an account: what to copy, what to leave, and how not to lose a conversation." },
  { title: "Evening plan", prompt: "Make a short two-hour evening plan: one coding task, one rest, and how to know the day is closed." },
] as const;

const SUGGESTIONS_KK = [
  { title: "Тәсілдерді салыстыру", prompt: "Орташа React қосымшасы үшін Zustand, Redux және жергілікті useState салыстыр. Қысқаша: кесте және қорытынды." },
  { title: "API салыстыру", prompt: "Кішкентай өнім үшін REST, GraphQL және tRPC салыстыр. Қайсысын алып жүру жеңілірек?" },
  { title: "Стильді салыстыру", prompt: "Командалық интерфейс үшін CSS Modules, Tailwind және қарапайым CSS салыстыр. Қысқаша: артықшылығы және қашан алмау керек." },
  { title: "groupBy функциясы", prompt: "Мұқият типтері бар TypeScript groupBy жаз және екі шақыру мысалын бер." },
  { title: "debounce функциясы", prompt: "TypeScript-те debounce жаз: алдыңғы шақыруды болдырмау, аргумент типтері және іздеу жолындағы мысал." },
  { title: "chunk функциясы", prompt: "Массивті берілген өлшемдегі бөліктерге бөлетін TypeScript chunk жаз. Шеткі жағдайларды да қос." },
  { title: "Қатені айыру", prompt: "Чат OpenAI-үйлесімді серверге барғанда CORS қатесін қате API кілтінен қалай айырасың?" },
  { title: "429 немесе үзілу", prompt: "Модель 429 қайтарады, кейде ағын сөздің ортасында үзіледі. Лимитті желіден қалай айырып, нені қайталау керек?" },
  { title: "Бос жауап", prompt: "Чат қатесіз бос жауап көрсетеді. Нені тексеру керек: ағын, прокси, max_tokens және SSE пішімі?" },
  { title: "Жоспар құру", prompt: "Бір беттік ЖИ чатының сабырлы жоспарын жаса: экрандар, күйлер және браузерде ғана қалатыны." },
  { title: "Тарихты көшіру", prompt: "Чат тарихын браузерден аккаунтқа көшіру жоспарын жаса: нені көшіру, нені қалдыру және диалогты жоғалтпау." },
  { title: "Кешкі жоспар", prompt: "Екі сағаттық қысқа кеш жоспарын жина: бір код тапсырмасы, бір демалыс және күннің жабылғанын қалай білу." },
] as const;

export function suggestionsFor(lang: Lang): readonly { title: string; prompt: string }[] {
  if (lang === "en") return SUGGESTIONS_EN;
  if (lang === "kk") return SUGGESTIONS_KK;
  return SUGGESTIONS;
}

export function builtinProvider(): Provider {
  return {
    id: BUILTIN_ID,
    name: "vvvion.space",
    kind: "builtin",
    baseUrl: "https://api.x.ai/v1",
    apiKey: "",
    extraHeaders: [],
    chatPath: "/chat/completions",
    models: [...BUILTIN_MODELS],
    model: "grok-4.5",
    systemPrompt:
      "Ты vvvion.space — точный и спокойный ассистент. Отвечай на языке пользователя. Длина соразмерна вопросу: коротко, если вопрос короткий; развёрнуто — только когда просят объяснить, сравнить, написать код, таблицу или план. Без вступлений, повторов и лишних списков. Код и таблицы оформляй в Markdown. Формулы пиши в TeX: короткие в $...$, отдельные строкой в $$...$$. Рецепты и инструкции пиши списком Markdown, без тегов Sequence и Step. Не выдумывай факты и источники.",
    temperature: 0.7,
    maxTokens: 8192,
  };
}

export function blankProvider(): Provider {
  return {
    id: crypto.randomUUID(),
    name: "Своё подключение",
    kind: "custom",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    extraHeaders: [],
    chatPath: "/chat/completions",
    models: [],
    model: "",
    imageModel: "dall-e-3",
    systemPrompt: "",
    temperature: 0.7,
    maxTokens: 1200,
  };
}

export function makeTitle(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "Новый диалог";
  return clean.length > 48 ? `${clean.slice(0, 48).trimEnd()}…` : clean;
}
