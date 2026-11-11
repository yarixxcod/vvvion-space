import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { assertAdmin, loadAccess, type Access } from "@/lib/social/access";
import { grantPremium, revokePremium } from "@/lib/social/premium";

export type { Access };

export type MemberRow = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: "admin" | "member";
  banned: boolean;
  premiumUntil: string | null;
  createdAt: string;
};

export type PublicModel = { name: string; displayName: string; prompt: string; icon: string };

export type AdminProvider = { baseUrl: string; apiKey: string; model: string };

export type AdminModel = {
  name: string;
  displayName: string;
  icon: string;
  prompt: string;
  providers: AdminProvider[];
};

const MODEL_RE = /^[A-Za-z0-9._:/-]+$/;

function asId(value: unknown): string {
  if (typeof value !== "string") throw new Error("Участник не найден");
  const id = value.trim();
  if (!id || id.length > 128 || /[\s"'<>]/.test(id)) throw new Error("Участник не найден");
  return id;
}

function modelName(value: unknown): string {
  if (typeof value !== "string") throw new Error("Некорректное имя модели");
  const name = value.trim();
  if (!name || name.length > 80 || !MODEL_RE.test(name)) throw new Error("Некорректное имя модели");
  return name;
}

function catalogUrl(value: unknown): string {
  const raw = typeof value === "string" && value.trim() ? value.trim() : "https://api.x.ai/v1";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Эндпойнт должен быть адресом http:// или https://");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Эндпойнт: только http или https");
  if (url.username || url.password) throw new Error("Не кладите ключ в адрес");
  const host = url.hostname.toLowerCase();
  if (host === "metadata.google.internal" || host === "169.254.169.254") throw new Error("Этот адрес недоступен");
  url.search = "";
  url.hash = "";
  const out = url.toString().replace(/\/$/, "");
  if (out.length > 300) throw new Error("Слишком длинный эндпойнт");
  return out;
}

function displayOf(value: unknown, fallback: string): string {
  const name = typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 48) : "";
  return name || fallback;
}

type SaveModelInput = {
  name: string;
  displayName: string;
  icon: string;
  prompt: string;
  providers: AdminProvider[];
  previousName: string;
};

function modelIcon(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  const icon = value.trim();
  if (icon.length > 80_000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(icon)) {
    throw new Error("Иконка не подошла");
  }
  return icon;
}

function publicIcon(value: string | null | undefined): string {
  const icon = (value || "").trim();
  if (!icon || icon.length > 80_000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(icon)) return "";
  return icon;
}

function providersOf(value: unknown): AdminProvider[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) throw new Error("Нужен хотя бы один адрес, не больше четырёх");
  return value.map((item) => {
    if (!item || typeof item !== "object") throw new Error("Некорректный адрес");
    const raw = item as { baseUrl?: unknown; apiKey?: unknown; model?: unknown };
    const apiKey = typeof raw.apiKey === "string" ? raw.apiKey.trim().slice(0, 400) : "";
    if (apiKey && /[\r\n]/.test(apiKey)) throw new Error("Ключ не должен содержать переносы");
    const model = typeof raw.model === "string" ? raw.model.trim().slice(0, 120) : "";
    if (model && !MODEL_RE.test(model)) throw new Error("Некорректное имя модели у провайдера");
    return { baseUrl: catalogUrl(raw.baseUrl), apiKey, model };
  });
}

function saveInput(input: unknown): SaveModelInput {
  if (!input || typeof input !== "object") throw new Error("Некорректная модель");
  const raw = input as Record<string, unknown>;
  const name = modelName(raw.name);
  const previousName = typeof raw.previousName === "string" && raw.previousName.trim() ? modelName(raw.previousName) : "";
  return {
    name,
    displayName: displayOf(raw.displayName, name),
    icon: modelIcon(raw.icon),
    prompt: typeof raw.prompt === "string" ? raw.prompt.trim().slice(0, 4000) : "",
    providers: providersOf(raw.providers),
    previousName,
  };
}

function xaiHost(value: string | null | undefined): boolean {
  const host = (value || "").trim().toLowerCase();
  if (!host) return true;
  try {
    const name = new URL(host.startsWith("http") ? host : `https://${host}`).hostname;
    return name === "api.x.ai" || name.endsWith(".x.ai");
  } catch {
    return false;
  }
}

function usableKey(baseUrl: string | null | undefined, apiKey: string | null | undefined, xaiReady: boolean): boolean {
  if ((apiKey || "").trim()) return true;
  return xaiReady && xaiHost(baseUrl);
}

