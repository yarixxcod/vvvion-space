import { createServerFn } from "@tanstack/react-start";
import { getSql, withTransaction, type Sql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { assertActive, assertAdmin } from "@/lib/social/access";
import { isUniqueViolation } from "@/lib/social/sql-error";
import {
  bodyOf,
  categoryOf,
  clipText,
  daysOf,
  imagePayload,
  pageOf,
  priorityOf,
  reasonOf,
  reportAllowed,
  sanctionFits,
  sanctionOf,
  snapshotOf,
  spanOf,
  subjectOf,
  targetOf,
  ticketAllowed,
  ticketStatusOf,
  canReopen,
} from "@/lib/social/support-core";

type ImageIn = { mime: "image/jpeg" | "image/png" | "image/webp"; data: string };

function idOf(value: unknown, label = "Не найдено"): string {
  if (typeof value !== "string") throw new Error(label);
  const id = value.trim();
  if (!id || id.length > 80 || /[\s"'<>]/.test(id)) throw new Error(label);
  return id;
}

function imagesOf(value: unknown): ImageIn[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 3) throw new Error("Не больше трёх скриншотов");
  const out: ImageIn[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") throw new Error("Скриншот не подошёл");
    const raw = item as { mime?: unknown; data?: unknown };
    const image = imagePayload(raw.mime, raw.data);
    if (!image) throw new Error("Нужен скриншот png, jpeg или webp до 200 КБ");
    out.push(image);
  }
  return out;
}

function likeOf(value: unknown): string {
  return clipText(value, 60).replace(/[\\%_]/g, "");
}

async function logEvent(sql: Sql, actorId: string | null, kind: string, refId: string, note: string) {
  await sql`
    insert into support_events (id, actor_id, kind, ref_id, note)
    values (${crypto.randomUUID()}, ${actorId}, ${kind}, ${refId}, ${clipText(note, 240)})
  `;
}

async function notice(userId: string, title: string, body: string, ref: string) {
  const sql = await getSql();
  const text = clipText(body, 400);
  await sql`
    insert into support_notices (id, user_id, title, body, href)
    values (${crypto.randomUUID()}, ${userId}, ${clipText(title, 80)}, ${text}, ${"/"})
  `;
  try {
    const { pushNotice } = await import("@/lib/social/push.server");
    await pushNotice(userId, "system", { id: `support:${ref}`, title: clipText(title, 80), body: text.slice(0, 140), url: "/" }, { kind: "support", ref });
  } catch {
    /* in-app notice is enough */
  }
  try {
    const { notifyUser } = await import("@/lib/social/telegram.server");
    await notifyUser(userId, `${clipText(title, 80)}\n${text.slice(0, 240)}`);
  } catch {
    /* telegram is optional */
  }
}

async function saveImages(sql: Sql, ticketId: string, messageId: string, ownerId: string, images: ImageIn[]) {
  for (const image of images) {
    await sql`
      insert into support_attachments (id, ticket_id, message_id, owner_id, name, mime, bytes, data)
      values (${crypto.randomUUID()}, ${ticketId}, ${messageId}, ${ownerId}, ${"screenshot"}, ${image.mime}, ${image.data.length}, ${image.data})
    `;
  }
}

export const listMyTickets = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await assertActive(context.userId);
    const sql = await getSql();
    return sql<{ id: string; category: string; subject: string; status: string; created_at: string; updated_at: string }>`
      select id, category, subject, status, created_at::text as created_at, updated_at::text as updated_at
      from support_tickets
      where user_id = ${context.userId}
      order by updated_at desc
      limit 40
    `;
  });

export const openTicket = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Обращение не заполнено");
    const raw = input as { category?: unknown; subject?: unknown; body?: unknown; images?: unknown };
    return { category: categoryOf(raw.category), subject: subjectOf(raw.subject), body: bodyOf(raw.body), images: imagesOf(raw.images) };
  })
  .handler(async ({ context, data }) => {
    await assertActive(context.userId);
    const sql = await getSql();
    const today = await sql<{ n: number }>`
      select count(*)::int as n from support_tickets
      where user_id = ${context.userId} and created_at > now() - interval '1 day'
    `;
    const blocked = ticketAllowed(Number(today[0]?.n ?? 0));
    if (blocked) throw new Error(blocked);
    const id = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    await withTransaction(async (tx) => {
      await tx`
        insert into support_tickets (id, user_id, category, subject, status, priority)
        values (${id}, ${context.userId}, ${data.category}, ${data.subject}, 'new', 'normal')
      `;
      await tx`
        insert into support_messages (id, ticket_id, author_id, body, internal)
        values (${messageId}, ${id}, ${context.userId}, ${data.body}, false)
      `;
      await saveImages(tx, id, messageId, context.userId, data.images);
      await logEvent(tx, context.userId, "ticket", id, data.category);
    });
    void notice(context.userId, "Обращение принято", "Мы получили обращение и ответим в этом диалоге.", id);
    return { id };
  });

