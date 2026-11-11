import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { ChatFile, ChatMessage, Source } from "@/lib/ai/types";
import { getSql } from "@/lib/db";
import { isDiskPath } from "@/lib/social/disk-path";

const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;
const MAX_MESSAGES = 40;
const MAX_JSON = 1_200_000;

export type SharedChat = {
  title: string;
  createdAt: number;
  messages: ChatMessage[];
};

function newToken(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function asPublicMessage(value: unknown): ChatMessage | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<ChatMessage>;
  if (raw.role !== "user" && raw.role !== "assistant") return null;
  if (typeof raw.id !== "string" || !raw.id.trim()) return null;
  const content = typeof raw.content === "string" ? raw.content.slice(0, 200_000) : "";
  const createdAt = typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now();
  const message: ChatMessage = {
    id: raw.id.slice(0, 80),
    role: raw.role,
    content,
    createdAt,
  };
  if (typeof raw.model === "string") message.model = raw.model.slice(0, 80);
  if (typeof raw.modelLabel === "string" && raw.modelLabel.trim()) message.modelLabel = raw.modelLabel.trim().slice(0, 48);
  if (typeof raw.providerName === "string") message.providerName = raw.providerName.slice(0, 48);
  if (typeof raw.error === "string" && raw.error.trim()) message.error = raw.error.trim().slice(0, 300);
  if (raw.stopped) message.stopped = true;
  if (raw.truncated) message.truncated = true;
  if (raw.image) message.image = true;
  if (raw.web) message.web = true;
  if (typeof raw.imageUrl === "string" && (isDiskPath(raw.imageUrl) || (raw.imageUrl.startsWith("https://") && raw.imageUrl.length < 8000))) {
    message.imageUrl = raw.imageUrl;
  }
  if (!message.content && !message.imageUrl && raw.image) message.content = "Картинка";
  if (typeof raw.reasoning === "string" && raw.reasoning.trim()) {
    message.reasoning = raw.reasoning.trim().slice(0, 4_000);
  }
  if (Array.isArray(raw.sources)) {
    const sources = raw.sources.slice(0, 6).flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const source = item as Partial<Source>;
      const title = typeof source.title === "string" ? source.title.slice(0, 160) : "";
      const url = typeof source.url === "string" ? source.url.slice(0, 500) : "";
      const snippet = typeof source.snippet === "string" ? source.snippet.slice(0, 240) : "";
      if (!title || !/^https?:\/\//.test(url)) return [];
      return [{ title, url, snippet }];
    });
    if (sources.length) message.sources = sources;
  }
  if (Array.isArray(raw.files)) {
    const files = raw.files.slice(0, 4).flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const file = item as Partial<ChatFile>;
      const name = typeof file.name === "string" ? file.name.slice(0, 80) : "";
      if (!name || (file.kind !== "image" && file.kind !== "text" && file.kind !== "audio" && file.kind !== "file")) return [];
      const next: ChatFile = {
        id: typeof file.id === "string" ? file.id.slice(0, 80) : name,
        name,
        mime: typeof file.mime === "string" ? file.mime.slice(0, 80) : "",
        kind: file.kind,
      };
      if (typeof file.url === "string" && isDiskPath(file.url)) next.url = file.url;
      if (
        file.kind === "image" &&
        typeof file.dataUrl === "string" &&
        file.dataUrl.startsWith("data:image/") &&
        file.dataUrl.length < 180_000
      ) {
        next.dataUrl = file.dataUrl;
      }
      if (file.kind === "audio" && !next.url) return [];
      return [next];
    });
    if (files.length) message.files = files;
  }
  if (!message.content && !message.imageUrl && !message.files?.length && !message.error) return null;
  return message;
}

function asPublicChat(value: unknown): { title: string; messages: ChatMessage[] } {
  if (!value || typeof value !== "object") throw new Error("Не удалось подготовить диалог");
  const raw = value as { title?: unknown; messages?: unknown };
  const title = typeof raw.title === "string" && raw.title.trim() ? raw.title.trim().slice(0, 80) : "Диалог";
  const messages = Array.isArray(raw.messages)
    ? raw.messages.map(asPublicMessage).filter((item): item is ChatMessage => item !== null).slice(-MAX_MESSAGES)
    : [];
  if (!messages.length) throw new Error("В диалоге пока нечего отправлять");
  if (JSON.stringify(messages).length > MAX_JSON) throw new Error("Диалог слишком большой для ссылки");
  return { title, messages };
}

function parseMessages(value: unknown): ChatMessage[] {
  const source = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (!Array.isArray(source)) return [];
  return source.map(asPublicMessage).filter((item): item is ChatMessage => item !== null);
}

export const publishChat = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(asPublicChat)
  .handler(async ({ context, data }): Promise<{ id: string }> => {
    const sql = await getSql();
    const id = newToken();
    const messages = JSON.stringify(data.messages);
    await sql`
      insert into shared_chats (id, user_id, title, messages)
      values (${id}, ${context.userId}, ${data.title}, ${messages}::jsonb)
    `;
    await sql`
      delete from shared_chats
      where user_id = ${context.userId}
        and id not in (
          select id from shared_chats
          where user_id = ${context.userId}
          order by created_at desc
          limit 40
        )
    `;
    return { id };
  });

export const readSharedChat = createServerFn({ method: "GET" })
  // Public on purpose: the unguessable token is the capability. No other chats or keys are returned.
  .validator((token: unknown): string => (typeof token === "string" && TOKEN.test(token) ? token : ""))
  .handler(async ({ data }): Promise<SharedChat | null> => {
    if (!data) return null;
    const sql = await getSql();
    const rows = await sql<{ title: string; messages: unknown; created_ms: number | string }>`
      select title,
             messages,
             (extract(epoch from created_at) * 1000) as created_ms
      from shared_chats
      where id = ${data}
      limit 1
    `;
    const row = rows[0];
    if (!row) return null;
    const messages = parseMessages(row.messages);
    if (!messages.length) return null;
    return {
      title: row.title,
      createdAt: Math.round(Number(row.created_ms)),
      messages,
    };
  });
