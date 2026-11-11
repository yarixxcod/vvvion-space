import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { assertAdmin } from "@/lib/social/access";

export type TelegramBotState = { configured: boolean; username: string };

export type TelegramLinkState = {
  configured: boolean;
  username: string;
  linked: boolean;
  handle: string;
};

const TOKEN_RE = /^\d{5,16}:[A-Za-z0-9_-]{20,90}$/;

export const getTelegramBot = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<TelegramBotState> => {
    await assertAdmin(context.userId);
    const { readBotPublic } = await import("@/lib/social/telegram.server");
    return readBotPublic();
  });

export const saveTelegramBot = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Вставьте токен от BotFather");
    const token = (input as { token?: unknown }).token;
    if (typeof token !== "string") throw new Error("Вставьте токен от BotFather");
    const trimmed = token.trim();
    if (!TOKEN_RE.test(trimmed)) throw new Error("Токен выглядит не так, как у BotFather");
    return { token: trimmed };
  })
  .handler(async ({ context, data }): Promise<TelegramBotState> => {
    await assertAdmin(context.userId);
    const { connectBot } = await import("@/lib/social/telegram.server");
    const username = await connectBot(data.token);
    return { configured: true, username };
  });

export const clearTelegramBot = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<TelegramBotState> => {
    await assertAdmin(context.userId);
    const { disconnectBot } = await import("@/lib/social/telegram.server");
    await disconnectBot();
    return { configured: false, username: "" };
  });

export const getTelegramLink = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<TelegramLinkState> => {
    const { readLink } = await import("@/lib/social/telegram.server");
    return readLink(context.userId);
  });

export const startTelegramLink = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<{ url: string; username: string }> => {
    const { issueLink } = await import("@/lib/social/telegram.server");
    return issueLink(context.userId);
  });

export const stopTelegramLink = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<{ ok: true }> => {
    const { forgetLink } = await import("@/lib/social/telegram.server");
    await forgetLink(context.userId);
    return { ok: true as const };
  });