async function readPublicModels(): Promise<PublicModel[]> {
  const sql = await getSql();
  const xaiReady = Boolean(process.env.XAI_API_KEY?.trim());
  const rows = await sql<{ name: string; display_name: string | null; system_prompt: string | null; icon: string | null; base_url: string | null; api_key: string | null }>`
    select name, display_name, system_prompt, icon, base_url, api_key from catalog_models order by created_at asc, name asc
  `;
  const links = await sql<{ model_name: string; base_url: string | null; api_key: string | null }>`
    select model_name, base_url, api_key from catalog_providers
  `;
  const byName = new Map<string, { baseUrl: string | null; apiKey: string | null }[]>();
  for (const link of links) {
    const list = byName.get(link.model_name) ?? [];
    list.push({ baseUrl: link.base_url, apiKey: link.api_key });
    byName.set(link.model_name, list);
  }
  return rows
    .filter((row) => {
      const stored = byName.get(row.name);
      const list = stored?.length ? stored : [{ baseUrl: row.base_url, apiKey: row.api_key }];
      return list.some((item) => usableKey(item.baseUrl, item.apiKey, xaiReady));
    })
    .map((row) => ({
      name: row.name,
      displayName: row.display_name || row.name,
      prompt: (row.system_prompt || "").trim().slice(0, 4000),
      icon: publicIcon(row.icon),
    }));
}

async function readAdminModels(): Promise<AdminModel[]> {
  const sql = await getSql();
  const rows = await sql<{
    name: string;
    display_name: string | null;
    icon: string | null;
    base_url: string | null;
    api_key: string | null;
    system_prompt: string | null;
  }>`
    select name, display_name, icon, base_url, api_key, system_prompt
    from catalog_models
    order by created_at asc, name asc
  `;
  const links = await sql<{ model_name: string; base_url: string | null; api_key: string | null; model_id: string | null; slot: number | string }>`
    select model_name, base_url, api_key, model_id, slot
    from catalog_providers
    order by slot asc
  `;
  const byName = new Map<string, AdminProvider[]>();
  for (const link of links) {
    const list = byName.get(link.model_name) ?? [];
    list.push({
      baseUrl: link.base_url?.trim() || "https://api.x.ai/v1",
      apiKey: link.api_key || "",
      model: (link.model_id || "").trim(),
    });
    byName.set(link.model_name, list);
  }
  return rows.map((row) => {
    const stored = (byName.get(row.name) ?? []).slice(0, 4);
    return {
      name: row.name,
      displayName: row.display_name || row.name,
      icon: publicIcon(row.icon),
      prompt: row.system_prompt || "",
      providers: stored.length ? stored : [{ baseUrl: row.base_url || "https://api.x.ai/v1", apiKey: row.api_key || "", model: "" }],
    };
  });
}

async function writeProviders(modelName: string, providers: AdminProvider[]) {
  const sql = await getSql();
  await sql`delete from catalog_providers where model_name = ${modelName}`;
  for (let slot = 0; slot < providers.length; slot += 1) {
    const provider = providers[slot];
    await sql`
      insert into catalog_providers (model_name, slot, base_url, api_key, model_id)
      values (${modelName}, ${slot}, ${provider.baseUrl}, ${provider.apiKey}, ${provider.model})
    `;
  }
  const first = providers[0];
  await sql`
    update catalog_models
    set base_url = ${first.baseUrl}, api_key = ${first.apiKey}
    where name = ${modelName}
  `;
}

async function readMembers(): Promise<MemberRow[]> {
  const sql = await getSql();
  const rows = await sql<{
    id: string;
    name: string;
    email: string;
    image: string | null;
    role: string | null;
    banned: boolean | null;
    premium_until: string | null;
    created_at: string;
  }>`
    select u.id,
           u.name,
           u.email,
           u.image,
           u."createdAt"::text as created_at,
           m.role,
           (m.banned_at is not null) as banned,
           case when g.until_at > now() then g.until_at::text else null end as premium_until
    from "user" u
    left join members m on m.user_id = u.id
    left join premium_grants g on g.user_id = u.id
    order by u."createdAt" asc
    limit 200
  `;
  return rows.map((row) => ({
    id: row.id,
    name: row.name || "Участник",
    email: row.email,
    image: row.image,
    role: row.role === "admin" ? "admin" : "member",
    banned: Boolean(row.banned),
    premiumUntil: row.premium_until,
    createdAt: row.created_at,
  }));
}

