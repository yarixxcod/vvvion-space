import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { grantAchievement } from "@/lib/social/achievements";
import { assertActive } from "@/lib/social/access";
import { stickerCode } from "@/lib/stickers";
import { bookMark, megaMark, postMark, screenMark, splitChat } from "@/lib/screen/mark";

export type Person = { id: string; name: string; image: string | null };

export type FoundPerson = Person & {
  relation: "none" | "pending-out" | "pending-in" | "friend";
};

export type RoomSummary = {
  id: string;
  kind: "dm" | "group";
  title: string;
  preview: string;
  at: string;
  unread: number;
  image: string | null;
  peerId: string | null;
};

export type FileMeta = { id: string; name: string; mime: string; size: number; blob?: boolean };

export type RoomMessage = {
  id: string;
  userId: string;
  name: string;
  image: string | null;
  body: string;
  mine: boolean;
  createdAt: string;
  read?: boolean;
  files: FileMeta[];
};

const ALLOWED = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "application/zip",
  "application/x-zip-compressed",
  "audio/mpeg",
  "audio/mp4",
  "audio/webm",
  "video/mp4",
  "video/webm",
]);

function fail(err: unknown): never {
  if (err instanceof Error && err.message.length > 0 && err.message.length < 180 && !/sql|syntax|relation|password/i.test(err.message)) {
    throw err;
  }
  console.error("[circle]", err);
  throw new Error("Круг сейчас недоступен");
}

function asId(value: unknown, label = "Участник не найден"): string {
  if (typeof value !== "string") throw new Error(label);
  const id = value.trim();
  if (!id || id.length > 128 || /[\s"'<>]/.test(id)) throw new Error(label);
  return id;
}

function previewLine(body: string | null): string {
  if (!body) return "Нет сообщений";
  if (stickerCode(body)) return "Стикер";
  const parts = splitChat(body);
  const labels = [
    parts.books.length ? "Книга" : "",
    parts.posts.length ? "Запись" : "",
    parts.mega.length ? "Файл" : "",
    parts.screen.length ? "Видео" : "",
  ].filter(Boolean);
  const text = parts.text.replace(/\s+/g, " ").trim();
  if (text && labels.length) return `${labels.join(", ")}. ${text}`.slice(0, 140);
  if (labels.length) return labels.join(", ");
  return text.slice(0, 140) || "Сообщение";
}

function cleanName(value: string) {
  return value.replace(/[^\p{L}\p{N}._ ()\-]+/gu, "").trim().slice(0, 80) || "файл";
}

function decodeFile(raw: string, mime: string): { b64: string; size: number } {
  const b64 = raw.replace(/\s/g, "").replace(/^data:[^,]+,/, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64) || b64.length > 1_800_000) {
    throw new Error("Файл не удалось прочитать");
  }
  const bytes = Buffer.from(b64, "base64");
  if (bytes.length < 1 || bytes.length > 1_200_000) throw new Error("Файл больше 1,2 МБ");
  if (!ALLOWED.has(mime)) throw new Error("Этот тип файла нельзя отправить");
  if (!magicOk(bytes, mime)) throw new Error("Файл не похож на заявленный тип");
  return { b64, size: bytes.length };
}

function magicOk(bytes: Buffer, mime: string): boolean {
  const b = bytes;
  if (mime === "image/jpeg") return b[0] === 0xff && b[1] === 0xd8;
  if (mime === "image/png") return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  if (mime === "image/gif") return b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46;
  if (mime === "image/webp") return b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP";
  if (mime === "application/pdf") return b.toString("ascii", 0, 4) === "%PDF";
  if (mime === "application/zip" || mime === "application/x-zip-compressed") return b[0] === 0x50 && b[1] === 0x4b;
  if (mime === "text/plain") return !b.includes(0);
  return true;
}

async function friendsOf(userId: string): Promise<Set<string>> {
  const sql = await getSql();
  const rows = await sql<{ from_id: string; to_id: string }>`
    select from_id, to_id from friend_links
    where status = 'accepted' and (from_id = ${userId} or to_id = ${userId})
    limit 400
  `;
  const set = new Set<string>();
  for (const row of rows) set.add(row.from_id === userId ? row.to_id : row.from_id);
  set.delete(userId);
  return set;
}

async function isFriend(me: string, other: string): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql<{ n: number }>`
    select count(*) as n from friend_links
    where status = 'accepted'
      and ((from_id = ${me} and to_id = ${other}) or (from_id = ${other} and to_id = ${me}))
  `;
  return Number(rows[0]?.n ?? 0) > 0;
}

