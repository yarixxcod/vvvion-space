import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import type { PublicKey } from "@/lib/api/keys";
import { settingsInput, type ApiSettings } from "@/lib/api/settings";
import { assertAdmin, loadAccess } from "@/lib/social/access";
import { isPremium } from "@/lib/social/premium";

const MODEL_RE = /^[A-Za-z0-9._:/-]+$/;

function cleanName(name: unknown): string {
  if (typeof name !== "string") throw new Error("Укажите имя ключа");
  const clean = name.trim();
  if (clean.length < 1 || clean.length > 40) throw new Error("Имя ключа: от 1 до 40 символов");
  return clean;
}

async function usageFor(userId: string) {
  const sql = await getSql();
  const rows = await sql<{ requests: number; tokens: number; images: number }>`
    select count(*)::int as requests,
           coalesce(sum(prompt_tokens + completion_tokens), 0)::int as tokens,
           coalesce(sum(images), 0)::int as images
    from api_usage
    where user_id = ${userId} and created_at > now() - interval '24 hours'
  `;
  return {
    requests: Number(rows[0]?.requests ?? 0),
    tokens: Number(rows[0]?.tokens ?? 0),
    images: Number(rows[0]?.images ?? 0),
  };
}

export const getApiEntry = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<{ visible: boolean }> => {
    const access = await loadAccess(context.userId);
    if (access.banned) return { visible: false };
    const { readApiSettings } = await import("@/lib/api/settings.server");
    const settings = await readApiSettings();
    return { visible: settings.enabled || access.role === "admin" };
  });

export type ApiDesk = {
  enabled: boolean;
  admin: boolean;
  premium: boolean;
  limits: { requests: number | null; tokens: number | null; images: number | null; perMinute: number };
  usage: { requests: number; tokens: number; images: number };
  keys: PublicKey[];
  models: { id: string; type: "chat" | "image"; displayName: string }[];
  openaiBase: string;
  anthropicBase: string;
};

export const getApiDesk = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<ApiDesk> => {
    const access = await loadAccess(context.userId);
    if (access.banned) throw new Error("Аккаунт заблокирован");
    const { readApiSettings } = await import("@/lib/api/settings.server");
    const { listKeys } = await import("@/lib/api/keys.server");
    const { listApiModels } = await import("@/lib/api/models.server");
    const settings = await readApiSettings();
    const admin = access.role === "admin";
    if (!settings.enabled && !admin) throw new Error("Сервис API выключен");
    const [premium, keys, usage, models] = await Promise.all([
      isPremium(context.userId),
      listKeys(context.userId),
      usageFor(context.userId),
      listApiModels(),
    ]);
    return {
      enabled: settings.enabled,
      admin,
      premium,
      limits: { requests: settings.dailyRequests, tokens: settings.dailyTokens, images: settings.dailyImages, perMinute: settings.perMinute },
      usage,
      keys,
      models: models.map((model) => ({ id: model.id, type: model.type, displayName: model.displayName })),
      openaiBase: "https://api.vvvion.space/v1",
      anthropicBase: "https://api.vvvion.space",
    };
  });

export const createApiKey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const name = input && typeof input === "object" ? (input as { name?: unknown }).name : "";
    return { name: cleanName(name) };
  })
  .handler(async ({ context, data }) => {
    const { createKey } = await import("@/lib/api/keys.server");
    return createKey(context.userId, data.name);
  });

export const revokeApiKey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const id = input && typeof input === "object" ? (input as { id?: unknown }).id : "";
    if (typeof id !== "string" || !/^[A-Za-z0-9-]{8,80}$/.test(id)) throw new Error("Ключ не найден");
    return { id };
  })
  .handler(async ({ context, data }) => {
    const { revokeKey } = await import("@/lib/api/keys.server");
    const ok = await revokeKey(context.userId, data.id);
    if (!ok) throw new Error("Ключ не найден");
    return { ok: true };
  });

export type ApiAdminModel = { name: string; displayName: string; apiEnabled: boolean; kind: "chat" | "image" };

export type ApiAdminDesk = {
  settings: ApiSettings;
  models: ApiAdminModel[];
  stats: { requests: number; tokens: number; images: number; errors: number; top: { userId: string; requests: number }[] };
};

export const getApiAdmin = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<ApiAdminDesk> => {
    await assertAdmin(context.userId);
    const sql = await getSql();
    const { readApiSettings } = await import("@/lib/api/settings.server");
    const settings = await readApiSettings();
    const chats = await sql<{ name: string; display_name: string | null; api_enabled: boolean }>`
      select name, display_name, api_enabled from catalog_models where lower(name) not like 'service:%' order by name asc
    `;
    const images = await sql<{ name: string; display_name: string | null; api_enabled: boolean }>`
      select name, display_name, api_enabled from image_models order by name asc
    `;
    const totals = await sql<{ requests: number; tokens: number; images: number; errors: number }>`
      select count(*)::int as requests,
             coalesce(sum(prompt_tokens + completion_tokens), 0)::int as tokens,
             coalesce(sum(images), 0)::int as images,
             count(*) filter (where status >= 400)::int as errors
      from api_usage where created_at > now() - interval '24 hours'
    `;
    const top = await sql<{ user_id: string; requests: number }>`
      select user_id, count(*)::int as requests from api_usage
      where created_at > now() - interval '24 hours'
      group by user_id order by requests desc limit 8
    `;
    return {
      settings,
      models: [
        ...chats.map((row) => ({ name: row.name, displayName: row.display_name || row.name, apiEnabled: row.api_enabled !== false, kind: "chat" as const })),
        ...images.map((row) => ({ name: row.name, displayName: row.display_name || row.name, apiEnabled: row.api_enabled !== false, kind: "image" as const })),
      ],
      stats: {
        requests: Number(totals[0]?.requests ?? 0),
        tokens: Number(totals[0]?.tokens ?? 0),
        images: Number(totals[0]?.images ?? 0),
        errors: Number(totals[0]?.errors ?? 0),
        top: top.map((row) => ({ userId: row.user_id, requests: Number(row.requests) })),
      },
    };
  });

export const saveApiAdmin = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => settingsInput(input))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { writeApiSettings } = await import("@/lib/api/settings.server");
    return writeApiSettings(data);
  });

export const setApiModelFlag = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = input && typeof input === "object" ? (input as { name?: unknown; kind?: unknown; enabled?: unknown }) : {};
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    if (name.startsWith("service:") || !MODEL_RE.test(name)) throw new Error("Некорректное имя модели");
    if (raw.kind !== "chat" && raw.kind !== "image") throw new Error("Некорректная модель");
    return { name, kind: raw.kind, enabled: raw.enabled === true };
  })
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const sql = await getSql();
    if (data.kind === "chat") await sql`update catalog_models set api_enabled = ${data.enabled} where name = ${data.name}`;
    else await sql`update image_models set api_enabled = ${data.enabled} where name = ${data.name}`;
    return { ok: true };
  });

export const revokeUserApiKeys = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const id = input && typeof input === "object" ? (input as { userId?: unknown }).userId : "";
    if (typeof id !== "string" || id.trim().length < 4 || id.trim().length > 80) throw new Error("Укажите id пользователя");
    return { userId: id.trim() };
  })
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { revokeAllForUser } = await import("@/lib/api/keys.server");
    const revoked = await revokeAllForUser(data.userId);
    return { revoked };
  });
