import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  BUILTIN_ID,
  DEFAULT_NAME,
  PREF_CHAT,
  PREF_CHAT_OWNER,
  PREF_FACE,
  PREF_SEARCH,
  PREF_REASON,
  PREF_NAME,
  PREF_PROVIDER,
  PREF_THEME,
  blankProvider,
  builtinProvider,
  makeTitle,
} from "@/lib/ai/defaults";
import { deleteChat, loadChats, loadProviders, saveChat, saveProviders, clearChats, wipeDatabase } from "@/lib/ai/db";
import { GUEST_OWNER, localChatAccess } from "@/lib/ai/chat-owner";
import { deleteCloudChat, deleteAllCloudChats, listCloudChats, saveCloudChat } from "@/lib/ai/cloud";
import { ACCOUNT_REQUIRED_MESSAGE } from "@/lib/ai/guest-limit";
import { streamChat } from "@/lib/ai/stream-client";
import { pluginNote } from "@/lib/ai/calc";
import { enabledMcpUrls } from "@/lib/ai/mcp";
import type { Chat, ChatFile, ChatMessage, ChatTurn, Provider, ThemeMode, Usage } from "@/lib/ai/types";
import { isFaceVariant, type FaceVariant } from "@/components/yaronetic/model-face";
import { isSearchEngine, type SearchEngine } from "@/lib/ai/search-engine";
import { applyPaper, readStoredPaper, PREF_PAPER, type PaperId } from "@/lib/ai/paper";
import { readLivePersona } from "@/lib/social/persona-live";
import { listImageModels, listModels } from "@/lib/social/admin";
import { getBearerToken } from "@/lib/auth/client";
import { appNotify, isApp } from "@/lib/app-bridge";
import { haptic } from "@/lib/haptic";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

const LEGACY_NAME = "Yaronetic";

function seedBuiltin(rows?: { name: string; displayName: string; icon?: string }[]): Provider {
  const base = builtinProvider();
  if (!rows?.length) return base;
  const models = rows.map((row) => row.name);
  return {
    ...base,
    models,
    model: models.includes(base.model) ? base.model : models[0] || base.model,
  };
}

const LEGACY_PROMPT =
  "Ты Yaronetic — точный и спокойный ассистент. Отвечай на языке пользователя, по существу. Код и таблицы оформляй в Markdown. Не выдумывай факты и источники.";
const PREVIOUS_PROMPT =
  "Ты vvvion.space — точный и спокойный ассистент. Отвечай на языке пользователя, по существу. Код и таблицы оформляй в Markdown. Не выдумывай факты и источники.";
const SHORT_PROMPT =
  "Ты vvvion.space — точный и спокойный ассистент. Отвечай на языке пользователя. Длина соразмерна вопросу: коротко, если вопрос короткий; развёрнуто — только когда просят объяснить, сравнить, написать код, таблицу или план. Без вступлений, повторов и лишних списков. Код и таблицы оформляй в Markdown. Не выдумывай факты и источники.";

