import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import type { Chat, ChatFile, ChatMessage, Source } from "@/lib/ai/types";
import { isDiskPath } from "@/lib/social/disk-path";

const MAX_CHATS = 80;
const MAX_MESSAGES = 80;
const MAX_CONTENT = 1_000_000;

function keepImageUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (isDiskPath(value)) return value;
  if (value.startsWith("data:image/") && value.length > 32 && value.length < 2_400_000) return value;
  if (value.startsWith("https://") && value.length <= 8000) return value;
  return undefined;
}

function asId(value: unknown): string {
  if (typeof value !== "string") throw new Error("Диалог не найден");
  const id = value.trim();
  if (!/^[A-Za-z0-9-]{8,80}$/.test(id)) throw new Error("Диалог не найден");
  return id;
}

function asMessage(value: unknown): ChatMessage | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<ChatMessage>;
  if (raw.role !== "user" && raw.role !== "assistant") return null;
  if (typeof raw.id !== "string" || !raw.id.trim()) return null;
  const content = typeof raw.content === "string" ? raw.content.slice(0, MAX_CONTENT) : "";
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
  if (typeof raw.error === "string") message.error = raw.error.slice(0, 500);
  if (raw.stopped) message.stopped = true;
  if (raw.truncated) message.truncated = true;
  if (raw.live) message.live = true;
  if (typeof raw.sync === "number" && Number.isFinite(raw.sync)) message.sync = raw.sync;
  if (raw.image) message.image = true;
  if (raw.web) message.web = true;
  if (raw.calc) message.calc = true;
  if (raw.clock) message.clock = true;
  if (raw.brief) message.brief = true;
  if (raw.translate) message.translate = true;
  const imageUrl = keepImageUrl(raw.imageUrl);
  if (imageUrl) message.imageUrl = imageUrl;
  if (Array.isArray(raw.sources)) {
    const sources = raw.sources.slice(0, 6).flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const source = item as Partial<Source>;
      const title = typeof source.title === "string" ? source.title.slice(0, 160) : "";
      const url = typeof source.url === "string" ? source.url.slice(0, 500) : "";
      const snippet = typeof source.snippet === "string" ? source.snippet.slice(0, 300) : "";
      if (!title || !/^https?:\/\//.test(url)) return [];
      return [{ title, url, snippet }];
    });
    if (sources.length) message.sources = sources;
  }
  if (Array.isArray(raw.files)) {
    const files = raw.files.slice(0, 8).flatMap((item) => {
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
      if (typeof file.size === "number" && Number.isFinite(file.size)) next.size = Math.round(file.size);
      if (typeof file.url === "string" && (isDiskPath(file.url) || file.url.startsWith("/api/circle-file/"))) next.url = file.url.slice(0, 180);
      if (typeof file.text === "string" && file.text) next.text = file.text.slice(0, 8_000);
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
  if (raw.usage && typeof raw.usage === "object") {
    const usage = raw.usage as ChatMessage["usage"];
    message.usage = {
      prompt_tokens: typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : undefined,
      completion_tokens: typeof usage?.completion_tokens === "number" ? usage.completion_tokens : undefined,
      total_tokens: typeof usage?.total_tokens === "number" ? usage.total_tokens : undefined,
      reasoning_tokens: typeof usage?.reasoning_tokens === "number" ? usage.reasoning_tokens : undefined,
    };
  }
  if (typeof raw.reasoning === "string" && raw.reasoning.trim()) {
    message.reasoning = raw.reasoning.trim().slice(0, 24_000);
  }
  return message;
}

function asChat(value: unknown): Chat {
  if (!value || typeof value !== "object") throw new Error("Не удалось сохранить диалог");
  const raw = value as Partial<Chat>;
  const id = asId(raw.id);
  const title = typeof raw.title === "string" && raw.title.trim() ? raw.title.trim().slice(0, 80) : "Новый диалог";
  const createdAt =
    typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now();
  const updatedAt =
    typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt) ? raw.updatedAt : createdAt;
  const messages = Array.isArray(raw.messages)
    ? raw.messages.map(asMessage).filter((item): item is ChatMessage => item !== null).slice(-MAX_MESSAGES)
    : [];
  return { id, title, createdAt, updatedAt, messages, unread: raw.unread === true };
}

function parseMessages(value: unknown): ChatMessage[] {
  const source = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (!Array.isArray(source)) return [];
  return source.map(asMessage).filter((item): item is ChatMessage => item !== null);
}

async function readChats(userId: string): Promise<Chat[]> {
  const sql = await getSql();
  const rows = await sql<{
    id: string;
    title: string;
    messages: unknown;
    unread: boolean | null;
    created_ms: number | string;
    updated_ms: number | string;
  }>`
    select id,
           title,
           messages,
           unread,
           (extract(epoch from created_at) * 1000) as created_ms,
           (extract(epoch from updated_at) * 1000) as updated_ms
    from saved_chats
    where user_id = ${userId}
    order by updated_at desc
    limit ${MAX_CHATS}
  `;
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: Math.round(Number(row.created_ms)),
    updatedAt: Math.round(Number(row.updated_ms)),
    messages: parseMessages(row.messages),
    unread: row.unread === true,
  }));
}