export const readTicket = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => idOf(input, "Обращение не найдено"))
  .handler(async ({ context, data }) => {
    const access = await assertActive(context.userId);
    const sql = await getSql();
    const admin = access.role === "admin";
    const tickets = await sql<{
      id: string;
      user_id: string;
      category: string;
      subject: string;
      status: string;
      priority: string;
      assignee_id: string | null;
      created_at: string;
      updated_at: string;
    }>`
      select id, user_id, category, subject, status, priority, assignee_id,
             created_at::text as created_at, updated_at::text as updated_at
      from support_tickets where id = ${data} limit 1
    `;
    const ticket = tickets[0];
    if (!ticket || (!admin && ticket.user_id !== context.userId)) throw new Error("Обращение не найдено");
    const messages = await sql<{ id: string; author_id: string; body: string; internal: boolean; created_at: string }>`
      select id, author_id, body, internal, created_at::text as created_at
      from support_messages
      where ticket_id = ${data} and (${admin} or internal = false)
      order by created_at asc
      limit 80
    `;
    const files = await sql<{ id: string; message_id: string | null; mime: string; data: string }>`
      select id, message_id, mime, data from support_attachments where ticket_id = ${data} order by created_at asc limit 12
    `;
    return { ticket, messages, files, admin };
  });

export const replyTicket = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Сообщение пустое");
    const raw = input as { id?: unknown; body?: unknown; images?: unknown };
    return { id: idOf(raw.id, "Обращение не найдено"), body: bodyOf(raw.body), images: imagesOf(raw.images) };
  })
  .handler(async ({ context, data }) => {
    await assertActive(context.userId);
    const sql = await getSql();
    const rows = await sql<{ user_id: string; status: string }>`select user_id, status from support_tickets where id = ${data.id} limit 1`;
    const ticket = rows[0];
    if (!ticket || ticket.user_id !== context.userId) throw new Error("Обращение не найдено");
    if (ticket.status === "closed") throw new Error("Обращение закрыто. Его можно открыть снова.");
    const messageId = crypto.randomUUID();
    await sql`
      insert into support_messages (id, ticket_id, author_id, body, internal)
      values (${messageId}, ${data.id}, ${context.userId}, ${data.body}, false)
    `;
    await saveImages(sql, data.id, messageId, context.userId, data.images);
    await sql`update support_tickets set status = 'open', updated_at = now() where id = ${data.id}`;
    await logEvent(sql, context.userId, "reply", data.id, "");
    return { ok: true };
  });

export const setMyTicket = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Обращение не найдено");
    const raw = input as { id?: unknown; reopen?: unknown };
    return { id: idOf(raw.id, "Обращение не найдено"), reopen: raw.reopen === true };
  })
  .handler(async ({ context, data }) => {
    await assertActive(context.userId);
    const sql = await getSql();
    const rows = await sql<{ status: string }>`
      select status from support_tickets where id = ${data.id} and user_id = ${context.userId} limit 1
    `;
    const status = rows[0]?.status;
    if (!status) throw new Error("Обращение не найдено");
    if (data.reopen) {
      if (!canReopen(status)) throw new Error("Это обращение ещё открыто");
      await sql`update support_tickets set status = 'open', closed_at = null, updated_at = now() where id = ${data.id}`;
    } else {
      await sql`update support_tickets set status = 'closed', closed_at = now(), updated_at = now() where id = ${data.id}`;
    }
    await logEvent(sql, context.userId, data.reopen ? "reopen" : "close", data.id, "");
    return { ok: true };
  });

export const listNotices = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await assertActive(context.userId);
    const sql = await getSql();
    return sql<{ id: string; title: string; body: string; created_at: string; read_at: string | null }>`
      select id, title, body, created_at::text as created_at, read_at::text as read_at
      from support_notices where user_id = ${context.userId}
      order by created_at desc limit 20
    `;
  });