export const getAccess = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<Access> => {
    return loadAccess(context.userId);
  });

export const listAdminIds = createServerFn({ method: "GET" }).handler(async (): Promise<string[]> => {
  const sql = await getSql();
  const rows = await sql<{ user_id: string }>`select user_id from members where role = 'admin' limit 40`;
  return rows.map((row) => row.user_id);
});

export const listModels = createServerFn({ method: "GET" }).handler(async (): Promise<PublicModel[]> => {
  return readPublicModels();
});

export const listAdminModels = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<AdminModel[]> => {
    await assertAdmin(context.userId);
    return readAdminModels();
  });

export const saveModel = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(saveInput)
  .handler(async ({ context, data }): Promise<AdminModel[]> => {
    await assertAdmin(context.userId);
    const sql = await getSql();
    const previous = data.previousName;
    if (!previous) {
      const existing = await sql<{ name: string }>`select name from catalog_models where name = ${data.name}`;
      if (existing.length) throw new Error("Такая модель уже есть");
      const first = data.providers[0];
      await sql`
        insert into catalog_models (name, display_name, base_url, api_key, system_prompt, icon)
        values (${data.name}, ${data.displayName}, ${first.baseUrl}, ${first.apiKey}, ${data.prompt}, ${data.icon})
      `;
      await writeProviders(data.name, data.providers);
      return readAdminModels();
    }
    if (previous !== data.name) {
      const clash = await sql<{ name: string }>`select name from catalog_models where name = ${data.name}`;
      if (clash.length) throw new Error("Такая модель уже есть");
    }
    const current = await sql<{ name: string }>`select name from catalog_models where name = ${previous}`;
    if (!current.length) throw new Error("Модель не найдена");
    await sql`
      update catalog_models
      set name = ${data.name}, display_name = ${data.displayName}, system_prompt = ${data.prompt}, icon = ${data.icon}
      where name = ${previous}
    `;
    await writeProviders(data.name, data.providers);
    return readAdminModels();
  });

export const removeModel = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(modelName)
  .handler(async ({ context, data }): Promise<AdminModel[]> => {
    await assertAdmin(context.userId);
    const sql = await getSql();
    const count = await sql<{ n: number }>`select count(*) as n from catalog_models`;
    if (Number(count[0]?.n ?? 0) <= 1) throw new Error("Последнюю модель удалить нельзя");
    const gone = await sql<{ name: string }>`
      delete from catalog_models where name = ${data} returning name
    `;
    if (!gone.length) throw new Error("Модель не найдена");
    return readAdminModels();
  });

export const listMembers = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<MemberRow[]> => {
    await assertAdmin(context.userId);
    return readMembers();
  });

export const setBan = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Участник не найден");
    const raw = input as { id?: unknown; banned?: unknown };
    if (typeof raw.banned !== "boolean") throw new Error("Некорректное действие");
    return { id: asId(raw.id), banned: raw.banned };
  })
  .handler(async ({ context, data }): Promise<MemberRow[]> => {
    await assertAdmin(context.userId);
    if (data.id === context.userId) throw new Error("Себя заблокировать нельзя");
    const sql = await getSql();
    const target = await sql<{ id: string; role: string | null }>`
      select u.id, m.role
      from "user" u
      left join members m on m.user_id = u.id
      where u.id = ${data.id}
    `;
    if (!target.length) throw new Error("Участник не найден");
    if (target[0]?.role === "admin") throw new Error("Администратора заблокировать нельзя");
    if (data.banned) {
      await sql`
        insert into members (user_id, role, banned_at)
        values (${data.id}, 'member', now())
        on conflict (user_id) do update set banned_at = now()
      `;
      await sql`delete from "session" where "userId" = ${data.id}`;
    } else {
      await sql`
        insert into members (user_id, role, banned_at)
        values (${data.id}, 'member', null)
        on conflict (user_id) do update set banned_at = null
      `;
    }
    return readMembers();
  });

