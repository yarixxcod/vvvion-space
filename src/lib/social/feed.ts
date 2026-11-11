import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { grantAchievement } from "@/lib/social/achievements";
import { assertActive } from "@/lib/social/access";

export type FeedFile = {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: "image" | "video" | "file";
};

export type FeedPost = {
  id: string;
  body: string;
  createdAt: string;
  author: string;
  authorId: string;
  authorImage: string | null;
  likes: number;
  liked: boolean;
  mine: boolean;
  replies: number;
  parentId: string | null;
  files: FeedFile[];
};

const LIMIT = 40;
const POST_ID = /^[0-9a-f-]{36}$/i;
const SHARE_TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

type FileRow = {
  id: string;
  post_id: string;
  name: string;
  mime: string;
  size: number;
  kind: string;
};

function asKind(value: string): FeedFile["kind"] {
  return value === "image" || value === "video" ? value : "file";
}

async function filesFor(ids: string[]): Promise<Map<string, FeedFile[]>> {
  const map = new Map<string, FeedFile[]>();
  const clean = ids.filter((id) => POST_ID.test(id));
  if (!clean.length) return map;
  const sql = await getSql();
  const marks = clean.map((_, index) => `$${index + 1}`).join(", ");
  const rows = await sql.query<FileRow>(
    `select id, post_id, name, mime, size, kind from post_files where post_id in (${marks}) order by created_at asc`,
    clean,
  );
  for (const row of rows) {
    const list = map.get(row.post_id) ?? [];
    list.push({
      id: row.id,
      name: row.name,
      mime: row.mime,
      size: Number(row.size) || 0,
      kind: asKind(row.kind),
    });
    map.set(row.post_id, list);
  }
  return map;
}

function newToken(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export const listPosts = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<FeedPost[]> => {
    await assertActive(context.userId);
    const sql = await getSql();
    const rows = await sql<{
      id: string;
      body: string;
      created_at: string;
      user_id: string;
      author: string;
      image: string | null;
      likes: number;
      liked: boolean | null;
      replies: number;
    }>`
      select p.id,
             p.body,
             p.user_id,
             p.created_at::text as created_at,
             coalesce(u.name, 'Участник') as author,
             u.image,
             coalesce(c.likes, 0) as likes,
             m.liked as liked,
             coalesce(r.replies, 0) as replies
      from posts p
      left join "user" u on u.id = p.user_id
      left join (
        select post_id, count(*) as likes
        from post_likes
        group by post_id
      ) c on c.post_id = p.id
      left join (
        select post_id, true as liked
        from post_likes
        where user_id = ${context.userId}
      ) m on m.post_id = p.id
      left join (
        select parent_id, count(*) as replies
        from posts
        where parent_id is not null
        group by parent_id
      ) r on r.parent_id = p.id
      where p.parent_id is null
      order by p.created_at desc
      limit ${LIMIT}
    `;
    const files = await filesFor(rows.map((row) => row.id));
    return rows.map((row) => ({
      id: row.id,
      body: row.body,
      createdAt: row.created_at,
      author: row.author,
      authorId: row.user_id,
      authorImage: row.image,
      likes: Number(row.likes) || 0,
      liked: Boolean(row.liked),
      mine: row.user_id === context.userId,
      replies: Number(row.replies) || 0,
      parentId: null,
      files: files.get(row.id) ?? [],
    }));
  });

export const readPostCard = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const id = typeof input === "string" ? input.trim() : "";
    if (!POST_ID.test(id)) throw new Error("Запись не найдена");
    return id;
  })
  .handler(async ({ context, data }): Promise<{ author: string; body: string }> => {
    await assertActive(context.userId);
    const sql = await getSql();
    const rows = await sql<{ body: string; author: string }>`
      select p.body, coalesce(u.name, 'Участник') as author
      from posts p
      left join "user" u on u.id = p.user_id
      where p.id = ${data}
      limit 1
    `;
    const row = rows[0];
    if (!row) throw new Error("Запись не найдена");
    return { author: row.author, body: row.body.replace(/\s+/g, " ").trim().slice(0, 160) };
  });

export const createPost = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw =
      typeof input === "string"
        ? { body: input, parentId: "" }
        : input && typeof input === "object"
          ? (input as { body?: unknown; parentId?: unknown })
          : {};
    if (typeof raw.body !== "string") throw new Error("Напишите текст");
    const text = raw.body.replace(/\s+/g, " ").trim();
    if (!text || text.length > 500) throw new Error("От 1 до 500 символов");
    const parentId = typeof raw.parentId === "string" ? raw.parentId.trim() : "";
    if (parentId && !/^[0-9a-f-]{16,40}$/i.test(parentId)) throw new Error("Запись не найдена");
    return { body: text, parentId };
  })
  .handler(async ({ context, data }) => {
    await assertActive(context.userId);
    const sql = await getSql();
    let parentAuthor = "";
    if (data.parentId) {
      const parent = await sql<{ id: string; user_id: string }>`
        select id, user_id from posts where id = ${data.parentId} and parent_id is null
      `;
      if (!parent.length) throw new Error("Запись не найдена");
      parentAuthor = parent[0]?.user_id ?? "";
    }
    const recent = await sql<{ n: number }>`
      select count(*) as n
      from posts
      where user_id = ${context.userId}
        and created_at > now() - interval '10 minutes'
    `;
    if (Number(recent[0]?.n ?? 0) >= 12) {
      throw new Error("Слишком много записей подряд. Подождите немного.");
    }
    const id = crypto.randomUUID();
    await sql`
      insert into posts (id, user_id, body, parent_id)
      values (${id}, ${context.userId}, ${data.body}, ${data.parentId || null})
    `;
    if (!data.parentId) void grantAchievement(context.userId, "post");
    if (parentAuthor && parentAuthor !== context.userId) {
      const to = parentAuthor;
      const from = context.userId;
      const body = data.body;
      void import("@/lib/social/telegram.server")
        .then(async ({ notifyUser, senderName }) => {
          const name = await senderName(from);
          await notifyUser(to, `Ответ в ленте от ${name}:\n${body}`);
        })
        .catch(() => undefined);
    }
    return { id };
  });