export const fileReport = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Жалоба не заполнена");
    const raw = input as { targetType?: unknown; targetId?: unknown; reason?: unknown; comment?: unknown };
    return {
      targetType: targetOf(raw.targetType),
      targetId: idOf(raw.targetId, "Объект жалобы не найден"),
      reason: reasonOf(raw.reason),
      comment: clipText(raw.comment, 500),
    };
  })
  .handler(async ({ context, data }) => {
    await assertActive(context.userId);
    const sql = await getSql();
    const recent = await sql<{ n: number }>`
      select count(*)::int as n from content_reports
      where reporter_id = ${context.userId} and created_at > now() - interval '1 hour'
    `;
    const open = await sql<{ id: string }>`
      select id from content_reports
      where reporter_id = ${context.userId} and target_type = ${data.targetType} and target_id = ${data.targetId}
        and status in ('new', 'open')
      limit 1
    `;
    const blocked = reportAllowed(Number(recent[0]?.n ?? 0), open.length > 0);
    if (blocked) throw new Error(blocked);
    let authorId = "";
    let snapshot = "";
    if (data.targetType === "user") {
      const rows = await sql<{ id: string; name: string | null }>`select id, name from "user" where id = ${data.targetId} limit 1`;
      if (!rows[0]) throw new Error("Участник не найден");
      authorId = rows[0].id;
      snapshot = snapshotOf(rows[0].name || "Участник");
    } else if (data.targetType === "post") {
      const rows = await sql<{ id: string; user_id: string; body: string }>`
        select id, user_id, body from posts where id = ${data.targetId} limit 1
      `;
      if (!rows[0]) throw new Error("Запись не найдена");
      authorId = rows[0].user_id;
      snapshot = snapshotOf(rows[0].body);
    } else {
      const rows = await sql<{ id: string; user_id: string; body: string }>`
        select m.id, m.user_id, m.body
        from room_messages m
        join room_members r on r.room_id = m.room_id and r.user_id = ${context.userId}
        where m.id = ${data.targetId}
        limit 1
      `;
      if (!rows[0]) throw new Error("Сообщение не найдено");
      authorId = rows[0].user_id;
      snapshot = snapshotOf(rows[0].body);
    }
    if (authorId === context.userId) throw new Error("На себя пожаловаться нельзя");
    const priority = data.reason === "threat" || data.reason === "fraud" ? "high" : "normal";
    const id = crypto.randomUUID();
    try {
      await sql`
        insert into content_reports (id, reporter_id, target_type, target_id, author_id, reason, comment, snapshot, priority)
        values (${id}, ${context.userId}, ${data.targetType}, ${data.targetId}, ${authorId}, ${data.reason}, ${data.comment}, ${snapshot}, ${priority})
      `;
    } catch (err) {
      if (isUniqueViolation(err)) throw new Error("Вы уже отправили жалобу на это");
      throw err;
    }
    await logEvent(sql, context.userId, "report", id, data.targetType);
    return { id };
  });

export const listMySanctions = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await assertActive(context.userId);
    const sql = await getSql();
    return sql<{ id: string; kind: string; reason: string; until_at: string | null; created_at: string }>`
      select id, kind, reason, until_at::text as until_at, created_at::text as created_at
      from moderation_actions
      where target_user_id = ${context.userId} and kind <> 'dismiss'
      order by created_at desc
      limit 20
    `;
  });

export const fileAppeal = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Апелляция не заполнена");
    const raw = input as { actionId?: unknown; body?: unknown };
    return { actionId: idOf(raw.actionId, "Решение не найдено"), body: bodyOf(raw.body) };
  })
  .handler(async ({ context, data }) => {
    await assertActive(context.userId);
    const sql = await getSql();
    const rows = await sql<{ id: string }>`
      select id from moderation_actions where id = ${data.actionId} and target_user_id = ${context.userId} limit 1
    `;
    if (!rows[0]) throw new Error("Решение не найдено");
    const existing = await sql<{ id: string }>`
      select id from moderation_appeals where action_id = ${data.actionId} and user_id = ${context.userId} and status = 'new' limit 1
    `;
    if (existing.length) throw new Error("Апелляция уже отправлена");
    const id = crypto.randomUUID();
    await sql`
      insert into moderation_appeals (id, action_id, user_id, body)
      values (${id}, ${data.actionId}, ${context.userId}, ${data.body})
    `;
    await logEvent(sql, context.userId, "appeal", id, "");
    return { id };
  });

