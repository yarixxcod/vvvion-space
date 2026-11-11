import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { assertActive } from "@/lib/social/access";

export type Person = { id: string; name: string; image: string | null };

export type Conversation = {
  peerId: string;
  peerName: string;
  peerImage: string | null;
  preview: string;
  at: string;
};

export type MailMessage = {
  id: string;
  body: string;
  createdAt: string;
  mine: boolean;
};

function fail(err: unknown): never {
  if (
    err instanceof Error &&
    /Собеседник|Напишите|Себе писать|Такого участника|Слишком много|1000 символов|Аккаунт заблокирован|нельзя написать/.test(err.message)
  ) {
    throw err;
  }
  console.error("[mail]", err);
  throw new Error("Сообщения сейчас недоступны");
}

function asId(value: unknown): string {
  if (typeof value !== "string") throw new Error("Собеседник не найден");
  const id = value.trim();
  if (!id || id.length > 128 || /[\s"'<>]/.test(id)) throw new Error("Собеседник не найден");
  return id;
}

export const listDirectory = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<Person[]> => {
    try {
      await assertActive(context.userId);
      const sql = await getSql();
      const rows = await sql<{ id: string; name: string; image: string | null }>`
        select u.id, u.name, u.image
        from "user" u
        where u.id <> ${context.userId}
          and not exists (
            select 1 from members m
            where m.user_id = u.id and m.banned_at is not null
          )
        order by u.name asc
        limit 50
      `;
      return rows.map((row) => ({ id: row.id, name: row.name || "Участник", image: row.image }));
    } catch (err) {
      fail(err);
    }
  });

export const listInbox = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<Conversation[]> => {
    try {
      await assertActive(context.userId);
      const sql = await getSql();
      const rows = await sql<{
        from_user_id: string;
        to_user_id: string;
        body: string;
        created_at: string;
        from_name: string;
        to_name: string;
        from_image: string | null;
        to_image: string | null;
      }>`
        select m.from_user_id,
               m.to_user_id,
               m.body,
               m.created_at::text as created_at,
               coalesce(uf.name, 'Участник') as from_name,
               coalesce(ut.name, 'Участник') as to_name,
               uf.image as from_image,
               ut.image as to_image
        from direct_messages m
        left join "user" uf on uf.id = m.from_user_id
        left join "user" ut on ut.id = m.to_user_id
        where m.from_user_id = ${context.userId} or m.to_user_id = ${context.userId}
        order by m.created_at desc
        limit 200
      `;
      const seen = new Set<string>();
      const list: Conversation[] = [];
      for (const row of rows) {
        const mine = row.from_user_id === context.userId;
        const peerId = mine ? row.to_user_id : row.from_user_id;
        if (seen.has(peerId)) continue;
        seen.add(peerId);
        list.push({
          peerId,
          peerName: mine ? row.to_name : row.from_name,
          peerImage: mine ? row.to_image : row.from_image,
          preview: row.body,
          at: row.created_at,
        });
      }
      return list;
    } catch (err) {
      fail(err);
    }
  });

export const listThread = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(asId)
  .handler(async ({ context, data }): Promise<MailMessage[]> => {
    try {
      await assertActive(context.userId);
      const sql = await getSql();
      const rows = await sql<{
        id: string;
        body: string;
        created_at: string;
        from_user_id: string;
      }>`
        select id, body, created_at::text as created_at, from_user_id
        from direct_messages
        where (from_user_id = ${context.userId} and to_user_id = ${data})
           or (from_user_id = ${data} and to_user_id = ${context.userId})
        order by created_at desc
        limit 80
      `;
      return rows.reverse().map((row) => ({
        id: row.id,
        body: row.body,
        createdAt: row.created_at,
        mine: row.from_user_id === context.userId,
      }));
    } catch (err) {
      fail(err);
    }
  });

export const sendMessage = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Напишите сообщение");
    const raw = input as { to?: unknown; body?: unknown };
    const to = asId(raw.to);
    if (typeof raw.body !== "string") throw new Error("Напишите сообщение");
    const body = raw.body.trim();
    if (!body || body.length > 1000) throw new Error("От 1 до 1000 символов");
    return { to, body };
  })
  .handler(async ({ context, data }) => {
    try {
      await assertActive(context.userId);
      if (data.to === context.userId) throw new Error("Себе писать не нужно");
      const sql = await getSql();
      const peer = await sql<{ id: string; banned: boolean | null }>`
        select u.id, (m.banned_at is not null) as banned
        from "user" u
        left join members m on m.user_id = u.id
        where u.id = ${data.to}
      `;
      if (!peer.length) throw new Error("Такого участника нет");
      if (peer[0]?.banned) throw new Error("Этому человеку нельзя написать");
      const recent = await sql<{ n: number }>`
        select count(*) as n
        from direct_messages
        where from_user_id = ${context.userId}
          and created_at > now() - interval '10 minutes'
      `;
      if (Number(recent[0]?.n ?? 0) >= 30) {
        throw new Error("Слишком много сообщений подряд. Подождите немного.");
      }
      const id = crypto.randomUUID();
      await sql`
        insert into direct_messages (id, from_user_id, to_user_id, body)
        values (${id}, ${context.userId}, ${data.to}, ${data.body})
      `;
      const to = data.to;
      const from = context.userId;
      const body = data.body;
      void import("@/lib/social/telegram.server")
        .then(async ({ notifyUser, senderName }) => {
          const name = await senderName(from);
          await notifyUser(to, `Сообщение от ${name}:\n${body}`);
        })
        .catch(() => undefined);
      return { id };
    } catch (err) {
      fail(err);
    }
  });