export const toggleLike = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((id: unknown) => {
    if (typeof id !== "string" || !/^[0-9a-f-]{16,40}$/i.test(id)) {
      throw new Error("Запись не найдена");
    }
    return id;
  })
  .handler(async ({ context, data }) => {
    await assertActive(context.userId);
    const sql = await getSql();
    const existing = await sql<{ post_id: string }>`
      select post_id from post_likes
      where post_id = ${data} and user_id = ${context.userId}
    `;
    if (existing.length) {
      await sql`
        delete from post_likes
        where post_id = ${data} and user_id = ${context.userId}
      `;
      return { liked: false };
    }
    await sql`
      insert into post_likes (post_id, user_id)
      values (${data}, ${context.userId})
    `;
    return { liked: true };
  });

export const deletePost = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((id: unknown) => {
    if (typeof id !== "string" || !/^[0-9a-f-]{16,40}$/i.test(id)) {
      throw new Error("Запись не найдена");
    }
    return id;
  })
  .handler(async ({ context, data }) => {
    await assertActive(context.userId);
    const sql = await getSql();
    await sql`
      delete from posts
      where id = ${data} and user_id = ${context.userId}
    `;
    return { ok: true };
  });

export const listThread = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((id: unknown) => {
    if (typeof id !== "string" || !/^[0-9a-f-]{16,40}$/i.test(id)) throw new Error("Запись не найдена");
    return id;
  })
  .handler(async ({ context, data }): Promise<FeedPost[]> => {
    await assertActive(context.userId);
    const sql = await getSql();
    const rows = await sql<{
      id: string;
      body: string;
      created_at: string;
      user_id: string;
      author: string;
      image: string | null;
      likes: number;
      liked: boolean | null;
      parent_id: string | null;
    }>`
      select p.id,
             p.body,
             p.user_id,
             p.parent_id,
             p.created_at::text as created_at,
             coalesce(u.name, 'Участник') as author,
             u.image,
             coalesce(c.likes, 0) as likes,
             m.liked as liked
      from posts p
      left join "user" u on u.id = p.user_id
      left join (
        select post_id, count(*) as likes from post_likes group by post_id
      ) c on c.post_id = p.id
      left join (
        select post_id, true as liked from post_likes where user_id = ${context.userId}
      ) m on m.post_id = p.id
      where p.id = ${data} or p.parent_id = ${data}
      order by p.created_at asc
      limit 60
    `;
    const files = await filesFor(rows.map((row) => row.id));
    const replyCount = rows.filter((row) => row.parent_id).length;
    return rows.map((row) => ({
      id: row.id,
      body: row.body,
      createdAt: row.created_at,
      author: row.author,
      authorId: row.user_id,
      authorImage: row.image,
      likes: Number(row.likes) || 0,
      liked: Boolean(row.liked),
      mine: row.user_id === context.userId,
      replies: row.parent_id ? 0 : replyCount,
      parentId: row.parent_id,
      files: files.get(row.id) ?? [],
    }));
  });

export const sharePost = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((id: unknown) => {
    if (typeof id !== "string" || !POST_ID.test(id)) throw new Error("Запись не найдена");
    return id;
  })
  .handler(async ({ context, data }): Promise<{ token: string }> => {
    await assertActive(context.userId);
    const sql = await getSql();
    const post = await sql<{ id: string }>`select id from posts where id = ${data} limit 1`;
    if (!post.length) throw new Error("Запись не найдена");
    const existing = await sql<{ token: string }>`select token from post_shares where post_id = ${data} limit 1`;
    if (existing[0]?.token) return { token: existing[0].token };
    const token = newToken();
    const saved = await sql<{ token: string }>`
      insert into post_shares (post_id, token)
      values (${data}, ${token})
      on conflict (post_id) do nothing
      returning token
    `;
    if (saved[0]?.token) return { token: saved[0].token };
    const again = await sql<{ token: string }>`select token from post_shares where post_id = ${data} limit 1`;
    if (again[0]?.token) return { token: again[0].token };
    throw new Error("Не удалось создать ссылку");
  });

export type SharedPost = {
  id: string;
  body: string;
  createdAt: string;
  author: string;
  authorId: string;
  authorImage: string | null;
  files: FeedFile[];
};

export const readSharedPost = createServerFn({ method: "GET" })
  .validator((token: unknown): string => (typeof token === "string" && SHARE_TOKEN.test(token) ? token : ""))
  .handler(async ({ data }): Promise<SharedPost | null> => {
    if (!data) return null;
    const sql = await getSql();
    const rows = await sql<{
      id: string;
      body: string;
      created_at: string;
      user_id: string;
      author: string;
      image: string | null;
    }>`
      select p.id,
             p.body,
             p.user_id,
             p.created_at::text as created_at,
             coalesce(u.name, 'Участник') as author,
             u.image
      from post_shares s
      join posts p on p.id = s.post_id
      left join "user" u on u.id = p.user_id
      where s.token = ${data}
      limit 1
    `;
    const row = rows[0];
    if (!row) return null;
    const files = await filesFor([row.id]);
    return {
      id: row.id,
      body: row.body,
      createdAt: row.created_at,
      author: row.author,
      authorId: row.user_id,
      authorImage: row.image,
      files: files.get(row.id) ?? [],
    };
  });