async function assertMember(roomId: string, userId: string): Promise<{ kind: "dm" | "group" }> {
  const sql = await getSql();
  const rows = await sql<{ kind: string }>`
    select r.kind
    from rooms r
    join room_members m on m.room_id = r.id and m.user_id = ${userId}
    where r.id = ${roomId}
  `;
  const kind = rows[0]?.kind;
  if (kind !== "dm" && kind !== "group") throw new Error("Переписка не найдена");
  return { kind };
}

export const searchPeople = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw =
      typeof input === "string"
        ? input
        : input && typeof input === "object" && typeof (input as { q?: unknown }).q === "string"
          ? (input as { q: string }).q
          : "";
    const q = raw.trim().replace(/[\\%_]/g, "").slice(0, 80);
    if (q.length < 2) throw new Error("Напишите хотя бы 2 символа");
    return q;
  })
  .handler(async ({ context, data }): Promise<FoundPerson[]> => {
    try {
      await assertActive(context.userId);
      const sql = await getSql();
      const like = `%${data}%`;
      const rows = await sql<{ id: string; name: string; image: string | null }>`
        select u.id, coalesce(u.name, 'Участник') as name, u.image
        from "user" u
        where u.id <> ${context.userId}
          and (u.name ilike ${like} or u.email ilike ${like})
          and not exists (
            select 1 from members m where m.user_id = u.id and m.banned_at is not null
          )
        order by u.name asc
        limit 8
      `;
      const links = await sql<{ from_id: string; to_id: string; status: string }>`
        select from_id, to_id, status from friend_links
        where from_id = ${context.userId} or to_id = ${context.userId}
        limit 400
      `;
      return rows.map((row) => {
        const link = links.find(
          (item) =>
            (item.from_id === context.userId && item.to_id === row.id) ||
            (item.to_id === context.userId && item.from_id === row.id),
        );
        let relation: FoundPerson["relation"] = "none";
        if (link?.status === "accepted") relation = "friend";
        else if (link?.status === "pending" && link.from_id === context.userId) relation = "pending-out";
        else if (link?.status === "pending") relation = "pending-in";
        return { id: row.id, name: row.name, image: row.image, relation };
      });
    } catch (err) {
      fail(err);
    }
  });

export const listFriends = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<Person[]> => {
    try {
      await assertActive(context.userId);
      const sql = await getSql();
      const rows = await sql<{ id: string; name: string; image: string | null }>`
        select distinct u.id, coalesce(u.name, 'Участник') as name, u.image
        from friend_links f
        join "user" u on u.id = case when f.from_id = ${context.userId} then f.to_id else f.from_id end
        where f.status = 'accepted' and (f.from_id = ${context.userId} or f.to_id = ${context.userId})
        order by name asc
        limit 200
      `;
      return rows;
    } catch (err) {
      fail(err);
    }
  });

export const listRequests = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<Person[]> => {
    try {
      await assertActive(context.userId);
      const sql = await getSql();
      return await sql<{ id: string; name: string; image: string | null }>`
        select u.id, coalesce(u.name, 'Участник') as name, u.image
        from friend_links f
        join "user" u on u.id = f.from_id
        where f.to_id = ${context.userId} and f.status = 'pending'
        order by f.created_at desc
        limit 40
      `;
    } catch (err) {
      fail(err);
    }
  });

