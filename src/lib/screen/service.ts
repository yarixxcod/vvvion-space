import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { assertActive, assertAdmin } from "@/lib/social/access";
import { parseVideoLink, type ScreenProvider } from "@/lib/screen/parse";

export type ScreenVideo = {
  id: string;
  provider: ScreenProvider;
  title: string;
  thumb: string;
  embedUrl: string;
  createdAt: string;
};

function clip(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function thumbOk(value: string): string {
  if (!value.startsWith("https://") || value.length > 500) return "";
  try {
    const host = new URL(value).hostname.toLowerCase();
    const fine =
      host === "i.ytimg.com" ||
      host.endsWith(".ytimg.com") ||
      host === "rutube.ru" ||
      host.endsWith(".rutube.ru") ||
      host.endsWith(".vk.com") ||
      host.endsWith(".userapi.com") ||
      host.endsWith(".vkuser.net") ||
      host.endsWith(".mycdn.me");
    return fine ? value : "";
  } catch {
    return "";
  }
}

async function pullJson(url: string): Promise<Record<string, unknown> | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== "https:" || (host !== "www.youtube.com" && host !== "rutube.ru")) return null;
  try {
    const response = await fetch(parsed, {
      redirect: "manual",
      signal: AbortSignal.timeout(8_000),
      headers: { accept: "application/json", "user-agent": "vvvion.space" },
    });
    if (!response.ok || response.status >= 300) return null;
    const text = await response.text();
    if (text.length > 200_000 || text.trim().startsWith("<")) return null;
    const json = JSON.parse(text) as unknown;
    return json && typeof json === "object" ? (json as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function describe(link: ReturnType<typeof parseVideoLink>): Promise<{ title: string; thumb: string }> {
  if (!link) return { title: "Ролик", thumb: "" };
  if (link.provider === "youtube") {
    const json = await pullJson(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${link.externalId}`)}&format=json`,
    );
    return {
      title: clip(json?.title, 180) || "Ролик YouTube",
      thumb: `https://i.ytimg.com/vi/${link.externalId}/hqdefault.jpg`,
    };
  }
  if (link.provider === "rutube") {
    const json = await pullJson(`https://rutube.ru/api/video/${link.externalId}/`);
    return {
      title: clip(json?.title, 180) || "Ролик Rutube",
      thumb: thumbOk(clip(json?.thumbnail_url, 500)),
    };
  }
  return { title: "Видео ВКонтакте", thumb: "" };
}

export const listScreen = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<ScreenVideo[]> => {
    await assertActive(context.userId);
    const sql = await getSql();
    const rows = await sql<{
      id: string;
      provider: string;
      title: string;
      thumb: string;
      embed_url: string;
      created_at: string;
    }>`
      select id, provider, title, thumb, embed_url, created_at::text as created_at
      from screen_videos
      order by created_at desc
      limit 80
    `;
    return rows
      .filter((row) => row.provider === "youtube" || row.provider === "rutube" || row.provider === "vk")
      .map((row) => ({
        id: row.id,
        provider: row.provider as ScreenProvider,
        title: row.title,
        thumb: thumbOk(row.thumb),
        embedUrl: row.embed_url,
        createdAt: row.created_at,
      }));
  });

export const getScreen = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = typeof input === "string" ? input : input && typeof input === "object" ? (input as { id?: unknown }).id : "";
    const id = typeof raw === "string" ? raw : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error("Ролик не найден");
    return id;
  })
  .handler(async ({ context, data }): Promise<ScreenVideo | null> => {
    await assertActive(context.userId);
    const sql = await getSql();
    const rows = await sql<{
      id: string;
      provider: string;
      title: string;
      thumb: string;
      embed_url: string;
      created_at: string;
    }>`
      select id, provider, title, thumb, embed_url, created_at::text as created_at
      from screen_videos
      where id = ${data}
      limit 1
    `;
    const row = rows[0];
    if (!row || (row.provider !== "youtube" && row.provider !== "rutube" && row.provider !== "vk")) return null;
    return {
      id: row.id,
      provider: row.provider,
      title: row.title,
      thumb: thumbOk(row.thumb),
      embedUrl: row.embed_url,
      createdAt: row.created_at,
    };
  });

export const addScreenVideo = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = input && typeof input === "object" ? (input as { url?: unknown }).url : input;
    const url = typeof raw === "string" ? raw.trim() : "";
    const parsed = parseVideoLink(url);
    if (!parsed) throw new Error("Нужна ссылка YouTube, Rutube или VK Видео");
    return parsed;
  })
  .handler(async ({ context, data }): Promise<ScreenVideo> => {
    await assertAdmin(context.userId);
    const meta = await describe(data);
    const sql = await getSql();
    const id = crypto.randomUUID();
    const rows = await sql<{ id: string }>`
      insert into screen_videos (id, added_by, provider, external_id, embed_url, title, thumb)
      values (${id}, ${context.userId}, ${data.provider}, ${data.externalId}, ${data.embedUrl}, ${meta.title}, ${meta.thumb})
      on conflict (provider, external_id) do update
        set title = excluded.title,
            thumb = excluded.thumb,
            embed_url = excluded.embed_url
      returning id
    `;
    return {
      id: rows[0]?.id || id,
      provider: data.provider,
      title: meta.title,
      thumb: meta.thumb,
      embedUrl: data.embedUrl,
      createdAt: new Date().toISOString(),
    };
  });

export const removeScreenVideo = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const id = typeof input === "string" ? input : input && typeof input === "object" ? (input as { id?: unknown }).id : "";
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Ролик не найден");
    return id;
  })
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    await assertAdmin(context.userId);
    const sql = await getSql();
    await sql`delete from screen_videos where id = ${data}`;
    return { ok: true };
  });