export const supportOverview = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = input && typeof input === "object" ? (input as { days?: unknown; assignee?: unknown }) : {};
    return { days: spanOf(raw.days), assignee: typeof raw.assignee === "string" && raw.assignee ? idOf(raw.assignee) : "" };
  })
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const sql = await getSql();
    const tickets = await sql<{ fresh: number; open: number; waiting: number; late: number; first_s: number | null; solve_s: number | null }>`
      select
        count(*) filter (where status = 'new')::int as fresh,
        count(*) filter (where status in ('new', 'open'))::int as open,
        count(*) filter (where status = 'waiting')::int as waiting,
        count(*) filter (where status in ('new', 'open', 'waiting') and updated_at < now() - interval '2 days')::int as late,
        avg(extract(epoch from (first_at - created_at))) filter (where first_at is not null) as first_s,
        avg(extract(epoch from (closed_at - created_at))) filter (where closed_at is not null) as solve_s
      from (
        select t.*, (
          select m.created_at from support_messages m
          where m.ticket_id = t.id and m.author_id <> t.user_id and m.internal = false
          order by m.created_at asc limit 1
        ) as first_at
        from support_tickets t
        where t.created_at > now() - (${data.days} * interval '1 day')
          and (${data.assignee} = '' or t.assignee_id = ${data.assignee})
      ) s
    `;
    const reports = await sql<{ users: number; posts: number; messages: number; high: number }>`
      select
        count(*) filter (where target_type = 'user' and status in ('new', 'open'))::int as users,
        count(*) filter (where target_type = 'post' and status in ('new', 'open'))::int as posts,
        count(*) filter (where target_type = 'message' and status in ('new', 'open'))::int as messages,
        count(*) filter (where priority = 'high' and status in ('new', 'open'))::int as high
      from content_reports
      where created_at > now() - (${data.days} * interval '1 day')
        and (${data.assignee} = '' or assignee_id = ${data.assignee})
    `;
    const actions = await sql<{ n: number }>`
      select count(*)::int as n from moderation_actions
      where created_at > now() - (${data.days} * interval '1 day')
        and (${data.assignee} = '' or actor_id = ${data.assignee})
        and kind <> 'dismiss'
    `;
    const staff = await sql<{ id: string; name: string }>`
      select u.id, coalesce(u.name, 'Админ') as name
      from members m join "user" u on u.id = m.user_id
      where m.role = 'admin'
      order by u.name
      limit 40
    `;
    const row = tickets[0];
    const rep = reports[0];
    return {
      fresh: Number(row?.fresh ?? 0),
      open: Number(row?.open ?? 0),
      waiting: Number(row?.waiting ?? 0),
      late: Number(row?.late ?? 0),
      users: Number(rep?.users ?? 0),
      posts: Number(rep?.posts ?? 0),
      messages: Number(rep?.messages ?? 0),
      high: Number(rep?.high ?? 0),
      firstHours: row?.first_s ? Math.round(Number(row.first_s) / 360) / 10 : null,
      solveHours: row?.solve_s ? Math.round(Number(row.solve_s) / 360) / 10 : null,
      decisions: Number(actions[0]?.n ?? 0),
      staff,
    };
  });

export const listDeskTickets = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = input && typeof input === "object" ? (input as { status?: unknown; q?: unknown; page?: unknown }) : {};
    const status = typeof raw.status === "string" && raw.status ? ticketStatusOf(raw.status) : "";
    return { status, q: likeOf(raw.q), page: pageOf(raw.page) };
  })
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const sql = await getSql();
    const pattern = `%${data.q}%`;
    return sql<{ id: string; category: string; subject: string; status: string; priority: string; created_at: string; updated_at: string; name: string }>`
      select t.id, t.category, t.subject, t.status, t.priority, t.created_at::text as created_at, t.updated_at::text as updated_at,
             coalesce(u.name, 'Участник') as name
      from support_tickets t
      left join "user" u on u.id = t.user_id
      where (${data.status} = '' or t.status = ${data.status})
        and (${data.q} = '' or t.subject ilike ${pattern})
      order by t.updated_at desc
      limit 20 offset ${data.page * 20}
    `;
  });