export const requestFriend = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => asId(input))
  .handler(async ({ context, data }) => {
    try {
      await assertActive(context.userId);
      if (data === context.userId) throw new Error("Себе заявку слать не нужно");
      const sql = await getSql();
      const peer = await sql<{ id: string }>`
        select u.id from "user" u
        where u.id = ${data}
          and not exists (select 1 from members m where m.user_id = u.id and m.banned_at is not null)
      `;
      if (!peer.length) throw new Error("Участник не найден");
      const links = await sql<{ from_id: string; status: string }>`
        select from_id, status from friend_links
        where (from_id = ${context.userId} and to_id = ${data})
           or (from_id = ${data} and to_id = ${context.userId})
      `;
      if (links.some((row) => row.status === "accepted")) return { ok: true as const };
      const incoming = links.find((row) => row.from_id === data);
      if (incoming) {
        await sql`
          update friend_links set status = 'accepted'
          where from_id = ${data} and to_id = ${context.userId}
        `;
        return { ok: true as const };
      }
      if (!links.length) {
        await sql`
          insert into friend_links (from_id, to_id, status)
          values (${context.userId}, ${data}, 'pending')
        `;
        const to = data;
        const from = context.userId;
        void import("@/lib/social/telegram.server")
          .then(async ({ notifyUser, senderName }) => {
            const name = await senderName(from);
            await notifyUser(to, `${name} хочет добавить вас в друзья.`);
          })
          .catch(() => undefined);
        void import("@/lib/social/push.server")
          .then(async (mod) => {
            const { senderName } = await import("@/lib/social/telegram.server");
            const name = await senderName(from);
            await mod.pushNotice(to, "messages", {
              id: `invite:${from}`,
              title: "Запрос в друзья",
              body: `${name} хочет добавить вас в друзья`,
              url: "/c/messages",
            });
          })
          .catch(() => undefined);
      }
      return { ok: true as const };
    } catch (err) {
      fail(err);
    }
  });

export const respondFriend = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Заявка не найдена");
    const raw = input as { id?: unknown; accept?: unknown };
    return { id: asId(raw.id, "Заявка не найдена"), accept: raw.accept === true };
  })
  .handler(async ({ context, data }) => {
    try {
      await assertActive(context.userId);
      const sql = await getSql();
      if (!data.accept) {
        await sql`
          delete from friend_links
          where from_id = ${data.id} and to_id = ${context.userId} and status = 'pending'
        `;
        return { ok: true as const };
      }
      const updated = await sql<{ from_id: string }>`
        update friend_links set status = 'accepted'
        where from_id = ${data.id} and to_id = ${context.userId} and status = 'pending'
        returning from_id
      `;
      if (!updated.length) throw new Error("Заявка не найдена");
      void grantAchievement(context.userId, "friend");
      void grantAchievement(data.id, "friend");
      const requester = data.id;
      const from = context.userId;
      void import("@/lib/social/telegram.server")
        .then(async ({ notifyUser, senderName }) => {
          const name = await senderName(from);
          await notifyUser(requester, `Вас добавили в друзья: ${name}.`);
        })
        .catch(() => undefined);
      return { ok: true as const };
    } catch (err) {
      fail(err);
    }
  });

export const countUnread = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<{ n: number }> => {
    try {
      await assertActive(context.userId);
      const sql = await getSql();
      const rows = await sql<{ n: number }>`
        select count(*) as n
        from room_messages msg
        join room_members me on me.room_id = msg.room_id and me.user_id = ${context.userId}
        where msg.user_id <> ${context.userId}
          and msg.created_at > me.last_read_at
      `;
      return { n: Number(rows[0]?.n ?? 0) };
    } catch {
      return { n: 0 };
    }
  });