function readTheme(): ThemeMode {
  try {
    return localStorage.getItem(PREF_THEME) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function readPaper(): PaperId {
  try {
    const value = localStorage.getItem(PREF_PAPER);
    const paper = readStoredPaper(value);
    if (value && value !== paper) localStorage.setItem(PREF_PAPER, paper);
    return paper;
  } catch {
    return "plain";
  }
}

function readFace(): FaceVariant {
  try {
    const value = localStorage.getItem(PREF_FACE);
    return isFaceVariant(value) ? value : "pebble";
  } catch {
    return "pebble";
  }
}

function readSearch(): SearchEngine {
  try {
    const value = localStorage.getItem(PREF_SEARCH);
    return isSearchEngine(value) ? value : "duck";
  } catch {
    return "duck";
  }
}

function readReasoning(): boolean {
  try {
    return localStorage.getItem(PREF_REASON) !== "0";
  } catch {
    return true;
  }
}

function noteLimit(pct: number) {
  const band = pct <= 0 ? 0 : pct <= 10 ? 10 : pct <= 25 ? 25 : pct <= 50 ? 50 : null;
  if (band == null) return;
  const key = `vvvion.limit.${new Date().toISOString().slice(0, 10)}`;
  let seen = 100;
  try {
    const stored = Number(sessionStorage.getItem(key) ?? 100);
    seen = Number.isFinite(stored) ? stored : 100;
  } catch {
    seen = 100;
  }
  if (band >= seen) return;
  try {
    sessionStorage.setItem(key, String(band));
  } catch {
    /* private mode */
  }
  const text =
    band === 0
      ? "Дневной лимит закончился. Новые запросы откроются через сутки."
      : band === 10
        ? "Осталось меньше 10% дневного лимита."
        : band === 25
          ? "Осталось 25% дневного лимита."
          : "Осталась половина дневного лимита.";
  toast(text, { duration: 7000 });
}

function applyTheme(theme: ThemeMode) {
  document.documentElement.classList.toggle("light", theme === "light");
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute("content", theme === "light" ? "#f4f1ea" : "#0c0c0e");
}

function readOwner(): string | null {
  try {
    return localStorage.getItem(PREF_CHAT_OWNER);
  } catch {
    return null;
  }
}

function writeOwner(owner: string | null) {
  try {
    if (owner) localStorage.setItem(PREF_CHAT_OWNER, owner);
    else localStorage.removeItem(PREF_CHAT_OWNER);
  } catch {
    /* private mode */
  }
}

function wireTurns(items: ChatMessage[]): ChatTurn[] {
  const lastUser = [...items].reverse().find((item) => item.role === "user")?.id;
  const turns: ChatTurn[] = [];
  for (const item of items) {
    const notes = (item.files ?? []).flatMap((file) => {
      if (file.kind === "text" && file.text) return [`Файл «${file.name}»:\n${file.text}`];
      if (file.kind === "file") return [`Приложен файл «${file.name}».`];
      return [];
    });
    const text = [item.content.trim(), ...notes].filter(Boolean).join("\n\n").slice(0, 24_000);
    const images =
      item.id === lastUser ? (item.files ?? []).filter((file) => file.kind === "image" && file.dataUrl) : [];
    if (!text && images.length === 0) continue;
    const turn: ChatTurn = !images.length
      ? { role: item.role, content: text }
      : {
          role: item.role,
          content: [
            ...(text ? [{ type: "text" as const, text }] : []),
            ...images.flatMap((image) =>
              image.dataUrl ? [{ type: "image_url" as const, image_url: { url: image.dataUrl } }] : [],
            ),
          ],
        };
    if (item.role === "assistant" && item.reasoning) turn.reasoning = item.reasoning.slice(0, 6_000);
    turns.push(turn);
  }
  return turns;
}

type LiveRun = {
  chatId: string;
  asstId: string;
  base: Chat;
  messages: ChatMessage[];
};

type DetachedWatch = {
  chatId: string;
  asstId: string;
  until: number;
  startedAt: number;
  seen: number;
};

function isNetworkDrop(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "AbortError") return false;
  if (!(err instanceof Error)) return false;
  const text = err.message.toLowerCase();
  return (
    err instanceof TypeError ||
    text.includes("network error") ||
    text.includes("failed to fetch") ||
    text.includes("load failed") ||
    text.includes("networkerror")
  );
}

function isDropError(value: string | undefined): boolean {
  if (!value) return false;
  const text = value.toLowerCase();
  return text.includes("network error") || text.includes("failed to fetch") || text.includes("load failed") || text.includes("networkerror");
}

function lastAssistant(chat: Chat): ChatMessage | undefined {
  for (let i = chat.messages.length - 1; i >= 0; i -= 1) {
    if (chat.messages[i]?.role === "assistant") return chat.messages[i];
  }
  return undefined;
}

function replyRichness(chat: Chat | undefined): number {
  const msg = chat ? lastAssistant(chat) : undefined;
  if (!msg) return 0;
  return msg.content.length + (msg.imageUrl ? 1_000_000 : 0);
}

function watchReady(chat: Chat, watch: DetachedWatch): boolean {
  const msg = chat.messages.find((item) => item.id === watch.asstId) ?? lastAssistant(chat);
  if (!msg || msg.live) return false;
  if (!(msg.content.trim() || msg.error || msg.imageUrl || msg.stopped)) return false;
  return chat.updatedAt > watch.startedAt || msg.content.length > watch.seen || Boolean(msg.imageUrl || msg.error || msg.stopped);
}

async function postStop(chatId: string) {
  const headers = new Headers({ "content-type": "application/json" });
  const token = getBearerToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  await fetch("/api/chat", {
    method: "POST",
    headers,
    credentials: "same-origin",
    body: JSON.stringify({ mode: "stop", chatId }),
  });
}

export function useStudio(initialModels?: { name: string; displayName: string; icon?: string }[]) {
  const { user, isPending } = useCurrentUserState();
  const [ready, setReady] = useState(false);
  const [theme, setThemeState] = useState<ThemeMode>("dark");
  const [paper, setPaperState] = useState<PaperId>("plain");
  const [face, setFaceState] = useState<FaceVariant>("pebble");
  const [searchEngine, setSearchEngineState] = useState<SearchEngine>("duck");
  const [reasoning, setReasoningState] = useState(true);
  const [displayName, setDisplayNameState] = useState(DEFAULT_NAME);
  const [providers, setProviders] = useState<Provider[]>(() => [seedBuiltin(initialModels)]);
  const [activeProviderId, setActiveProviderIdState] = useState(BUILTIN_ID);
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatIdState] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamingChatId, setStreamingChatId] = useState<string | null>(null);
  const setStreamId = (id: string | null) => {
    streamingIdRef.current = id;
    setStreamingChatId(id);
  };
  const [continuingId, setContinuingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [guestLeft, setGuestLeft] = useState<number | null>(null);
  const [needAccount, setNeedAccount] = useState(false);
  const [imageMode, setImageMode] = useState(false);
  const [webMode, setWebMode] = useState(false);
  const [askMode, setAskMode] = useState(true);
  const [attachments, setAttachments] = useState<ChatFile[]>([]);
  const [modelLabels, setModelLabels] = useState<Record<string, string>>(() =>
    Object.fromEntries((initialModels ?? []).map((row) => [row.name, row.displayName || row.name])),
  );
  const [modelIcons, setModelIcons] = useState<Record<string, string>>(() =>
    Object.fromEntries((initialModels ?? []).map((row) => [row.name, row.icon || ""])),
  );
  const [modelPrompts, setModelPrompts] = useState<Record<string, string>>({});
  const [imageModels, setImageModels] = useState<{ name: string; displayName: string }[]>([]);

  const messagesRef = useRef<ChatMessage[]>([]);
  const chatsRef = useRef<Chat[]>([]);
  const providersRef = useRef<Provider[]>(providers);
  const activeChatRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const stopRef = useRef(false);
  const abandonRef = useRef(false);
  const liveRef = useRef<LiveRun | null>(null);
  const detachedRef = useRef<DetachedWatch | null>(null);
  const pullRef = useRef<() => void>(() => undefined);
  const persistRef = useRef<(chat: Chat, cloudNow?: boolean) => Promise<void>>(async () => undefined);
  const imageModelsRef = useRef<{ name: string; displayName: string }[]>([]);
  const modelLabelsRef = useRef<Record<string, string>>({});
  const modelPromptsRef = useRef<Record<string, string>>({});
  const searchEngineRef = useRef<SearchEngine>("duck");
  const reasoningRef = useRef(true);
  const displayNameRef = useRef(DEFAULT_NAME);
  const wipeEpoch = useRef(0);
  displayNameRef.current = displayName;
  const busyRef = useRef(false);
  const streamingIdRef = useRef<string | null>(null);
  const readyRef = useRef(true);
  const userIdRef = useRef<string | null>(null);
  const guestLeftRef = useRef<number | null>(null);
  const attachmentsRef = useRef<ChatFile[]>([]);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  const setMsgs = useCallback((next: ChatMessage[]) => {
    messagesRef.current = next;
    setMessages(next);
  }, []);

  useEffect(() => {
    setAskMode(localStorage.getItem("vvvion.plugin.ask") == null ? true : localStorage.getItem("vvvion.plugin.ask") === "1");
  }, []);

  useEffect(() => {
    userIdRef.current = user?.id ?? null;
  }, [user?.id]);

  useEffect(() => {
    guestLeftRef.current = guestLeft;
  }, [guestLeft]);

  useEffect(() => {
    providersRef.current = providers;
  }, [providers]);

  useEffect(() => {
    chatsRef.current = chats;
  }, [chats]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const storedProviders = await loadProviders();
        if (cancelled) return;
        const builtin = storedProviders.find((item) => item.kind === "builtin") ?? builtinProvider();
        const fresh = builtinProvider();
        const nextProviders = [
          {
            ...fresh,
            ...builtin,
            kind: "builtin" as const,
            apiKey: "",
            extraHeaders: [],
            baseUrl: fresh.baseUrl,
            chatPath: fresh.chatPath,
            name: !builtin.name || builtin.name === LEGACY_NAME ? fresh.name : builtin.name,
            systemPrompt:
              !builtin.systemPrompt ||
              builtin.systemPrompt === LEGACY_PROMPT ||
              builtin.systemPrompt === PREVIOUS_PROMPT ||
              builtin.systemPrompt === SHORT_PROMPT
                ? fresh.systemPrompt
                : builtin.systemPrompt,
            maxTokens:
              !builtin.maxTokens || builtin.maxTokens === 1200 || builtin.maxTokens === 2048 || builtin.maxTokens === 8192
                ? fresh.maxTokens
                : builtin.maxTokens,
          },
        ];
        const storedName = localStorage.getItem(PREF_NAME);
        const name = (!storedName || storedName === LEGACY_NAME ? DEFAULT_NAME : storedName).slice(0, 32);
        const themeNext = readTheme();
        const paperNext = readPaper();
        const faceNext = readFace();
        const searchNext = readSearch();
        applyTheme(themeNext);
        applyPaper(paperNext);
        setThemeState(themeNext);
        setPaperState(paperNext);
        setFaceState(faceNext);
        setSearchEngineState(searchNext);
        searchEngineRef.current = searchNext;
        const reasonNext = readReasoning();
        setReasoningState(reasonNext);
        reasoningRef.current = reasonNext;
        const nextName = name || DEFAULT_NAME;
        displayNameRef.current = nextName;
        setDisplayNameState(nextName);
        setProviders(nextProviders);
        setActiveProviderIdState(BUILTIN_ID);
        readyRef.current = true;
        setReady(true);
      } catch {
        readyRef.current = true;
        setReady(true);
        toast.error("Не удалось открыть локальную историю");
      }
    })();
    return () => {
      cancelled = true;
      abandonRef.current = true;
      abortRef.current?.abort();
    };
  }, [setMsgs]);

  useEffect(() => {
    if (!ready) return;
    void saveProviders(providers);
    try {
      localStorage.setItem(PREF_PROVIDER, activeProviderId);
      localStorage.setItem(PREF_NAME, displayName);
      localStorage.setItem(PREF_THEME, theme);
      localStorage.setItem(PREF_PAPER, paper);
      localStorage.setItem(PREF_FACE, face);
      localStorage.setItem(PREF_SEARCH, searchEngine);
      localStorage.setItem(PREF_REASON, reasoning ? "1" : "0");
      if (activeChatId) localStorage.setItem(PREF_CHAT, activeChatId);
      else localStorage.removeItem(PREF_CHAT);
    } catch {
      /* private mode */
    }
  }, [ready, providers, activeProviderId, displayName, theme, paper, face, searchEngine, reasoning, activeChatId]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const apply = (rows: { name: string; displayName: string; prompt?: string; icon?: string }[]) => {
      if (cancelled || rows.length === 0) return;
      const models = rows.map((row) => row.name);
      setModelLabels(Object.fromEntries(rows.map((row) => [row.name, row.displayName || row.name])));
      setModelIcons(Object.fromEntries(rows.map((row) => [row.name, row.icon || ""])));
      setModelPrompts(Object.fromEntries(rows.map((row) => [row.name, (row.prompt || "").trim()])));
      setProviders((current) => {
        const builtin = current.find((item) => item.kind === "builtin");
        if (!builtin) return current;
        const same =
          builtin.models.length === models.length && builtin.models.every((name, index) => name === models[index]);
        const model = models.includes(builtin.model) ? builtin.model : models[0] || "";
        if (same && model === builtin.model) return current;
        return current.map((item) => (item.kind === "builtin" ? { ...item, models, model } : item));
      });
    };
    const pull = () => {
      void listModels()
        .then(apply)
        .catch(() => undefined);
    };
    const pullImages = () => {
      void listImageModels()
        .then((rows) => {
          if (!cancelled) setImageModels(rows);
        })
        .catch(() => undefined);
    };
    pull();
    pullImages();
    const timer = window.setInterval(() => {
      pull();
      pullImages();
    }, 20_000);
    window.addEventListener("focus", pull);
    window.addEventListener("vvvion-models", pull);
    window.addEventListener("vvvion-image-models", pullImages);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", pull);
      window.removeEventListener("vvvion-models", pull);
      window.removeEventListener("vvvion-image-models", pullImages);
    };
  }, [ready]);

  useEffect(() => {
    imageModelsRef.current = imageModels;
  }, [imageModels]);

  useEffect(() => {
    modelLabelsRef.current = modelLabels;
  }, [modelLabels]);

  useEffect(() => {
    modelPromptsRef.current = modelPrompts;
  }, [modelPrompts]);

  const activeProvider =
    providers.find((item) => item.id === activeProviderId) ?? providers[0] ?? builtinProvider();

  const setTheme = useCallback((next: ThemeMode) => {
    setThemeState(next);
    applyTheme(next);
  }, []);

  const setPaper = useCallback((next: PaperId) => {
    setPaperState(next);
    applyPaper(next);
  }, []);

  const setFace = useCallback((next: FaceVariant) => {
    setFaceState(next);
  }, []);

  const setSearchEngine = useCallback((next: SearchEngine) => {
    searchEngineRef.current = next;
    setSearchEngineState(next);
  }, []);

  const setReasoning = useCallback((next: boolean) => {
    reasoningRef.current = next;
    setReasoningState(next);
  }, []);

  const setDisplayName = useCallback((value: string) => {
    const next = value.slice(0, 32);
    displayNameRef.current = next;
    setDisplayNameState(next);
  }, []);

  const setActiveProviderId = useCallback((id: string) => {
    setActiveProviderIdState(id);
  }, []);

  const updateProvider = useCallback((id: string, patch: Partial<Provider>) => {
    setProviders((current) =>
      current.map((item) => {
        if (item.id !== id) return item;
        const next = { ...item, ...patch };
        if (item.kind === "builtin") {
          next.kind = "builtin";
          next.apiKey = "";
          next.baseUrl = builtinProvider().baseUrl;
        }
        return next;
      }),
    );
  }, []);

  const addProvider = useCallback(() => {
    const next = blankProvider();
    setProviders((current) => [...current, next]);
    setActiveProviderIdState(next.id);
    return next.id;
  }, []);

  const removeProvider = useCallback((id: string) => {
    setProviders((current) => {
      const next = current.filter((item) => item.id !== id || item.kind === "builtin");
      return next.length ? next : [builtinProvider()];
    });
    setActiveProviderIdState((current) => (current === id ? BUILTIN_ID : current));
  }, []);

  const selectChat = useCallback(
    (id: string) => {
      const chat = chatsRef.current.find((item) => item.id === id);
      if (!chat) return;
      const live = liveRef.current;
      if (live && live.chatId !== id) {
        const current = chatsRef.current.find((item) => item.id === live.chatId);
        if (current && !current.unread) {
          void persistRef.current({ ...current, unread: true, messages: live.messages, updatedAt: Date.now() }, true);
        }
      }
      activeChatRef.current = id;
      setActiveChatIdState(id);
      const messages = live && live.chatId === id ? live.messages : chat.messages;
      messagesRef.current = messages;
      setMessages(messages);
      if (chat.unread) {
        void persistRef.current({ ...chat, unread: false, messages, updatedAt: Date.now() }, true);
      }
      setDraft("");
    },
    [],
  );

  const newChat = useCallback(() => {
    const live = liveRef.current;
    if (live) {
      const current = chatsRef.current.find((item) => item.id === live.chatId);
      if (current) {
        void persistRef.current({ ...current, unread: true, messages: live.messages, updatedAt: Date.now() }, true);
      }
    }
    activeChatRef.current = null;
    setActiveChatIdState(null);
    setMsgs([]);
    setDraft("");
    setAttachments([]);
  }, [setMsgs]);

  const renameChat = useCallback(async (id: string, title: string) => {
    const clean = title.trim().slice(0, 80);
    if (!clean) return;
    const chat = chatsRef.current.find((item) => item.id === id);
    if (!chat) return;
    const next = { ...chat, title: clean };
    setChats((current) => current.map((item) => (item.id === id ? next : item)));
    const access = localChatAccess(readOwner(), userIdRef.current);
    if (access === "drop") return;
    writeOwner(userIdRef.current ?? GUEST_OWNER);
    await saveChat(next);
    if (userIdRef.current) void saveCloudChat({ data: next }).catch(() => undefined);
  }, []);

  const removeChat = useCallback(
    async (id: string) => {
      const chat = chatsRef.current.find((item) => item.id === id);
      if (!chat) return;
      const live = liveRef.current;
      if (live?.chatId === id || detachedRef.current?.chatId === id) {
        stopRef.current = true;
        if (userIdRef.current) await postStop(id).catch(() => undefined);
        abortRef.current?.abort();
        if (detachedRef.current?.chatId === id) {
          detachedRef.current = null;
          setContinuingId(null);
          busyRef.current = false;
          setStreaming(false);
          setStreamId(null);
        }
      }
      const wasActive = activeChatRef.current === id;
      chatsRef.current = chatsRef.current.filter((item) => item.id !== id);
      setChats(chatsRef.current);
      if (wasActive) {
        activeChatRef.current = null;
        setActiveChatIdState(null);
        setMsgs([]);
      }
      let undone = false;
      const timer = window.setTimeout(() => {
        if (undone) return;
        void deleteChat(id);
        if (userIdRef.current) void deleteCloudChat({ data: id }).catch(() => undefined);
      }, 5000);
      toast("Удалено", {
        duration: 5000,
        action: {
          label: "Отменить",
          onClick: () => {
            undone = true;
            window.clearTimeout(timer);
            chatsRef.current = [chat, ...chatsRef.current.filter((item) => item.id !== chat.id)];
            setChats(chatsRef.current);
            if (wasActive) {
              activeChatRef.current = chat.id;
              setActiveChatIdState(chat.id);
              setMsgs(chat.messages);
            }
          },
        },
      });
    },
    [setMsgs],
  );

  const removeAllChats = useCallback(async () => {
    wipeEpoch.current += 1;
    const epoch = wipeEpoch.current;
    const running = liveRef.current?.chatId || detachedRef.current?.chatId;
    stopRef.current = true;
    abortRef.current?.abort();
    liveRef.current = null;
    detachedRef.current = null;
    setContinuingId(null);
    busyRef.current = false;
    setStreaming(false);
    setStreamId(null);
    chatsRef.current = [];
    setChats([]);
    activeChatRef.current = null;
    setActiveChatIdState(null);
    setMsgs([]);
    try {
      localStorage.removeItem(PREF_CHAT);
    } catch {
      /* private mode */
    }
    await clearChats().catch(() => undefined);
    if (wipeEpoch.current !== epoch) return;
    if (running && userIdRef.current) await postStop(running).catch(() => undefined);
    if (wipeEpoch.current !== epoch || !userIdRef.current) return;
    await deleteAllCloudChats().catch(() => undefined);
  }, [setMsgs]);

  const persistChat = useCallback(async (chat: Chat, cloudNow = false) => {
    const epoch = wipeEpoch.current;
    const rest = chatsRef.current.filter((item) => item.id !== chat.id);
    const next = [chat, ...rest].sort((a, b) => b.updatedAt - a.updatedAt);
    if (wipeEpoch.current !== epoch) return;
    chatsRef.current = next;
    setChats(next);
    const access = localChatAccess(readOwner(), userIdRef.current);
    if (access === "drop") return;
    writeOwner(userIdRef.current ?? GUEST_OWNER);
    await saveChat(chat);
    if (wipeEpoch.current !== epoch) {
      await deleteChat(chat.id).catch(() => undefined);
      return;
    }
    if (!userIdRef.current || !cloudNow) return;
    await saveCloudChat({ data: chat }).catch(() => undefined);
    if (wipeEpoch.current !== epoch) await deleteCloudChat({ data: chat.id }).catch(() => undefined);
  }, []);
  persistRef.current = persistChat;

  const send = useCallback(
    async (text: string, opts?: { history?: ChatMessage[]; reuseUser?: ChatMessage; image?: boolean; web?: boolean; ask?: boolean }) => {
      const trimmed = text.trim();
      const pending = opts?.reuseUser ? opts.reuseUser.files ?? [] : attachmentsRef.current;
      if (busyRef.current) {
        const other = chatsRef.current.find((item) => item.id === streamingIdRef.current);
        const name = other?.title?.trim() || "другом";
        toast(`Ответ ещё пишется в чате «${name}»`);
        return;
      }
      if (!trimmed && pending.length === 0) return;
      const wantImage = Boolean(opts?.reuseUser?.image || opts?.image);
      const wantWeb = Boolean(opts?.reuseUser?.web || opts?.web) && !wantImage;
      const wantAsk = Boolean(opts?.ask ?? opts?.reuseUser?.ask) && !wantImage;
      if (wantImage && !trimmed) {
        toast.error("Опишите картинку");
        return;
      }
      const providerEarly =
        providersRef.current.find((item) => item.id === activeProviderId) ?? providersRef.current[0];
      if (
        !userIdRef.current &&
        providerEarly?.kind !== "custom" &&
        guestLeftRef.current !== null &&
        guestLeftRef.current <= 0
      ) {
        setNeedAccount(true);
        toast(ACCOUNT_REQUIRED_MESSAGE);
        return;
      }
      busyRef.current = true;
      stopRef.current = false;
      abandonRef.current = false;
      let streamingStarted = false;
      try {
      const provider =
        providersRef.current.find((item) => item.id === activeProviderId) ?? providersRef.current[0];
      if (!provider) return;
      if (provider.kind === "custom") {
        if (!provider.baseUrl.trim()) {
          toast.error("Укажите Base URL в настройках");
          return;
        }
        if (!provider.apiKey.trim()) {
          toast.error("Добавьте API-ключ в настройках");
          return;
        }
        if (!wantImage && !provider.model.trim()) {
          toast.error("Выберите или добавьте модель");
          return;
        }
      }

      const imageChoice =
        provider.kind === "builtin"
          ? provider.imageModel || imageModelsRef.current[0]?.name || "grok-imagine-image"
          : provider.imageModel || "dall-e-3";
      const apiModel = wantImage ? imageChoice : provider.model;
      const imageLabel = imageModelsRef.current.find((item) => item.name === imageChoice)?.displayName;
      const modelLabel = (wantImage ? imageLabel : modelLabelsRef.current[provider.model])?.trim();
      const catalogPrompt = provider.kind === "builtin" ? (modelPromptsRef.current[provider.model] || "").trim() : "";
      const history = opts?.history ?? messagesRef.current;
      const now = Date.now();
      const shownName = (displayNameRef.current || "").replace(/[\r\n]+/g, " ").trim().slice(0, 32) || DEFAULT_NAME;
      const userMsg: ChatMessage = opts?.reuseUser ?? {
        id: crypto.randomUUID(),
        role: "user",
        content: trimmed,
        createdAt: now,
        image: wantImage || undefined,
        web: wantWeb || undefined,
        ask: wantAsk || undefined,
        files: pending.length ? pending : undefined,
      };
      const asstId = crypto.randomUUID();
      const asst: ChatMessage = {
        id: asstId,
        role: "assistant",
        content: "",
        createdAt: now + 1,
        model: apiModel,
        modelLabel: modelLabel || undefined,
        providerName: shownName,
        image: wantImage || undefined,
        web: wantWeb || undefined,
      };
      const existing = activeChatRef.current
        ? chatsRef.current.find((item) => item.id === activeChatRef.current)
        : undefined;
      const chatId = existing?.id ?? crypto.randomUUID();
      const nextMessages = [...history, userMsg, asst];
      activeChatRef.current = chatId;
      setActiveChatIdState(chatId);
      setMsgs(nextMessages);
      setDraft("");
      if (!opts?.reuseUser) setAttachments([]);
      setStreaming(true);
      setStreamId(chatId);
      haptic("medium");

      const chatBase: Chat = {
        id: chatId,
        title: existing?.title ?? makeTitle(userMsg.content || userMsg.files?.[0]?.name || ""),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        messages: nextMessages,
        unread: false,
      };
      liveRef.current = { chatId, asstId, base: chatBase, messages: nextMessages };
      await persistChat(chatBase, true);
      streamingStarted = true;

      const controller = new AbortController();
      abortRef.current = controller;
      let acc = "";
      let reason = "";
      let usage: Usage | undefined;
      let error: string | undefined;
      let stopped = false;
      let truncated = false;
      let imageUrl: string | undefined;
      let sources: ChatMessage["sources"];
      let raf = 0;
      let lastSave = 0;
      let slow = 0;
      let lastPaint = 0;

      const paint = (forceSave: boolean) => {
        const live = liveRef.current;
        if (!live || live.chatId !== chatId) return;
        if (!chatsRef.current.some((item) => item.id === chatId)) return;
        const updated = live.messages.map((item) =>
          item.id === asstId
            ? {
                ...item,
                content: acc,
                reasoning: reason || undefined,
                usage,
                error,
                stopped: stopped || undefined,
                truncated: truncated || undefined,
                imageUrl,
                sources,
              }
            : item,
        );
        live.messages = updated;
        const away = activeChatRef.current !== chatId || document.visibilityState === "hidden";
        const snapshot: Chat = { ...live.base, updatedAt: Date.now(), messages: updated, unread: away };
        if (activeChatRef.current === chatId) {
          messagesRef.current = updated;
          setMessages(updated);
        }
        if (forceSave || Date.now() - lastSave > 1200) {
          lastSave = Date.now();
          void persistChat(snapshot, forceSave);
          return;
        }
        const rest = chatsRef.current.filter((item) => item.id !== snapshot.id);
        const listed = [snapshot, ...rest].sort((a, b) => b.updatedAt - a.updatedAt);
        chatsRef.current = listed;
        setChats(listed);
      };

      const schedule = () => {
        const low = document.documentElement.classList.contains("vv-lowend");
        if (low) {
          if (slow) return;
          const wait = Math.max(0, 120 - (Date.now() - lastPaint));
          slow = window.setTimeout(() => {
            slow = 0;
            lastPaint = Date.now();
            paint(false);
          }, wait);
          return;
        }
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          paint(false);
        });
      };

      let left = false;
      let detached = false;
      try {
        await streamChat(
          {
            kind: provider.kind,
            baseUrl: provider.baseUrl,
            apiKey: provider.kind === "custom" ? provider.apiKey : "",
            extraHeaders: provider.extraHeaders.map(({ name, value }) => ({ name, value })),
            chatPath: provider.chatPath,
            model: provider.model || "grok-4.5",
            imageModel: imageChoice,
            systemPrompt: catalogPrompt ? "" : provider.systemPrompt,
            toolNote: [
              pluginNote({ calc: false, clock: false, brief: false, translate: false, ask: wantAsk }, trimmed),
              shownName.toLowerCase() === DEFAULT_NAME ? "" : `Тебя зовут «${shownName}». Если спрашивают, как тебя зовут, отвечай этим именем.`,
            ].filter(Boolean).join("\n\n"),
            personaId: readLivePersona() || undefined,
            temperature: provider.temperature,
            maxTokens: provider.maxTokens,
            mode: wantImage ? "image" : "chat",
            webSearch: wantWeb,
            searchEngine: searchEngineRef.current,
            reasoning: reasoningRef.current,
            track: userIdRef.current ? { chatId, messageId: asstId } : undefined,
            mcp: wantImage ? undefined : enabledMcpUrls(),
            messages: wireTurns(nextMessages.filter((item) => item.id !== asstId).slice(-32)),
          },
          {
            signal: controller.signal,
            onDelta(chunk) {
              acc += chunk;
              schedule();
            },
            onReason(chunk) {
              if (reason.length < 20_000) reason = (reason + chunk).slice(0, 20_000);
              schedule();
            },
            onUsage(next) {
              usage = next;
            },
            onLimit(remainingPct) {
              noteLimit(remainingPct);
            },
            onMeta(meta) {
              if (meta.truncated) truncated = true;
            },
            onError(message) {
              error = message;
            },
            onImage(url) {
              imageUrl = url;
              schedule();
            },
            onSources(next) {
              sources = next.slice(0, 6);
              schedule();
            },
          },
        );
      } catch (err) {
        if (controller.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) {
          if (stopRef.current) stopped = true;
          else if (abandonRef.current) left = true;
          else stopped = true;
        } else if (userIdRef.current && isNetworkDrop(err)) {
          detached = true;
        } else {
          error = err instanceof Error ? err.message : "Не удалось получить ответ";
        }
        if (error === ACCOUNT_REQUIRED_MESSAGE) {
          guestLeftRef.current = 0;
          setGuestLeft(0);
          setNeedAccount(true);
        }
      } finally {
        if (raf) cancelAnimationFrame(raf);
        if (slow) window.clearTimeout(slow);
        if (detached) {
          const have = chatsRef.current.find((item) => item.id === chatId);
          const current = have?.messages.find((item) => item.id === asstId);
          detachedRef.current = {
            chatId,
            asstId,
            until: Date.now() + 240_000,
            startedAt: have?.updatedAt ?? 0,
            seen: current?.content.length ?? acc.length,
          };
          setContinuingId(chatId);
          if (liveRef.current?.chatId === chatId) liveRef.current = null;
          abortRef.current = null;
          toast("Ответ допишется сам. Экран можно выключить.");
          pullRef.current();
        } else {
        const skip = left && Boolean(userIdRef.current);
        if (!skip) {
          if (!acc.trim() && !reason.trim() && !imageUrl && !error && !stopped) {
            error = wantImage ? "Картинка не пришла. Попробуйте ещё раз." : "Модель ничего не ответила. Попробуйте ещё раз.";
          }
          paint(true);
          if (document.visibilityState === "visible" && !stopped && !left) {
            if (error && !acc.trim() && !imageUrl) haptic("error");
            else if (acc.trim() || imageUrl) haptic("success");
          }
        }
        if (liveRef.current?.chatId === chatId) liveRef.current = null;
        abortRef.current = null;
        busyRef.current = false;
        stopRef.current = false;
        setStreaming(false);
        setStreamId(null);
        if (isApp() && document.hidden && !stopped && !left) {
          appNotify({
            id: `ai:${chatId}:${asstId}`,
            channel: "ai",
            title: (modelLabel || "Чат с ИИ").slice(0, 80),
            body: "Ответ готов",
            url: `/?chat=${chatId}`,
          });
        }
        if (!userIdRef.current) {
          void fetch("/api/chat", { method: "GET", credentials: "same-origin" })
            .then((res) => res.json())
            .then((data: { limited?: boolean; remaining?: number | null }) => {
              if (!data.limited || typeof data.remaining !== "number") return;
              guestLeftRef.current = data.remaining;
              setGuestLeft(data.remaining);
              if (data.remaining <= 0) setNeedAccount(true);
            })
            .catch(() => undefined);
        }
        }
      }
      } catch (err) {
        if (!streamingStarted) {
          setStreaming(false);
          setStreamId(null);
          liveRef.current = null;
          toast.error(err instanceof Error ? err.message : "Не удалось отправить");
          haptic("error");
        }
      } finally {
        if (!streamingStarted) busyRef.current = false;
      }
    },
    [activeProviderId, persistChat, setMsgs],
  );

  const stop = useCallback(() => {
    const watch = detachedRef.current;
    if (watch) {
      detachedRef.current = null;
      setContinuingId(null);
      stopRef.current = true;
      if (userIdRef.current) void postStop(watch.chatId).catch(() => undefined);
      busyRef.current = false;
      setStreaming(false);
      setStreamId(null);
    }
    const live = liveRef.current;
    if (!live) {
      abortRef.current?.abort();
      return;
    }
    stopRef.current = true;
    const chatId = live.chatId;
    void (async () => {
      if (userIdRef.current) await postStop(chatId).catch(() => undefined);
      abortRef.current?.abort();
    })();
  }, []);

  const regenerate = useCallback(
    (messageId?: string) => {
      const current = messagesRef.current;
      if (!messageId) {
        let history = current;
        if (history.at(-1)?.role === "assistant") history = history.slice(0, -1);
        const last = history.at(-1);
        if (!last || last.role !== "user") return;
        void send(last.content, { history: history.slice(0, -1), reuseUser: last, image: last.image, web: last.web, ask: last.ask });
        return;
      }
      const index = current.findIndex((item) => item.id === messageId);
      if (index < 0) return;
      let userIndex = current[index]?.role === "user" ? index : index - 1;
      while (userIndex >= 0 && current[userIndex]?.role !== "user") userIndex -= 1;
      const last = current[userIndex];
      if (!last || last.role !== "user") return;
      void send(last.content, { history: current.slice(0, userIndex), reuseUser: last, image: last.image, web: last.web, ask: last.ask });
    },
    [send],
  );

  const dropMessage = useCallback(
    (messageId: string) => {
      if (busyRef.current) {
        toast("Сначала дождитесь ответа");
        return;
      }
      const list = messagesRef.current;
      const index = list.findIndex((item) => item.id === messageId);
      if (index < 0) return;
      haptic("heavy");
      let end = index + 1;
      if (list[index]?.role === "user") {
        while (end < list.length && list[end]?.role === "assistant") end += 1;
      }
      const removed = list.slice(index, end);
      const next = [...list.slice(0, index), ...list.slice(end)];
      setMsgs(next);
      const id = activeChatRef.current;
      const chat = id ? chatsRef.current.find((item) => item.id === id) : undefined;
      if (!chat || !id) return;
      void persistChat({ ...chat, messages: next, updatedAt: Date.now() }, true);
      let undone = false;
      toast("Удалено", {
        duration: 5000,
        action: {
          label: "Отменить",
          onClick: () => {
            if (undone) return;
            undone = true;
            const current = chatsRef.current.find((item) => item.id === id);
            if (!current) return;
            const same = current.messages.length === next.length && current.messages.every((item, at) => item.id === next[at]?.id);
            if (!same) return;
            const restored = [...current.messages.slice(0, index), ...removed, ...current.messages.slice(index)];
            if (activeChatRef.current === id) setMsgs(restored);
            void persistChat({ ...current, messages: restored, updatedAt: Date.now() }, true);
          },
        },
      });
    },
    [persistChat, setMsgs],
  );

  const resendFrom = useCallback(
    (messageId: string, nextText: string) => {
      const index = messagesRef.current.findIndex((item) => item.id === messageId);
      if (index < 0) return;
      void send(nextText, {
        history: messagesRef.current.slice(0, index),
        image: messagesRef.current[index]?.image,
        web: messagesRef.current[index]?.web,
        ask: messagesRef.current[index]?.ask,
      });
    },
    [send],
  );

  useEffect(() => {
    if (isPending) return;
    if (user) {
      setNeedAccount(false);
      setGuestLeft(null);
      guestLeftRef.current = null;
      return;
    }
    let cancelled = false;
    void fetch("/api/chat", { method: "GET", credentials: "same-origin" })
      .then((res) => res.json())
      .then((data: { limited?: boolean; remaining?: number | null }) => {
        if (cancelled || !data.limited || typeof data.remaining !== "number") return;
        guestLeftRef.current = data.remaining;
        setGuestLeft(data.remaining);
        if (data.remaining <= 0) setNeedAccount(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isPending, user]);

  useEffect(() => {
    if (!ready || isPending) return;
    let cancelled = false;
    const userId = user?.id ?? null;
    void (async () => {
      const epoch = wipeEpoch.current;
      const access = localChatAccess(readOwner(), userId);
      if (access === "drop") {
        await clearChats().catch(() => undefined);
        writeOwner(userId ?? GUEST_OWNER);
        try {
          localStorage.removeItem(PREF_CHAT);
        } catch {
          /* private mode */
        }
        if (cancelled) return;
        chatsRef.current = [];
        setChats([]);
        activeChatRef.current = null;
        setActiveChatIdState(null);
        setMsgs([]);
      } else if (userId) {
        writeOwner(userId);
      }
      if (cancelled) return;
      const local = access === "drop" ? [] : await loadChats().catch(() => [] as Chat[]);
      if (cancelled || wipeEpoch.current !== epoch) return;
      if (!userId) {
        chatsRef.current = local;
        setChats(local);
        let preferred: string | null = null;
        try {
          preferred = localStorage.getItem(PREF_CHAT);
        } catch {
          preferred = null;
        }
        const open = local.find((item) => item.id === preferred) ?? null;
        if (open && messagesRef.current.length === 0 && !activeChatRef.current) {
          const shown = open.unread ? { ...open, unread: false, updatedAt: Date.now() } : open;
          activeChatRef.current = shown.id;
          setActiveChatIdState(shown.id);
          setMsgs(shown.messages);
          if (open.unread) {
            const cleared = local.map((item) => (item.id === shown.id ? shown : item));
            chatsRef.current = cleared;
            setChats(cleared);
            void saveChat(shown);
          }
        }
        return;
      }
      let remote: Chat[] = [];
      try {
        remote = await listCloudChats();
      } catch {
        if (!cancelled) toast.error("Не удалось загрузить историю аккаунта");
        remote = [];
      }
      if (cancelled || wipeEpoch.current !== epoch) return;
      const map = new Map(local.map((item) => [item.id, item]));
      for (const chat of remote) {
        const have = map.get(chat.id);
        if (!have || chat.updatedAt > have.updatedAt || isDropError(lastAssistant(have)?.error)) {
          map.set(chat.id, chat);
          void saveChat(chat);
        }
      }
      const uploads: Chat[] = [];
      if (access !== "drop") {
        for (const chat of map.values()) {
          const fromServer = remote.find((item) => item.id === chat.id);
          if (isDropError(lastAssistant(chat)?.error)) continue;
          if (!fromServer || chat.updatedAt > fromServer.updatedAt) uploads.push(chat);
        }
      }
      const next = [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt);
      chatsRef.current = next;
      setChats(next);
      let preferred: string | null = null;
      try {
        preferred = localStorage.getItem(PREF_CHAT);
      } catch {
        preferred = null;
      }
      const openId = next.some((item) => item.id === preferred) ? preferred : next[0]?.id;
      if (!busyRef.current && messagesRef.current.length === 0 && !activeChatRef.current && openId) {
        const open = next.find((item) => item.id === openId);
        if (open) {
          const shown = open.unread ? { ...open, unread: false, updatedAt: Date.now() } : open;
          activeChatRef.current = shown.id;
          setActiveChatIdState(shown.id);
          setMsgs(shown.messages);
          if (open.unread) {
            const cleared = next.map((item) => (item.id === shown.id ? shown : item));
            chatsRef.current = cleared;
            setChats(cleared);
            void saveChat(shown);
            void saveCloudChat({ data: shown }).catch(() => undefined);
          }
        }
      }
      if (access === "drop") return;
      const pending = next.find((chat) => {
        const last = chat.messages.at(-1);
        if (!last || last.role !== "assistant") return false;
        if (Date.now() - chat.updatedAt > 5 * 60 * 1000) return false;
        if (last.live) return true;
        if (last.content.trim() || last.error || last.imageUrl || last.stopped) return false;
        return true;
      });
      if (pending && !busyRef.current) {
        const last = pending.messages.at(-1);
        if (last) {
          detachedRef.current = {
            chatId: pending.id,
            asstId: last.id,
            until: Date.now() + 240_000,
            startedAt: pending.updatedAt,
            seen: last.content.length,
          };
          setContinuingId(pending.id);
          setStreaming(true);
          setStreamId(pending.id);
          busyRef.current = true;
        }
      }
      for (const chat of uploads) {
        if (cancelled) return;
        void saveCloudChat({ data: chat }).catch(() => undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, isPending, user?.id, setMsgs]);

  useEffect(() => {
    if (!ready || isPending || !user?.id) return;
    let cancelled = false;
    const pull = () => {
      if (cancelled || !userIdRef.current) return;
      if (document.visibilityState === "hidden" && !detachedRef.current) return;
      const epoch = wipeEpoch.current;
      void listCloudChats()
        .then((remote) => {
          if (cancelled || epoch !== wipeEpoch.current) return;
          const liveId = liveRef.current?.chatId ?? null;
          const watch = detachedRef.current;
          const map = new Map(chatsRef.current.map((item) => [item.id, item]));
          let changed = false;
          for (const chat of remote) {
            if (chat.id === liveId) continue;
            const have = map.get(chat.id);
            const replace =
              !have ||
              chat.updatedAt > have.updatedAt ||
              replyRichness(chat) > replyRichness(have) ||
              isDropError(lastAssistant(have)?.error);
            if (!replace) continue;
            map.set(chat.id, chat);
            void saveChat(chat);
            changed = true;
          }
          if (changed) {
            const active = activeChatRef.current;
            const fresh = active && active !== liveId ? map.get(active) : undefined;
            if (fresh && (document.visibilityState === "visible" || watch?.chatId === active)) {
              const shown = fresh.unread ? { ...fresh, unread: false, updatedAt: Date.now() } : fresh;
              map.set(shown.id, shown);
              messagesRef.current = shown.messages;
              setMessages(shown.messages);
              if (fresh.unread) {
                void saveChat(shown);
                void saveCloudChat({ data: shown }).catch(() => undefined);
              }
            }
            const next = [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt);
            chatsRef.current = next;
            setChats(next);
          }
          const currentWatch = detachedRef.current;
          if (!currentWatch) return;
          const found = map.get(currentWatch.chatId);
          if ((found && watchReady(found, currentWatch)) || Date.now() > currentWatch.until) {
            detachedRef.current = null;
            setContinuingId(null);
            busyRef.current = false;
            setStreaming(false);
            setStreamId(null);
            const msg = found?.messages.find((item) => item.id === currentWatch.asstId);
            const arrived = Boolean(msg && !msg.live && (msg.content.trim() || msg.error || msg.imageUrl || msg.stopped));
            if (!arrived) toast("Ответ ещё может дописаться. Если пусто — откройте диалог снова.");
          }
        })
        .catch(() => undefined);
    };
    pullRef.current = pull;
    const onVis = () => {
      const live = liveRef.current;
      if (document.visibilityState === "hidden") {
        if (live) {
          const current = chatsRef.current.find((item) => item.id === live.chatId);
          if (current && !current.unread) {
            void persistRef.current({ ...current, unread: true, messages: live.messages, updatedAt: Date.now() }, false);
          }
        }
        return;
      }
      const active = activeChatRef.current;
      const current = active ? chatsRef.current.find((item) => item.id === active) : undefined;
      if (current?.unread) {
        const messages = live?.chatId === active ? live.messages : current.messages;
        if (live?.chatId === active) {
          messagesRef.current = messages;
          setMessages(messages);
        }
        void persistRef.current({ ...current, unread: false, messages, updatedAt: Date.now() }, true);
      }
      pull();
    };
    window.addEventListener("focus", pull);
    document.addEventListener("visibilitychange", onVis);
    const timer = window.setInterval(pull, 15_000);
    const fast = window.setInterval(() => {
      if (detachedRef.current) pull();
    }, 4_000);
    return () => {
      cancelled = true;
      pullRef.current = () => undefined;
      window.removeEventListener("focus", pull);
      document.removeEventListener("visibilitychange", onVis);
      window.clearInterval(timer);
      window.clearInterval(fast);
    };
  }, [ready, isPending, user?.id]);

  const clearLocal = useCallback(async () => {
    const live = liveRef.current;
    const watch = detachedRef.current;
    if (live || watch) {
      stopRef.current = true;
      if (userIdRef.current) await postStop((live ?? watch)!.chatId).catch(() => undefined);
    }
    detachedRef.current = null;
    setContinuingId(null);
    abortRef.current?.abort();
    await wipeDatabase();
    try {
      for (const key of [PREF_CHAT, PREF_CHAT_OWNER, PREF_NAME, PREF_PROVIDER, PREF_THEME, PREF_PAPER, PREF_FACE, PREF_SEARCH, PREF_REASON]) localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
    const fresh = builtinProvider();
    setProviders([fresh]);
    setActiveProviderIdState(fresh.id);
    setChats([]);
    chatsRef.current = [];
    activeChatRef.current = null;
    setActiveChatIdState(null);
    setMsgs([]);
    setDisplayNameState(DEFAULT_NAME);
    displayNameRef.current = DEFAULT_NAME;
    setTheme("dark");
    setPaper("plain");
    setFace("pebble");
    setSearchEngine("duck");
    setReasoning(true);
    if (userIdRef.current) {
      writeOwner(userIdRef.current);
      const remote = await listCloudChats().catch(() => [] as Chat[]);
      chatsRef.current = remote;
      setChats(remote);
      for (const chat of remote) void saveChat(chat);
      toast("Локальные данные очищены. История аккаунта на месте.");
      return;
    }
    toast("Локальные данные очищены");
  }, [setMsgs, setTheme, setPaper, setFace, setSearchEngine, setReasoning]);

  return {
    ready,
    theme,
    setTheme,
    paper,
    setPaper,
    face,
    setFace,
    searchEngine,
    setSearchEngine,
    reasoning,
    setReasoning,
    displayName,
    setDisplayName,
    providers,
    activeProvider,
    activeProviderId,
    setActiveProviderId,
    updateProvider,
    addProvider,
    removeProvider,
    chats,
    activeChatId,
    messages,
    streaming,
    streamingChatId,
    continuingId,
    draft,
    setDraft,
    guestLeft,
    needAccount,
    imageMode,
    webMode,
    setImageMode: (value: boolean) => {
      setImageMode(value);
      if (value) {
        setWebMode(false);
        setAttachments([]);
      }
    },
    setWebMode: (value: boolean) => {
      setWebMode(value);
      if (value) setImageMode(false);
    },
    askMode,
    setAskMode: (value: boolean) => {
      setAskMode(value);
      localStorage.setItem("vvvion.plugin.ask", value ? "1" : "0");
    },
    attachments,
    setAttachments,
    modelLabels,
    modelIcons,
    modelPrompts,
    imageModels,
    send,
    stop,
    regenerate,
    dropMessage,
    resendFrom,
    selectChat,
    newChat,
    renameChat,
    removeChat,
    removeAllChats,
    clearLocal,
  };
}