export const adminReply = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Сообщение пустое");
    const raw = input as { id?: unknown; body?: unknown; internal?: unknown };
    return { id: idOf(raw.id, "Обращение не найдено"), body: bodyOf(raw.body), internal: raw.internal === true };
  })
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const sql = await getSql();
    const rows = await sql<{ user_id: string }>`select user_id from support_tickets where id = ${data.id} limit 1`;
    const owner = rows[0]?.user_id;
    if (!owner) throw new Error("Обращение не найдено");
    await sql`
      insert into support_messages (id, ticket_id, author_id, body, internal)
      values (${crypto.randomUUID()}, ${data.id}, ${context.userId}, ${data.body}, ${data.internal})
    `;
    const next = data.internal ? "open" : "waiting";
    await sql`
      update support_tickets set status = ${next}, assignee_id = coalesce(assignee_id, ${context.userId}), updated_at = now()
      where id = ${data.id}
    `;
    await logEvent(sql, context.userId, data.internal ? "note" : "reply", data.id, "");
    if (!data.internal) void notice(owner, "Ответ поддержки", "В вашем обращении появился ответ.", data.id);
    return { ok: true };
  });

export const setTicket = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Обращение не найдено");
    const raw = input as { id?: unknown; status?: unknown; priority?: unknown; assigneeId?: unknown };
    const assigneeId = typeof raw.assigneeId === "string" && raw.assigneeId.trim() ? idOf(raw.assigneeId) : "";
    return {
      id: idOf(raw.id, "Обращение не найдено"),
      status: raw.status ? ticketStatusOf(raw.status) : "",
      priority: raw.priority ? priorityOf(raw.priority) : "",
      assigneeId,
    };
  })
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const sql = await getSql();
    if (data.assigneeId) {
      const staff = await sql<{ role: string | null }>`select role from members where user_id = ${data.assigneeId} limit 1`;
      if (staff[0]?.role !== "admin") throw new Error("Назначать можно только администратора");
    }
    const rows = await sql<{ user_id: string }>`
      update support_tickets set
        status = case when ${data.status} = '' then status else ${data.status} end,
        priority = case when ${data.priority} = '' then priority else ${data.priority} end,
        assignee_id = case when ${data.assigneeId} = '' then assignee_id else ${data.assigneeId} end,
        closed_at = case when ${data.status} in ('solved', 'closed') then coalesce(closed_at, now()) else closed_at end,
        updated_at = now()
      where id = ${data.id}
      returning user_id
    `;
    if (!rows[0]) throw new Error("Обращение не найдено");
    await logEvent(sql, context.userId, "ticket-status", data.id, data.status || data.priority || "assign");
    return { ok: true };
  });

export const listReports = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = input && typeof input === "object" ? (input as { filter?: unknown; q?: unknown; page?: unknown }) : {};
    const filter = typeof raw.filter === "string" ? raw.filter : "new";
    const allowed = ["new", "open", "high", "user", "post", "message", "mine", "done"];
    if (!allowed.includes(filter)) throw new Error("Некорректный фильтр");
    return { filter, q: likeOf(raw.q), page: pageOf(raw.page) };
  })
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const sql = await getSql();
    const pattern = `%${data.q}%`;
    return sql<{
      id: string;
      target_type: string;
      target_id: string;
      reason: string;
      comment: string;
      snapshot: string;
      status: string;
      priority: string;
      created_at: string;
      author: string;
    }>`
      select r.id, r.target_type, r.target_id, r.reason, r.comment, r.snapshot, r.status, r.priority,
             r.created_at::text as created_at, coalesce(u.name, 'Участник') as author
      from content_reports r
      left join "user" u on u.id = r.author_id
      where (
        (${data.filter} = 'new' and r.status = 'new') or
        (${data.filter} = 'open' and r.status = 'open') or
        (${data.filter} = 'high' and r.priority = 'high' and r.status in ('new', 'open')) or
        (${data.filter} = 'user' and r.target_type = 'user' and r.status in ('new', 'open')) or
        (${data.filter} = 'post' and r.target_type = 'post' and r.status in ('new', 'open')) or
        (${data.filter} = 'message' and r.target_type = 'message' and r.status in ('new', 'open')) or
        (${data.filter} = 'mine' and r.assignee_id = ${context.userId} and r.status in ('new', 'open')) or
        (${data.filter} = 'done' and r.status in ('done', 'rejected'))
      )
      and (${data.q} = '' or r.snapshot ilike ${pattern} or r.comment ilike ${pattern})
      order by case when r.priority = 'high' then 0 else 1 end, r.created_at desc
      limit 20 offset ${data.page * 20}
    `;
  });