export const setRole = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Участник не найден");
    const raw = input as { id?: unknown; role?: unknown };
    if (raw.role !== "admin" && raw.role !== "member") throw new Error("Некорректная роль");
    return { id: asId(raw.id), role: raw.role };
  })
  .handler(async ({ context, data }): Promise<MemberRow[]> => {
    await assertAdmin(context.userId);
    if (data.id === context.userId && data.role !== "admin") throw new Error("Себя снять нельзя");
    const sql = await getSql();
    const users = await sql<{ id: string }>`select id from "user" where id = ${data.id}`;
    if (!users.length) throw new Error("Участник не найден");
    if (data.role === "admin") {
      await sql`
        insert into members (user_id, role, banned_at)
        values (${data.id}, 'admin', null)
        on conflict (user_id) do update set role = 'admin', banned_at = null
      `;
      return readMembers();
    }
    const updated = await sql<{ user_id: string }>`
      update members
      set role = 'member'
      where user_id = ${data.id}
        and role = 'admin'
        and (select count(*) from members where role = 'admin') > 1
      returning user_id
    `;
    if (!updated.length) {
      const current = await sql<{ role: string | null }>`select role from members where user_id = ${data.id}`;
      if (current[0]?.role === "admin") throw new Error("Последнего администратора снять нельзя");
    }
    return readMembers();
  });

export const setMemberPremium = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Участник не найден");
    const raw = input as { id?: unknown; grant?: unknown };
    if (typeof raw.grant !== "boolean") throw new Error("Некорректное действие");
    return { id: asId(raw.id), grant: raw.grant };
  })
  .handler(async ({ context, data }): Promise<MemberRow[]> => {
    await assertAdmin(context.userId);
    const sql = await getSql();
    const users = await sql<{ id: string }>`select id from "user" where id = ${data.id}`;
    if (!users.length) throw new Error("Участник не найден");
    if (data.grant) await grantPremium(data.id, context.userId);
    else await revokePremium(data.id);
    return readMembers();
  });

export type AttemptRow = {
  id: string;
  who: string;
  model: string;
  mode: string;
  ok: boolean;
  note: string;
  createdAt: string;
};

export const listAttempts = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: unknown): 5 | 30 => {
    const raw = typeof input === "number" ? input : input && typeof input === "object" ? (input as { days?: unknown }).days : undefined;
    return raw === 30 ? 30 : 5;
  })
  .handler(async ({ context, data }): Promise<AttemptRow[]> => {
    await assertAdmin(context.userId);
    const sql = await getSql();
    const rows = await sql<{
      id: string;
      who: string;
      model: string;
      mode: string;
      ok: boolean;
      note: string;
      created_at: string;
    }>`
      select a.id,
             a.model,
             a.mode,
             a.ok,
             a.note,
             a.created_at::text as created_at,
             coalesce(u.name, case when a.user_id is null then 'Гость' else 'Участник' end) as who
      from chat_attempts a
      left join "user" u on u.id = a.user_id
      where a.created_at >= now() - (${data === 30 ? "30 days" : "5 days"}::interval)
      order by a.created_at desc
      limit 40
    `;
    return rows.map((row) => ({
      id: row.id,
      who: row.who,
      model: row.model,
      mode: row.mode,
      ok: Boolean(row.ok),
      note: row.note,
      createdAt: row.created_at,
    }));
  });

export type ChatStats = {
  requests: number;
  ok: number;
  tokens: number;
  days: { day: string; requests: number; tokens: number }[];
  models: { model: string; requests: number; tokens: number }[];
};

export const chatStats = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<ChatStats> => {
    await assertAdmin(context.userId);
    const sql = await getSql();
    const totals = await sql<{ requests: number; ok: number; tokens: number | string }>`
      select count(*)::int as requests,
             count(*) filter (where ok)::int as ok,
             coalesce(sum(total_tokens), 0)::bigint as tokens
      from chat_attempts
      where created_at >= now() - interval '14 days'
    `;
    const days = await sql<{ day: string; requests: number; tokens: number | string }>`
      select to_char(created_at at time zone 'UTC', 'DD.MM') as day,
             count(*)::int as requests,
             coalesce(sum(total_tokens), 0)::bigint as tokens
      from chat_attempts
      where created_at >= now() - interval '14 days'
      group by to_char(created_at at time zone 'UTC', 'DD.MM'), date_trunc('day', created_at at time zone 'UTC')
      order by date_trunc('day', created_at at time zone 'UTC')
    `;
    const models = await sql<{ model: string; requests: number; tokens: number | string }>`
      select model,
             count(*)::int as requests,
             coalesce(sum(total_tokens), 0)::bigint as tokens
      from chat_attempts
      where created_at >= now() - interval '14 days'
      group by model
      order by coalesce(sum(total_tokens), 0) desc, count(*) desc
      limit 8
    `;
    const row = totals[0];
    return {
      requests: Number(row?.requests ?? 0),
      ok: Number(row?.ok ?? 0),
      tokens: Number(row?.tokens ?? 0),
      days: days.map((item) => ({ day: item.day, requests: Number(item.requests), tokens: Number(item.tokens) })),
      models: models.map((item) => ({ model: item.model, requests: Number(item.requests), tokens: Number(item.tokens) })),
    };
  });