export const listRooms = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<RoomSummary[]> => {
    try {
      await assertActive(context.userId);
      const sql = await getSql();
      const rows = await sql<{
        id: string;
        kind: string;
        title: string | null;
        preview: string | null;
        at: string | null;
        unread: number;
        peer: string | null;
        peer_image: string | null;
        peer_id: string | null;
      }>`
        select r.id,
               r.kind,
               r.title,
               r.updated_at::text as at,
               (
                 select case when body <> '' then body else 'Вложение' end
                 from room_messages
                 where room_id = r.id
                 order by created_at desc
                 limit 1
               ) as preview,
               (
                 select count(*)
                 from room_messages msg
                 where msg.room_id = r.id
                   and msg.user_id <> ${context.userId}
                   and msg.created_at > me.last_read_at
               ) as unread,
               (
                 select coalesce(u.name, 'Участник')
                 from room_members rm
                 join "user" u on u.id = rm.user_id
                 where rm.room_id = r.id and rm.user_id <> ${context.userId}
                 limit 1
               ) as peer,
               (
                 select u.image
                 from room_members rm
                 join "user" u on u.id = rm.user_id
                 where rm.room_id = r.id and rm.user_id <> ${context.userId}
                 limit 1
               ) as peer_image,
               (
                 select rm.user_id
                 from room_members rm
                 where rm.room_id = r.id and rm.user_id <> ${context.userId}
                 limit 1
               ) as peer_id
        from rooms r
        join room_members me on me.room_id = r.id and me.user_id = ${context.userId}
        order by r.updated_at desc
        limit 80
      `;
      return rows.map((row) => ({
        id: row.id,
        kind: row.kind === "group" ? "group" : "dm",
        title: row.kind === "group" ? row.title || "Группа" : row.peer || "Диалог",
        preview: previewLine(row.preview),
        at: row.at || "",
        unread: Number(row.unread ?? 0),
        image: row.kind === "group" ? null : row.peer_image,
        peerId: row.kind === "group" ? null : row.peer_id,
      }));
    } catch (err) {
      fail(err);
    }
  });

export const openDm = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => asId(input))
  .handler(async ({ context, data }): Promise<{ id: string }> => {
    try {
      await assertActive(context.userId);
      if (data === context.userId) throw new Error("Себе писать не нужно");
      if (!(await isFriend(context.userId, data))) throw new Error("Сначала добавьте человека в друзья");
      const sql = await getSql();
      const key = [context.userId, data].sort().join("|");
      const existing = await sql<{ id: string }>`select id from rooms where dm_key = ${key}`;
      if (existing[0]) {
        await sql`
          insert into room_members (room_id, user_id)
          values (${existing[0].id}, ${context.userId})
          on conflict do nothing
        `;
        return { id: existing[0].id };
      }
      const id = crypto.randomUUID();
      await sql`
        insert into rooms (id, kind, dm_key, created_by)
        values (${id}, 'dm', ${key}, ${context.userId})
      `;
      await sql`
        insert into room_members (room_id, user_id) values (${id}, ${context.userId})
      `;
      await sql`
        insert into room_members (room_id, user_id) values (${id}, ${data})
      `;
      return { id };
    } catch (err) {
      fail(err);
    }
  });

export const createGroup = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Назовите группу");
    const raw = input as { title?: unknown; members?: unknown };
    const title = typeof raw.title === "string" ? raw.title.trim().slice(0, 48) : "";
    if (title.length < 1) throw new Error("Назовите группу");
    if (!Array.isArray(raw.members) || raw.members.length < 1 || raw.members.length > 11) {
      throw new Error("В группе от 1 до 11 друзей");
    }
    const members = [...new Set(raw.members.map((item) => asId(item)))];
    return { title, members };
  })
  .handler(async ({ context, data }): Promise<{ id: string }> => {
    try {
      await assertActive(context.userId);
      const friends = await friendsOf(context.userId);
      if (data.members.some((id) => id === context.userId || !friends.has(id))) {
        throw new Error("В группу можно звать только друзей");
      }
      const sql = await getSql();
      const id = crypto.randomUUID();
      await sql`
        insert into rooms (id, kind, title, created_by)
        values (${id}, 'group', ${data.title}, ${context.userId})
      `;
      await sql`insert into room_members (room_id, user_id) values (${id}, ${context.userId})`;
      for (const member of data.members) {
        await sql`insert into room_members (room_id, user_id) values (${id}, ${member})`;
      }
      return { id };
    } catch (err) {
      fail(err);
    }
  });