export const decideReport = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Жалоба не найдена");
    const raw = input as { id?: unknown; action?: unknown; reason?: unknown; days?: unknown };
    const action = sanctionOf(raw.action);
    return {
      id: idOf(raw.id, "Жалоба не найдена"),
      action,
      reason: bodyOf(raw.reason, 3),
      days: action === "limit_posts" || action === "suspend" ? daysOf(raw.days ?? 1) : 0,
    };
  })
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const ping = await withTransaction(async (sql) => {
      const locked = await sql<{
        id: string;
        target_type: string;
        target_id: string;
        author_id: string | null;
        status: string;
      }>`
        update content_reports
        set status = case when ${data.action} = 'dismiss' then 'rejected' else 'done' end,
            assignee_id = ${context.userId},
            updated_at = now()
        where id = ${data.id} and status in ('new', 'open')
        returning id, target_type, target_id, author_id, status
      `;
      const report = locked[0];
      if (!report) throw new Error("Жалоба уже решена другим модератором");
      if (!sanctionFits(data.action, report.target_type)) throw new Error("Эта мера не подходит к объекту");
      const userId = report.author_id;
      if (data.action !== "dismiss" && !userId && data.action !== "hide_post" && data.action !== "delete_post") {
        throw new Error("У объекта нет автора");
      }
      if (userId && data.action !== "dismiss") {
        if (userId === context.userId) throw new Error("Себя ограничить нельзя");
        const role = await sql<{ role: string | null }>`select role from members where user_id = ${userId} limit 1`;
        if (role[0]?.role === "admin") throw new Error("Администратора ограничить нельзя");
      }
      if (data.action === "hide_post") {
        await sql`update posts set hidden_at = now() where id = ${report.target_id}`;
      } else if (data.action === "delete_post") {
        await sql`delete from posts where id = ${report.target_id} or parent_id = ${report.target_id}`;
      } else if (data.action === "limit_posts" && userId) {
        await sql`
          insert into account_limits (user_id, posts_until)
          values (${userId}, now() + (${data.days} * interval '1 day'))
          on conflict (user_id) do update set posts_until = now() + (${data.days} * interval '1 day')
        `;
      } else if (data.action === "suspend" && userId) {
        await sql`
          insert into account_limits (user_id, suspended_until)
          values (${userId}, now() + (${data.days} * interval '1 day'))
          on conflict (user_id) do update set suspended_until = now() + (${data.days} * interval '1 day')
        `;
      } else if (data.action === "ban" && userId) {
        await sql`
          insert into members (user_id, role, banned_at)
          values (${userId}, 'member', now())
          on conflict (user_id) do update set banned_at = now()
        `;
        await sql`delete from "session" where "userId" = ${userId}`;
      } else if (data.action === "lift" && userId) {
        await sql`
          insert into members (user_id, role, banned_at)
          values (${userId}, 'member', null)
          on conflict (user_id) do update set banned_at = null
        `;
        await sql`
          insert into account_limits (user_id, posts_until, suspended_until)
          values (${userId}, null, null)
          on conflict (user_id) do update set posts_until = null, suspended_until = null
        `;
      }
      const actionId = crypto.randomUUID();
      await sql`
        insert into moderation_actions (id, report_id, actor_id, target_user_id, target_type, target_id, kind, reason, until_at)
        values (
          ${actionId}, ${report.id}, ${context.userId}, ${userId}, ${report.target_type}, ${report.target_id}, ${data.action}, ${data.reason},
          case when ${data.days} > 0 then now() + (${data.days} * interval '1 day') else null end
        )
      `;
      await logEvent(sql, context.userId, "decision", report.id, data.action);
      if (!userId || data.action === "dismiss") return null;
      const title = data.action === "warn" ? "Предупреждение" : data.action === "lift" ? "Ограничение снято" : "Решение модерации";
      const body = data.action === "lift" ? "Ограничение снято." : "По жалобе принято решение. Подробности — в поддержке.";
      return { userId, title, body, actionId };
    });
    if (ping) void notice(ping.userId, ping.title, ping.body, ping.actionId);
    return { ok: true };
  });