export const listCloudChats = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<Chat[]> => readChats(context.userId));

export const saveCloudChat = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(asChat)
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const sql = await getSql();
    const messages = JSON.stringify(data.messages);
    const stored = await sql<{ messages: unknown }>`
      select messages from saved_chats where id = ${data.id} and user_id = ${context.userId}
    `;
    const previous = stored[0] ? parseMessages(stored[0].messages) : [];
    const prevReply = [...previous].reverse().find((item) => item.role === "assistant");
    const nextReply = [...data.messages].reverse().find((item) => item.role === "assistant");
    const keepStored =
      prevReply &&
      nextReply &&
      prevReply.id === nextReply.id &&
      prevReply.content.length > nextReply.content.length &&
      !nextReply.stopped;
    const savedMessages = keepStored ? JSON.stringify(previous) : messages;
    await sql`
      insert into saved_chats (id, user_id, title, messages, unread, created_at, updated_at)
      values (
        ${data.id},
        ${context.userId},
        ${data.title},
        ${savedMessages}::jsonb,
        ${data.unread === true},
        to_timestamp(${data.createdAt} / 1000.0),
        to_timestamp(${data.updatedAt} / 1000.0)
      )
      on conflict (id) do update
        set title = excluded.title,
            messages = excluded.messages,
            unread = excluded.unread,
            updated_at = case when ${keepStored} then saved_chats.updated_at else excluded.updated_at end
        where saved_chats.user_id = excluded.user_id
    `;
    await sql`
      delete from saved_chats
      where user_id = ${context.userId}
        and id not in (
          select id from saved_chats
          where user_id = ${context.userId}
          order by updated_at desc
          limit ${MAX_CHATS}
        )
    `;
    return { ok: true };
  });

export const deleteCloudChat = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(asId)
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const sql = await getSql();
    await sql`
      delete from saved_chats where id = ${data} and user_id = ${context.userId}
    `;
    return { ok: true };
  });

export const deleteAllCloudChats = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(() => true)
  .handler(async ({ context }): Promise<{ ok: true }> => {
    const sql = await getSql();
    await sql`delete from saved_chats where user_id = ${context.userId}`;
    return { ok: true };
  });

export async function finishCloudReply(
  userId: string,
  chatId: string,
  messageId: string,
  patch: { content: string; reasoning?: string; error?: string; imageUrl?: string; truncated?: boolean; live?: boolean; sync?: number; unread?: boolean; stopped?: boolean },
): Promise<void> {
  if (!/^[A-Za-z0-9-]{8,80}$/.test(chatId) || !/^[A-Za-z0-9-]{8,80}$/.test(messageId)) return;
  const sql = await getSql();
  const rows = await sql<{ messages: unknown }>`
    select messages from saved_chats where id = ${chatId} and user_id = ${userId}
  `;
  const row = rows[0];
  if (!row) return;
  const messages = parseMessages(row.messages);
  const index = messages.findIndex((item) => item.id === messageId);
  const current = messages[index];
  if (!current || current.role !== "assistant") return;
  if (typeof patch.sync === "number" && typeof current.sync === "number" && patch.sync < current.sync) return;
  const next: ChatMessage = { ...current, content: patch.content.slice(0, MAX_CONTENT) };
  if (typeof patch.sync === "number") next.sync = patch.sync;
  if (patch.live) next.live = true;
  else delete next.live;
  if (patch.reasoning?.trim()) next.reasoning = patch.reasoning.trim().slice(0, 24_000);
  else delete next.reasoning;
  if (patch.error?.trim()) next.error = patch.error.trim().slice(0, 500);
  else delete next.error;
  if (patch.truncated) next.truncated = true;
  else delete next.truncated;
  if (patch.stopped) next.stopped = true;
  else delete next.stopped;
  const imageUrl = keepImageUrl(patch.imageUrl);
  if (imageUrl) next.imageUrl = imageUrl;
  messages[index] = next;
  await sql`
    update saved_chats
    set messages = ${JSON.stringify(messages)}::jsonb,
        unread = ${patch.unread !== false},
        updated_at = now()
    where id = ${chatId} and user_id = ${userId}
  `;
}