export const leaveRoom = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => asId(input, "Переписка не найдена"))
  .handler(async ({ context, data }) => {
    try {
      await assertActive(context.userId);
      const room = await assertMember(data, context.userId);
      if (room.kind !== "group") throw new Error("Из личного диалога выходить не нужно");
      const sql = await getSql();
      await sql`delete from room_members where room_id = ${data} and user_id = ${context.userId}`;
      await sql`
        delete from rooms r
        where r.id = ${data}
          and not exists (select 1 from room_members m where m.room_id = r.id)
      `;
      return { ok: true as const };
    } catch (err) {
      fail(err);
    }
  });

export const listRoomMessages = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => asId(input, "Переписка не найдена"))
  .handler(async ({ context, data }): Promise<RoomMessage[]> => {
    try {
      await assertActive(context.userId);
      await assertMember(data, context.userId);
      const sql = await getSql();
      const rows = await sql<{
        id: string;
        user_id: string;
        name: string;
        image: string | null;
        body: string;
        created_at: string;
      }>`
        select m.id,
               m.user_id,
               coalesce(u.name, 'Участник') as name,
               u.image,
               m.body,
               m.created_at::text as created_at
        from room_messages m
        left join "user" u on u.id = m.user_id
        where m.room_id = ${data}
        order by m.created_at asc
        limit 120
      `;
      const files = await sql<{
        id: string;
        message_id: string;
        name: string;
        mime: string;
        size: number;
        blob: boolean | string | number | null;
      }>`
        select id, message_id, name, mime, size, (blob_path is not null) as blob
        from room_files
        where room_id = ${data}
        order by created_at asc
        limit 240
      `;
      const peers = await sql<{ last_read_at: string }>`
        select last_read_at::text as last_read_at
        from room_members
        where room_id = ${data} and user_id <> ${context.userId}
      `;
      const readAt = peers.length ? Math.min(...peers.map((peer) => Date.parse(peer.last_read_at))) : 0;
      await sql`
        update room_members set last_read_at = now()
        where room_id = ${data} and user_id = ${context.userId}
      `;
      const byMessage = new Map<string, FileMeta[]>();
      for (const file of files) {
        const list = byMessage.get(file.message_id) ?? [];
        list.push({
          id: file.id,
          name: file.name,
          mime: file.mime,
          size: Number(file.size),
          blob: file.blob === true || file.blob === 1 || file.blob === "t" || file.blob === "true",
        });
        byMessage.set(file.message_id, list);
      }
      return rows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        name: row.name,
        image: row.image,
        body: row.body,
        mine: row.user_id === context.userId,
        read: row.user_id === context.userId && Number.isFinite(readAt) && readAt > 0 && Date.parse(row.created_at) <= readAt,
        createdAt: row.created_at,
        files: byMessage.get(row.id) ?? [],
      }));
    } catch (err) {
      fail(err);
    }
  });

type OutFile = { name: string; mime: string; data: string };