export const dismissReports = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    if (!Array.isArray(input) || input.length < 1 || input.length > 20) throw new Error("Выберите жалобы");
    return input.map((item) => idOf(item, "Жалоба не найдена"));
  })
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const sql = await getSql();
    let n = 0;
    for (const id of data) {
      const rows = await sql<{ id: string }>`
        update content_reports set status = 'rejected', assignee_id = ${context.userId}, updated_at = now()
        where id = ${id} and status in ('new', 'open')
        returning id
      `;
      if (rows[0]) {
        n += 1;
        await logEvent(sql, context.userId, "decision", id, "dismiss");
      }
    }
    return { n };
  });

export const listSupportEvents = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => spanOf(input && typeof input === "object" ? (input as { days?: unknown }).days : input))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const sql = await getSql();
    return sql<{ id: string; kind: string; note: string; created_at: string; actor: string }>`
      select e.id, e.kind, e.note, e.created_at::text as created_at, coalesce(u.name, 'Система') as actor
      from support_events e
      left join "user" u on u.id = e.actor_id
      where e.created_at > now() - (${data} * interval '1 day')
      order by e.created_at desc
      limit 80
    `;
  });

export const listTemplates = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const sql = await getSql();
    return sql<{ id: string; title: string; body: string }>`select id, title, body from support_templates order by title limit 40`;
  });

export const saveTemplate = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Шаблон пустой");
    const raw = input as { id?: unknown; title?: unknown; body?: unknown };
    const id = typeof raw.id === "string" && raw.id.trim() ? idOf(raw.id) : crypto.randomUUID();
    return { id, title: subjectOf(raw.title), body: bodyOf(raw.body) };
  })
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const sql = await getSql();
    await sql`
      insert into support_templates (id, title, body)
      values (${data.id}, ${data.title}, ${data.body})
      on conflict (id) do update set title = ${data.title}, body = ${data.body}, updated_at = now()
    `;
    await logEvent(sql, context.userId, "template", data.id, data.title);
    return { id: data.id };
  });

export const listAppeals = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const sql = await getSql();
    return sql<{ id: string; body: string; status: string; created_at: string; kind: string; name: string }>`
      select a.id, a.body, a.status, a.created_at::text as created_at, m.kind, coalesce(u.name, 'Участник') as name
      from moderation_appeals a
      join moderation_actions m on m.id = a.action_id
      left join "user" u on u.id = a.user_id
      where a.status = 'new'
      order by a.created_at asc
      limit 30
    `;
  });

export const resolveAppeal = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Апелляция не найдена");
    const raw = input as { id?: unknown; lift?: unknown };
    return { id: idOf(raw.id, "Апелляция не найдена"), lift: raw.lift === true };
  })
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const sql = await getSql();
    const rows = await sql<{ id: string; user_id: string; action_id: string }>`
      update moderation_appeals set status = ${data.lift ? "lifted" : "kept"}
      where id = ${data.id} and status = 'new'
      returning id, user_id, action_id
    `;
    const appeal = rows[0];
    if (!appeal) throw new Error("Апелляция уже рассмотрена");
    if (data.lift) {
      const action = await sql<{ target_user_id: string | null }>`select target_user_id from moderation_actions where id = ${appeal.action_id} limit 1`;
      const userId = action[0]?.target_user_id;
      if (userId) {
        await sql`update members set banned_at = null where user_id = ${userId}`;
        await sql`update account_limits set posts_until = null, suspended_until = null where user_id = ${userId}`;
      }
    }
    await logEvent(sql, context.userId, "appeal-decision", appeal.id, data.lift ? "lift" : "kept");
    void notice(appeal.user_id, "Апелляция рассмотрена", data.lift ? "Ограничение снято." : "Решение оставлено в силе.", appeal.id);
    return { ok: true };
  });

export const claimReport = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => idOf(input, "Жалоба не найдена"))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const sql = await getSql();
    const rows = await sql<{ id: string }>`
      update content_reports
      set status = 'open', assignee_id = ${context.userId}, updated_at = now()
      where id = ${data} and status in ('new', 'open')
      returning id
    `;
    if (!rows[0]) throw new Error("Жалоба уже решена другим модератором");
    await logEvent(sql, context.userId, "claim", data, "");
    return { ok: true };
  });

export const deleteTemplate = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => idOf(input, "Шаблон не найден"))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const sql = await getSql();
    const rows = await sql<{ id: string }>`delete from support_templates where id = ${data} returning id`;
    if (!rows[0]) throw new Error("Шаблон не найден");
    await logEvent(sql, context.userId, "template", data, "delete");
    return { ok: true };
  });
