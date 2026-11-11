import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { assertActive } from "@/lib/social/access";

export const ACHIEVEMENTS = [
  { code: "mail", title: "Почта", text: "Подтвердить адрес", reward: 100 },
  { code: "place", title: "Место", text: "Указать страну или город", reward: 40 },
  { code: "hello", title: "Первое слово", text: "Написать в переписке", reward: 50 },
  { code: "writer", title: "Десять писем", text: "Отправить десять сообщений", reward: 120 },
  { code: "friend", title: "Свой человек", text: "Добавить друга", reward: 80 },
  { code: "file", title: "Вложение", text: "Отправить файл", reward: 60 },
  { code: "post", title: "Запись", text: "Опубликовать в ленте", reward: 70 },
  { code: "book", title: "Полка", text: "Добавить книгу", reward: 80 },
] as const;

export type AchievementCode = (typeof ACHIEVEMENTS)[number]["code"];

export type AchievementItem = (typeof ACHIEVEMENTS)[number] & { done: boolean };

function yes(value: unknown): boolean {
  return value === true || value === "t" || value === "true" || value === 1;
}

export async function grantAchievement(userId: string, code: AchievementCode): Promise<void> {
  const item = ACHIEVEMENTS.find((row) => row.code === code);
  if (!item) return;
  try {
    const sql = await getSql();
    const id = crypto.randomUUID();
    await sql`
      with won as (
        insert into achievements (user_id, code)
        values (${userId}, ${code})
        on conflict (user_id, code) do nothing
        returning user_id
      ),
      paid as (
        insert into wallets (user_id, balance, last_grant_at)
        select user_id, ${item.reward}, now() from won
        on conflict (user_id) do update set balance = wallets.balance + ${item.reward}
        returning user_id
      )
      insert into wallet_transfers (id, from_id, to_id, amount, note)
      select ${id}, null::text, user_id, ${item.reward}, ${"Достижение"}
      from paid
    `;
  } catch {
    /* a missing table must not break the action that earned it */
  }
}

async function settleEarned(userId: string): Promise<void> {
  const sql = await getSql();
  const rows = await sql<{
    mail: unknown;
    place: unknown;
    messages: number | string;
    friend: unknown;
    file: unknown;
    post: unknown;
    book: unknown;
  }>`
    select
      coalesce((select "emailVerified" from "user" where id = ${userId}), false) as mail,
      exists(
        select 1 from profile_facts
        where user_id = ${userId} and (country <> '' or city <> '')
      ) as place,
      (select count(*)::int from room_messages where user_id = ${userId}) as messages,
      exists(
        select 1 from friend_links
        where status = 'accepted' and (from_id = ${userId} or to_id = ${userId})
      ) as friend,
      (
        exists(select 1 from room_files where user_id = ${userId})
        or exists(select 1 from file_uploads where user_id = ${userId} and received = size)
      ) as file,
      exists(select 1 from posts where user_id = ${userId} and parent_id is null) as post,
      exists(select 1 from shelf_books where owner_id = ${userId}) as book
  `;
  const row = rows[0];
  if (!row) return;
  const sent = Number(row.messages ?? 0);
  const due: AchievementCode[] = [];
  if (yes(row.mail)) due.push("mail");
  if (yes(row.place)) due.push("place");
  if (sent >= 1) due.push("hello");
  if (sent >= 10) due.push("writer");
  if (yes(row.friend)) due.push("friend");
  if (yes(row.file)) due.push("file");
  if (yes(row.post)) due.push("post");
  if (yes(row.book)) due.push("book");
  for (const code of due) await grantAchievement(userId, code);
}

function blank() {
  const items: AchievementItem[] = ACHIEVEMENTS.map((item) => ({ ...item, done: false }));
  return { items, done: 0, total: items.length, earned: 0 };
}

export const getAchievements = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await assertActive(context.userId);
    try {
      await settleEarned(context.userId);
      const sql = await getSql();
      const rows = await sql<{ code: string }>`
        select code from achievements where user_id = ${context.userId}
      `;
      const have = new Set(rows.map((row) => row.code));
      const items: AchievementItem[] = ACHIEVEMENTS.map((item) => ({ ...item, done: have.has(item.code) }));
      const earned = items.reduce((sum, item) => sum + (item.done ? item.reward : 0), 0);
      return { items, done: items.filter((item) => item.done).length, total: items.length, earned };
    } catch {
      return blank();
    }
  });