export const sendRoomMessage = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Напишите сообщение");
    const raw = input as { roomId?: unknown; body?: unknown; files?: unknown };
    const roomId = asId(raw.roomId, "Переписка не найдена");
    const body = typeof raw.body === "string" ? raw.body.trim().slice(0, 4000) : "";
    const filesIn = Array.isArray(raw.files) ? raw.files.slice(0, 3) : [];
    const files: OutFile[] = filesIn.map((item) => {
      if (!item || typeof item !== "object") throw new Error("Файл не удалось прочитать");
      const file = item as { name?: unknown; mime?: unknown; data?: unknown };
      const mime = typeof file.mime === "string" ? file.mime : "";
      const data = typeof file.data === "string" ? file.data : "";
      const name = cleanName(typeof file.name === "string" ? file.name : "файл");
      if (!data) throw new Error("Файл не удалось прочитать");
      return { name, mime, data };
    });
    if (!body && files.length === 0) throw new Error("Напишите сообщение или приложите файл");
    return { roomId, body, files };
  })
  .handler(async ({ context, data }): Promise<{ id: string }> => {
    try {
      await assertActive(context.userId);
      const room = await assertMember(data.roomId, context.userId);
      if (room.kind === "dm") {
        const sql = await getSql();
        const peers = await sql<{ user_id: string }>`
          select user_id from room_members where room_id = ${data.roomId} and user_id <> ${context.userId}
        `;
        const peer = peers[0]?.user_id;
        if (!peer || !(await isFriend(context.userId, peer))) {
          throw new Error("Этот диалог доступен только друзьям");
        }
      }
      const prepared = data.files.map((file) => ({
        name: file.name,
        ...decodeFile(file.data, file.mime),
        mime: file.mime,
      }));
      const sql = await getSql();
      const recent = await sql<{ n: number }>`
        select count(*) as n from room_messages
        where user_id = ${context.userId} and created_at > now() - interval '10 minutes'
      `;
      if (Number(recent[0]?.n ?? 0) >= 40) throw new Error("Слишком много сообщений. Подождите немного.");
      if (prepared.length) {
        const filesN = await sql<{ n: number }>`
          select count(*) as n from room_files
          where user_id = ${context.userId} and created_at > now() - interval '10 minutes'
        `;
        if (Number(filesN[0]?.n ?? 0) + prepared.length > 12) {
          throw new Error("Слишком много файлов. Подождите немного.");
        }
      }
      const id = crypto.randomUUID();
      await sql`
        insert into room_messages (id, room_id, user_id, body)
        values (${id}, ${data.roomId}, ${context.userId}, ${data.body})
      `;
      for (const file of prepared) {
        const fileId = crypto.randomUUID();
        await sql`
          insert into room_files (id, room_id, message_id, user_id, name, mime, size, data)
          values (${fileId}, ${data.roomId}, ${id}, ${context.userId}, ${file.name}, ${file.mime}, ${file.size}, ${file.b64})
        `;
      }
      await sql`update rooms set updated_at = now() where id = ${data.roomId}`;
      await sql`
        update room_members set last_read_at = now()
        where room_id = ${data.roomId} and user_id = ${context.userId}
      `;
      const roomId = data.roomId;
      const from = context.userId;
      const kind = room.kind;
      const body = data.body;
      const attached = prepared.length > 0;
      void import("@/lib/social/push.server")
        .then((mod) => mod.pushRoomMessage(roomId, from, body, attached))
        .catch(() => undefined);
      void import("@/lib/social/telegram.server")
        .then(async ({ notifyUser, senderName }) => {
          const members = await sql<{ user_id: string }>`
            select user_id from room_members where room_id = ${roomId} and user_id <> ${from}
          `;
          if (!members.length) return;
          const name = await senderName(from);
          const preview = stickerCode(body) ? "Стикер" : body.trim() || (attached ? "Вложение" : "Сообщение");
          const text = kind === "group" ? `${name} в группе:\n${preview}` : `Сообщение от ${name}:\n${preview}`;
          await Promise.all(members.map((member) => notifyUser(member.user_id, text)));
        })
        .catch(() => undefined);
      void grantAchievement(context.userId, "hello");
      const sent = await sql<{ n: number }>`select count(*)::int as n from room_messages where user_id = ${context.userId}`;
      if (Number(sent[0]?.n ?? 0) >= 10) void grantAchievement(context.userId, "writer");
      return { id };
    } catch (err) {
      fail(err);
    }
  });