export type ImageModel = { name: string; displayName: string };

export type AdminImageModel = ImageModel & {
  baseUrl: string;
  hasKey: boolean;
};

const DEFAULT_IMAGE_BASE = "https://api.x.ai/v1";

type ImageSaveInput = {
  name: string;
  displayName: string;
  baseUrl: string;
  apiKey: string;
  clearKey: boolean;
  previousName: string;
};

function imageSaveInput(input: unknown): ImageSaveInput {
  if (!input || typeof input !== "object") throw new Error("Некорректная модель");
  const raw = input as Record<string, unknown>;
  const name = modelName(raw.name);
  const previousName = typeof raw.previousName === "string" && raw.previousName.trim() ? modelName(raw.previousName) : "";
  const apiKey = typeof raw.apiKey === "string" ? raw.apiKey.trim().slice(0, 400) : "";
  if (apiKey && /[\r\n]/.test(apiKey)) throw new Error("Ключ не должен содержать переносы");
  return {
    name,
    displayName: displayOf(raw.displayName, name),
    baseUrl: catalogUrl(raw.baseUrl),
    apiKey,
    clearKey: raw.clearKey === true,
    previousName,
  };
}

async function readImageModels(): Promise<ImageModel[]> {
  const sql = await getSql();
  const rows = await sql<{ name: string; display_name: string | null }>`
    select name, display_name from image_models order by created_at asc, name asc
  `;
  return rows.map((row) => ({ name: row.name, displayName: row.display_name || row.name }));
}

async function readAdminImageModels(): Promise<AdminImageModel[]> {
  const sql = await getSql();
  const rows = await sql<{
    name: string;
    display_name: string | null;
    base_url: string | null;
    api_key: string | null;
  }>`
    select name, display_name, base_url, api_key
    from image_models
    order by created_at asc, name asc
  `;
  return rows.map((row) => ({
    name: row.name,
    displayName: row.display_name || row.name,
    baseUrl: row.base_url?.trim() || DEFAULT_IMAGE_BASE,
    hasKey: Boolean(row.api_key && row.api_key.length > 0),
  }));
}

export const listImageModels = createServerFn({ method: "GET" }).handler(async (): Promise<ImageModel[]> => {
  return readImageModels();
});

export const listAdminImageModels = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<AdminImageModel[]> => {
    await assertAdmin(context.userId);
    return readAdminImageModels();
  });

export const saveImageModel = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(imageSaveInput)
  .handler(async ({ context, data }): Promise<AdminImageModel[]> => {
    await assertAdmin(context.userId);
    const sql = await getSql();
    const previous = data.previousName;
    if (!previous) {
      const existing = await sql<{ name: string }>`select name from image_models where name = ${data.name}`;
      if (existing.length) throw new Error("Такая модель уже есть");
      await sql`
        insert into image_models (name, display_name, base_url, api_key)
        values (${data.name}, ${data.displayName}, ${data.baseUrl}, ${data.apiKey})
      `;
      return readAdminImageModels();
    }
    if (previous !== data.name) {
      const clash = await sql<{ name: string }>`select name from image_models where name = ${data.name}`;
      if (clash.length) throw new Error("Такая модель уже есть");
    }
    const current = await sql<{ name: string }>`select name from image_models where name = ${previous}`;
    if (!current.length) throw new Error("Модель не найдена");
    if (data.clearKey) {
      await sql`
        update image_models
        set name = ${data.name}, display_name = ${data.displayName}, base_url = ${data.baseUrl}, api_key = ''
        where name = ${previous}
      `;
    } else if (data.apiKey) {
      await sql`
        update image_models
        set name = ${data.name}, display_name = ${data.displayName}, base_url = ${data.baseUrl}, api_key = ${data.apiKey}
        where name = ${previous}
      `;
    } else {
      await sql`
        update image_models
        set name = ${data.name}, display_name = ${data.displayName}, base_url = ${data.baseUrl}
        where name = ${previous}
      `;
    }
    return readAdminImageModels();
  });

export const removeImageModel = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(modelName)
  .handler(async ({ context, data }): Promise<AdminImageModel[]> => {
    await assertAdmin(context.userId);
    const sql = await getSql();
    const count = await sql<{ n: number }>`select count(*)::int as n from image_models`;
    if (Number(count[0]?.n ?? 0) <= 1) throw new Error("Последнюю модель удалить нельзя");
    const gone = await sql<{ name: string }>`
      delete from image_models where name = ${data} returning name
    `;
    if (!gone.length) throw new Error("Модель не найдена");
    return readAdminImageModels();
  });

export type TtsModel = { name: string; displayName: string; voice: string };

export type AdminTtsModel = TtsModel & {
  baseUrl: string;
  hasKey: boolean;
};

const DEFAULT_TTS_BASE = "https://api.openai.com/v1";

type TtsSaveInput = ImageSaveInput & { voice: string };

function voiceOf(value: unknown) {
  const voice = typeof value === "string" ? value.trim() : "";
  if (!voice) return "alloy";
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(voice)) throw new Error("Голос: латиница, цифры, _ и -");
  return voice;
}

function ttsSaveInput(input: unknown): TtsSaveInput {
  const base = imageSaveInput(input);
  const raw = input as Record<string, unknown>;
  const given = typeof raw.baseUrl === "string" ? raw.baseUrl.trim() : "";
  return { ...base, baseUrl: given ? base.baseUrl : DEFAULT_TTS_BASE, voice: voiceOf(raw.voice) };
}

async function readAdminTtsModels(): Promise<AdminTtsModel[]> {
  const sql = await getSql();
  const rows = await sql<{
    name: string;
    display_name: string | null;
    base_url: string | null;
    api_key: string | null;
    voice: string | null;
  }>`
    select name, display_name, base_url, api_key, voice
    from tts_models
    order by created_at asc, name asc
  `;
  return rows.map((row) => ({
    name: row.name,
    displayName: row.display_name || row.name,
    baseUrl: row.base_url?.trim() || DEFAULT_TTS_BASE,
    voice: row.voice || "alloy",
    hasKey: Boolean(row.api_key && row.api_key.length > 0),
  }));
}

export const listAdminTtsModels = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<AdminTtsModel[]> => {
    await assertAdmin(context.userId);
    return readAdminTtsModels();
  });

export const saveTtsModel = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(ttsSaveInput)
  .handler(async ({ context, data }): Promise<AdminTtsModel[]> => {
    await assertAdmin(context.userId);
    const sql = await getSql();
    const previous = data.previousName;
    if (!previous) {
      const existing = await sql<{ name: string }>`select name from tts_models where name = ${data.name}`;
      if (existing.length) throw new Error("Такая модель уже есть");
      await sql`
        insert into tts_models (name, display_name, base_url, api_key, voice)
        values (${data.name}, ${data.displayName}, ${data.baseUrl}, ${data.apiKey}, ${data.voice})
      `;
      return readAdminTtsModels();
    }
    if (previous !== data.name) {
      const clash = await sql<{ name: string }>`select name from tts_models where name = ${data.name}`;
      if (clash.length) throw new Error("Такая модель уже есть");
    }
    const current = await sql<{ name: string }>`select name from tts_models where name = ${previous}`;
    if (!current.length) throw new Error("Модель не найдена");
    if (data.clearKey) {
      await sql`
        update tts_models
        set name = ${data.name}, display_name = ${data.displayName}, base_url = ${data.baseUrl}, api_key = '', voice = ${data.voice}
        where name = ${previous}
      `;
    } else if (data.apiKey) {
      await sql`
        update tts_models
        set name = ${data.name}, display_name = ${data.displayName}, base_url = ${data.baseUrl}, api_key = ${data.apiKey}, voice = ${data.voice}
        where name = ${previous}
      `;
    } else {
      await sql`
        update tts_models
        set name = ${data.name}, display_name = ${data.displayName}, base_url = ${data.baseUrl}, voice = ${data.voice}
        where name = ${previous}
      `;
    }
    return readAdminTtsModels();
  });

export const removeTtsModel = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(modelName)
  .handler(async ({ context, data }): Promise<AdminTtsModel[]> => {
    await assertAdmin(context.userId);
    const sql = await getSql();
    const gone = await sql<{ name: string }>`
      delete from tts_models where name = ${data} returning name
    `;
    if (!gone.length) throw new Error("Модель не найдена");
    return readAdminTtsModels();
  });

export const clearAttempts = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<{ ok: true }> => {
    await assertAdmin(context.userId);
    const sql = await getSql();
    await sql`delete from chat_attempts`;
    return { ok: true };
  });