export const sendFromPlace = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Нечего отправить");
    const raw = input as { roomId?: unknown; source?: unknown; id?: unknown };
    const roomId = asId(raw.roomId, "Переписка не найдена");
    const source =
      raw.source === "book" || raw.source === "video" || raw.source === "disk" || raw.source === "post" || raw.source === "mega"
        ? raw.source
        : "";
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    if (!source || !id || id.length > 80) throw new Error("Нечего отправить");
    return { roomId, source, id };
  })
  .handler(async ({ context, data }): Promise<{ id: string }> => {
    await assertActive(context.userId);
    const room = await assertMember(data.roomId, context.userId);
    const sql = await getSql();
    if (room.kind === "dm") {
      const peers = await sql<{ user_id: string }>`
        select user_id from room_members where room_id = ${data.roomId} and user_id <> ${context.userId}
      `;
      const peer = peers[0]?.user_id;
      if (!peer || !(await isFriend(context.userId, peer))) throw new Error("Этот диалог доступен только друзьям");
    }
    let body = "";
    let file: { name: string; mime: string; size: number; data: string } | null = null;
    const markId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (data.source === "book") {
      if (!markId.test(data.id)) throw new Error("Книга не найдена");
      const rows = await sql<{ id: string }>`select id from shelf_books where id = ${data.id} limit 1`;
      if (!rows[0]) throw new Error("Книга не найдена");
      body = bookMark(data.id);
    } else if (data.source === "video") {
      if (!markId.test(data.id)) throw new Error("Видео не найдено");
      const rows = await sql<{ title: string }>`select title from screen_videos where id = ${data.id} limit 1`;
      if (!rows[0]) throw new Error("Видео не найдено");
      body = screenMark(data.id);
    } else if (data.source === "post") {
      if (!markId.test(data.id)) throw new Error("Запись не найдена");
      const rows = await sql<{ id: string }>`select id from posts where id = ${data.id} limit 1`;
      if (!rows[0]) throw new Error("Запись не найдена");
      body = postMark(data.id);
    } else if (data.source === "mega") {
      if (!markId.test(data.id)) throw new Error("Файл не найден на Мегадиске");
      const rows = await sql<{ id: string }>`
        select id from mega_entries
        where id = ${data.id} and user_id = ${context.userId} and kind = 'file' and status = 'ok'
        limit 1
      `;
      if (!rows[0]) throw new Error("Файл не найден на Мегадиске");
      body = megaMark(data.id);
    } else {
      const rows = await sql<{ name: string; mime: string; bytes: number; data: string }>`
        select name, mime, bytes, data from disk_files where id = ${data.id} and user_id = ${context.userId} limit 1
      `;
      const row = rows[0];
      if (!row?.data) throw new Error("Файл не найден на диске");
      file = { name: row.name, mime: row.mime, size: Number(row.bytes), data: row.data };
      body = "";
    }
    const id = crypto.randomUUID();
    await sql`
      insert into room_messages (id, room_id, user_id, body)
      values (${id}, ${data.roomId}, ${context.userId}, ${body})
    `;
    if (file) {
      await sql`
        insert into room_files (id, room_id, message_id, user_id, name, mime, size, data)
        values (${crypto.randomUUID()}, ${data.roomId}, ${id}, ${context.userId}, ${file.name}, ${file.mime}, ${file.size}, ${file.data})
      `;
      void grantAchievement(context.userId, "file");
    }
    await sql`update rooms set updated_at = now() where id = ${data.roomId}`;
    void import("@/lib/social/push.server")
      .then((mod) => mod.pushRoomMessage(data.roomId, context.userId, body, Boolean(file)))
      .catch(() => undefined);
    void grantAchievement(context.userId, "hello");
    return { id };
  });

export const readRoomFile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => asId(input, "Файл не найден"))
  .handler(async ({ context, data }): Promise<{ name: string; mime: string; data: string }> => {
    try {
      await assertActive(context.userId);
      const sql = await getSql();
      const rows = await sql<{ name: string; mime: string; data: string; room_id: string }>`
        select name, mime, data, room_id from room_files where id = ${data}
      `;
      const file = rows[0];
      if (!file) throw new Error("Файл не найден");
      await assertMember(file.room_id, context.userId);
      return { name: file.name, mime: file.mime, data: file.data };
    } catch (err) {
      fail(err);
    }
  });
