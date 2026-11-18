import { openBotToken, sealBotToken } from "@/lib/social/telegram-secret.server";
import { waitUntil } from "@vercel/functions";
import { commandOf, privateActor, safeBotError } from "@/lib/social/telegram-core";
import { ensureTelegramWorkspace } from "@/lib/social/telegram-schema.server";
import { withTransaction } from "@/lib/db";
import { getSql } from "@/lib/db";
import { entryName } from "@/lib/social/mega-plan";
import { storeMegaBytes } from "@/lib/social/mega";

const HOOK = "https://vvvion.space/api/telegram";
const USER_RE = /^[A-Za-z0-9_]{3,32}$/;

type Tg<T> = { ok: boolean; description?: string; result?: T };

function makeSecret() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function makeCode() {
  const alphabet = "abcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += alphabet[byte % alphabet.length] ?? "a";
  return out;
}

function sameSecret(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function oneLine(text: string, max = 120) {
  // eslint-disable-next-line no-control-regex -- Strip forbidden control bytes from untrusted input.
  const clean = text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}

function clip(text: string) {
  const clean = text
    // eslint-disable-next-line no-control-regex -- Strip forbidden control bytes from untrusted input.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (clean.length <= 3500) return clean;
  return `${clean.slice(0, 3490)}…`;
}

export async function tg<T>(
  token: string,
  method: string,
  body?: Record<string, unknown>,
): Promise<Tg<T>> {
  try {
    token = openBotToken(token);
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(8000),
    });
    const data = (await res.json().catch(() => null)) as Tg<T> | null;
    if (!data || typeof data.ok !== "boolean") return { ok: false };
    return data;
  } catch {
    return { ok: false };
  }
}

export async function readBotPublic(): Promise<{ configured: boolean; username: string }> {
  const sql = await getSql();
  const rows = await sql<{
    username: string;
  }>`select username from telegram_bot where id = 1 and token <> ''`;
  const username = rows[0]?.username ?? "";
  return { configured: Boolean(username), username };
}

export async function connectBot(token: string): Promise<string> {
  const me = await tg<{ username?: string; is_bot?: boolean }>(token, "getMe");
  const username = me.result?.username ?? "";
  if (!me.ok || !me.result?.is_bot || !USER_RE.test(username)) {
    throw new Error("Telegram не принял токен. Скопируйте его у BotFather целиком.");
  }
  const storedToken = sealBotToken(token);
  const secret = makeSecret();
  const hook = await tg<boolean>(token, "setWebhook", {
    url: HOOK,
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: false,
  });
  if (!hook.ok)
    throw new Error("Токен верный, но Telegram не принял адрес уведомлений. Попробуйте ещё раз.");
  await installBotMenu(token);
  const sql = await getSql();
  const prev = await sql<{ username: string }>`select username from telegram_bot where id = 1`;
  if (prev[0] && prev[0].username !== username) {
    await sql`delete from telegram_links`;
    await sql`delete from telegram_codes`;
  }
  await sql`
    insert into telegram_bot (id, token, username, secret, updated_at)
    values (1, ${storedToken}, ${username}, ${secret}, now())
    on conflict (id) do update
      set token = excluded.token,
          username = excluded.username,
          secret = excluded.secret,
          updated_at = now()
  `;
  return username;
}

export async function disconnectBot() {
  const sql = await getSql();
  const rows = await sql<{ token: string }>`select token from telegram_bot where id = 1`;
  const token = rows[0]?.token ?? "";
  await sql`delete from telegram_links`;
  await sql`delete from telegram_codes`;
  await sql`delete from telegram_bot where id = 1`;
  if (token) await tg(token, "deleteWebhook", { drop_pending_updates: false });
}

export async function readLink(userId: string) {
  const sql = await getSql();
  const bots = await sql<{
    username: string;
  }>`select username from telegram_bot where id = 1 and token <> ''`;
  const links = await sql<{
    username: string;
  }>`select username from telegram_links where user_id = ${userId}`;
  return {
    configured: Boolean(bots[0]?.username),
    username: bots[0]?.username ?? "",
    linked: links.length > 0,
    handle: links[0]?.username ?? "",
  };
}

export async function issueLink(userId: string): Promise<{ url: string; username: string }> {
  const sql = await getSql();
  const bots = await sql<{
    username: string;
  }>`select username from telegram_bot where id = 1 and token <> ''`;
  const username = bots[0]?.username ?? "";
  if (!USER_RE.test(username)) throw new Error("Администратор ещё не подключил бота");
  const code = makeCode();
  await sql`delete from telegram_codes where user_id = ${userId} or expires_at < now()`;
  await sql`
    insert into telegram_codes (code, user_id, expires_at)
    values (${code}, ${userId}, now() + interval '15 minutes')
  `;
  return { url: `https://t.me/${username}?start=${code}`, username };
}

export async function forgetLink(userId: string) {
  const sql = await getSql();
  await sql`delete from telegram_links where user_id = ${userId}`;
  await sql`delete from telegram_codes where user_id = ${userId}`;
}

export async function notifyUser(userId: string, text: string) {
  try {
    const clean = clip(text);
    if (!clean || !userId) return;
    const sql = await getSql();
    const bots = await sql<{ token: string }>`select token from telegram_bot where id = 1`;
    const token = bots[0]?.token;
    if (!token) return;
    const links = await sql<{
      chat_id: string;
    }>`select chat_id from telegram_links where user_id = ${userId}`;
    const chatId = links[0]?.chat_id ?? "";
    if (!/^-?\d{1,20}$/.test(chatId)) return;
    await tg(token, "sendMessage", {
      chat_id: chatId,
      text: clean,
      disable_web_page_preview: true,
    });
  } catch {
    /* уведомление не должно ломать само действие */
  }
}

async function displayName(userId: string) {
  const sql = await getSql();
  const rows = await sql<{ name: string }>`
    select coalesce(nullif(name, ''), 'Участник') as name from "user" where id = ${userId}
  `;
  return rows[0]?.name || "Участник";
}

export async function senderName(userId: string) {
  try {
    return await displayName(userId);
  } catch {
    return "Участник";
  }
}

type TgChat = { id?: number | string; type?: string };
type TgFrom = { id?: number | string; username?: string };
type TgFile = {
  file_id?: string;
  file_unique_id?: string;
  file_size?: number;
  file_name?: string;
  mime_type?: string;
};
type TgMessage = {
  text?: string;
  caption?: string;
  chat?: TgChat;
  from?: TgFrom;
  document?: TgFile;
  photo?: TgFile[];
  video?: TgFile;
  audio?: TgFile;
  voice?: TgFile;
  video_note?: TgFile;
};
type TgCallback = {
  from?: TgFrom;
  id?: string;
  data?: string;
  message?: { chat?: TgChat };
};
type TgUpdate = { update_id?: number; message?: TgMessage; callback_query?: TgCallback };

type Btn = { text: string; data?: string; url?: string };
export type Key = Btn[][];

const COMMANDS = [
  { command: "ai", description: "Чат с моделями сайта" },
  { command: "models", description: "Выбрать ИИ-модель" },
  { command: "new", description: "Новый ИИ-диалог" },
  { command: "chats", description: "Продолжить диалог с сайта" },
  { command: "stop", description: "Выйти из режима ИИ" },
  { command: "bank", description: "Банк и последние операции" },
  { command: "topup", description: "Пополнить общий баланс" },
  { command: "books", description: "Книги на полке" },
  { command: "videos", description: "Ролики в смотрельне" },
  { command: "files", description: "Диск и Мегадиск" },
  { command: "profile", description: "Мой аккаунт" },
  { command: "admin", description: "Пульт администратора" },
  { command: "menu", description: "Меню" },
  { command: "balance", description: "Сколько вублей" },
  { command: "grant", description: "Забрать дневные 100" },
  { command: "friends", description: "Список друзей" },
  { command: "requests", description: "Заявки в друзья" },
  { command: "unread", description: "Непрочитанные сообщения" },
  { command: "feed", description: "Последнее в ленте" },
  { command: "say", description: "Написать другу: /say Имя текст" },
  { command: "note", description: "Короткая записка дня" },
  { command: "release", description: "Что в последнем выпуске" },
  { command: "disk", description: "Положить файл на мегадиск" },
  { command: "unlink", description: "Отвязать этот чат" },
  { command: "help", description: "Что умеет бот" },
];

const NOTES = [
  "Две одинаковые вещи на прилавке складываются в одну старше.",
  "Мешок отдаёт вещь за единицу энергии. Энергия сама возвращается.",
  "С прилавка в сутки уходит не больше 60 вублей.",
  "Дневные 100 приходят ссылкой: её нужно открыть и подтвердить.",
  "Заявку в друзья можно принять кнопкой, не заходя на сайт.",
  "Другу пишут так: /say Имя и дальше текст.",
  "Непрочитанное считается только по диалогам, которые вы ещё не открывали.",
  "Золотая рамка на аватарке — это администратор круга.",
];

export const MENU: Key = [
  [
    { text: "✦ ИИ-чат", data: "go:ai" },
    { text: "Модели", data: "go:models" },
  ],
  [
    { text: "Банк", data: "go:bank" },
    { text: "Пополнить", data: "go:topup" },
  ],
  [
    { text: "Книги", data: "go:books" },
    { text: "Ролики", data: "go:videos" },
  ],
  [
    { text: "Мои файлы", data: "go:files" },
    { text: "Профиль", data: "go:profile" },
  ],
  [
    { text: "Баланс", data: "go:balance" },
    { text: "Забрать 100", data: "go:grant" },
  ],
  [
    { text: "Друзья", data: "go:friends" },
    { text: "Заявки", data: "go:requests" },
  ],
  [
    { text: "Новые", data: "go:unread" },
    { text: "Лента", data: "go:feed" },
  ],
  [
    { text: "Мегадиск", data: "go:disk" },
    { text: "Выпуск", data: "go:release" },
  ],
  [{ text: "Написать", data: "go:say" }],
  [{ text: "Открыть круг", url: "https://vvvion.space/c/messages" }],
];

function chatIdOf(chat?: TgChat): string {
  const id = chat?.id == null ? "" : String(chat.id);
  return /^-?\d{1,20}$/.test(id) ? id : "";
}

export async function say(token: string, chatId: string, text: string, keyboard?: Key) {
  const result = await tg(token, "sendMessage", {
    chat_id: chatId,
    text: clip(text),
    disable_web_page_preview: true,
    reply_markup: keyboard
      ? {
          inline_keyboard: keyboard.map((row) =>
            row.map((btn) =>
              btn.url
                ? { text: btn.text, url: btn.url }
                : { text: btn.text, callback_data: btn.data ?? "go:menu" },
            ),
          ),
        }
      : undefined,
  });
  if (!result.ok)
    throw new Error(
      "Telegram не доставил сообщение. Ответ сохранён в истории сайта, если он уже был получен.",
    );
}

async function ack(token: string, id: string, text?: string) {
  if (!id) return;
  await tg(token, "answerCallbackQuery", {
    callback_query_id: id,
    text: text ? oneLine(text, 180) : undefined,
  });
}

export async function installBotMenu(token: string) {
  const results = await Promise.all([
    tg(token, "setMyCommands", { commands: COMMANDS }),
    tg(token, "setChatMenuButton", { menu_button: { type: "commands" } }),
    tg(token, "setMyDescription", {
      description:
        "VVVion Space: ИИ-модели, общая история диалогов, банк, книги, ролики, файлы и уведомления. Привяжите аккаунт в профиле сайта. Пароль боту не нужен.",
    }),
    tg(token, "setMyShortDescription", {
      short_description: "Ваш VVVion Space в Telegram · ИИ, банк, книги и файлы",
    }),
  ]);
  return results.every((r) => r.ok);
}

async function linkedUser(chatId: string): Promise<string | null> {
  const sql = await getSql();
  const rows = await sql<{
    user_id: string;
  }>`select user_id from telegram_links where chat_id = ${chatId}`;
  return rows[0]?.user_id ?? null;
}

async function banned(userId: string): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql<{
    banned_at: string | null;
  }>`select banned_at from members where user_id = ${userId}`;
  return Boolean(rows[0]?.banned_at);
}

function dayLine(userId: string): string {
  const day = new Date().toISOString().slice(0, 10);
  let hash = 0;
  const seed = `${userId}:${day}`;
  for (let i = 0; i < seed.length; i += 1) hash = (Math.imul(hash, 33) + seed.charCodeAt(i)) >>> 0;
  return NOTES[hash % NOTES.length] || NOTES[0];
}

function leftLabel(ms: number): string {
  const left = ms - Date.now();
  if (left <= 0) return "уже можно: кнопка «Забрать 100» пришлёт ссылку на карту";
  const hours = Math.floor(left / 3_600_000);
  const minutes = Math.floor((left % 3_600_000) / 60_000);
  if (hours > 0) return `через ${hours} ч ${minutes} мин`;
  return `через ${Math.max(1, minutes)} мин`;
}

async function textBalance(userId: string): Promise<string> {
  const sql = await getSql();
  const rows = await sql<{ balance: number; grant_ms: number | string }>`
    select balance, (extract(epoch from last_grant_at) * 1000) as grant_ms
    from wallets
    where user_id = ${userId}
  `;
  const row = rows[0];
  if (!row) return "Карты ещё нет. Нажмите «Забрать 100» — первая тысяча вублей появится сама.";
  let stall = "";
  try {
    const earned = await sql<{ n: number }>`
      select coalesce(sum(amount), 0)::int as n
      from game_payouts
      where user_id = ${userId} and game = 'stall' and created_at > now() - interval '24 hours'
    `;
    stall = `\nС прилавка за сутки: ${Number(earned[0]?.n ?? 0)} из 60.`;
  } catch {
    stall = "";
  }
  const grant = Math.round(Number(row.grant_ms)) + 24 * 60 * 60 * 1000;
  return `На карте ${Number(row.balance)} вублей.\nЕжедневные 100 — ${leftLabel(grant)}.${stall}`;
}

async function textFriends(userId: string): Promise<string> {
  const sql = await getSql();
  const rows = await sql<{ name: string | null }>`
    select coalesce(u.name, 'Участник') as name
    from friend_links f
    join "user" u on u.id = case when f.from_id = ${userId} then f.to_id else f.from_id end
    where f.status = 'accepted' and (f.from_id = ${userId} or f.to_id = ${userId})
    order by u.name asc
    limit 20
  `;
  if (!rows.length) return "Друзей пока нет. Искать людей можно в сообщениях на сайте.";
  return `Друзья, ${rows.length}:\n${rows.map((row) => `— ${row.name || "Участник"}`).join("\n")}`;
}

async function textRequests(userId: string): Promise<{ text: string; keyboard?: Key }> {
  const sql = await getSql();
  const rows = await sql<{ id: string; name: string | null }>`
    select f.from_id as id, coalesce(u.name, 'Участник') as name
    from friend_links f
    join "user" u on u.id = f.from_id
    where f.to_id = ${userId} and f.status = 'pending'
    order by f.created_at asc
    limit 6
  `;
  if (!rows.length) return { text: "Входящих заявок нет." };
  const keyboard: Key = [];
  for (const row of rows) {
    const yes = `y:${row.id}`;
    const no = `n:${row.id}`;
    if (yes.length > 64 || no.length > 64) continue;
    keyboard.push([
      { text: `Принять ${row.name || "заявку"}`, data: yes },
      { text: "Нет", data: no },
    ]);
  }
  return { text: `Заявок: ${rows.length}. Можно ответить кнопкой.`, keyboard };
}

async function textUnread(userId: string): Promise<string> {
  const sql = await getSql();
  const count = await sql<{ n: number }>`
    select count(*) as n
    from room_messages msg
    join room_members me on me.room_id = msg.room_id and me.user_id = ${userId}
    where msg.user_id <> ${userId}
      and msg.created_at > me.last_read_at
  `;
  const n = Number(count[0]?.n ?? 0);
  if (!n) return "Непрочитанных сообщений нет.";
  const rows = await sql<{
    title: string | null;
    kind: string;
    body: string | null;
    name: string | null;
  }>`
    select r.kind, r.title, msg.body, coalesce(u.name, 'Участник') as name
    from room_messages msg
    join rooms r on r.id = msg.room_id
    join room_members me on me.room_id = r.id and me.user_id = ${userId}
    left join "user" u on u.id = msg.user_id
    where msg.user_id <> ${userId}
      and msg.created_at > me.last_read_at
    order by msg.created_at desc
    limit 3
  `;
  const lines = rows.map((row) => {
    const who = row.kind === "group" ? row.title || "Группа" : row.name || "Диалог";
    const body = (row.body || "").trim();
    const preview = body ? oneLine(body, 80) : "Вложение";
    return `${who}: ${preview}`;
  });
  return `Непрочитанных: ${n}.\n${lines.join("\n")}`;
}

function textNote(userId: string): string {
  return dayLine(userId);
}

async function textFeed(): Promise<string> {
  const sql = await getSql();
  const rows = await sql<{ name: string | null; body: string | null; files: number }>`
    select coalesce(u.name, 'Участник') as name,
           p.body,
           (select count(*)::int from post_files f where f.post_id = p.id) as files
    from posts p
    left join "user" u on u.id = p.user_id
    order by p.created_at desc
    limit 3
  `;
  if (!rows.length) return "В ленте пока пусто.";
  const lines = rows.map((row) => {
    const body = (row.body || "").trim();
    const preview = body ? oneLine(body, 90) : Number(row.files) ? "Вложение" : "Запись";
    return `${row.name || "Участник"}: ${preview}`;
  });
  return `Последнее в ленте:\n${lines.join("\n")}`;
}

async function takeDaily(userId: string): Promise<string> {
  const sql = await getSql();
  const rows = await sql<{ grant_ms: number | string }>`
    select (extract(epoch from last_grant_at) * 1000) as grant_ms
    from wallets
    where user_id = ${userId}
  `;
  const grant = rows[0] ? Math.round(Number(rows[0].grant_ms)) + 24 * 60 * 60 * 1000 : 0;
  if (rows[0] && grant > Date.now()) return textBalance(userId);
  const { issueCheckinLink } = await import("@/lib/social/checkin.server");
  return issueCheckinLink(userId);
}

async function friendRows(userId: string): Promise<{ id: string; name: string }[]> {
  const sql = await getSql();
  return sql<{ id: string; name: string }>`
    select u.id, coalesce(nullif(u.name, ''), 'Участник') as name
    from friend_links f
    join "user" u on u.id = case when f.from_id = ${userId} then f.to_id else f.from_id end
    where f.status = 'accepted' and (f.from_id = ${userId} or f.to_id = ${userId})
    order by u.name asc
    limit 40
  `;
}

async function textSayHint(userId: string): Promise<string> {
  const rows = await friendRows(userId);
  const names = rows
    .map((row) => row.name)
    .filter(Boolean)
    .slice(0, 8);
  const list = names.length
    ? `\n\nДрузья: ${names.join(", ")}`
    : "\n\nДрузей пока нет — писать некому.";
  return `Одной строкой:\n/say Имя текст сообщения${list}`;
}

async function roomWith(userId: string, peerId: string): Promise<string> {
  const sql = await getSql();
  const key = [userId, peerId].sort().join("|");
  const existing = await sql<{ id: string }>`select id from rooms where dm_key = ${key}`;
  let roomId = existing[0]?.id ?? "";
  if (!roomId) {
    const fresh = crypto.randomUUID();
    const inserted = await sql<{ id: string }>`
      insert into rooms (id, kind, dm_key, created_by)
      values (${fresh}, 'dm', ${key}, ${userId})
      on conflict (dm_key) do nothing
      returning id
    `;
    roomId =
      inserted[0]?.id ||
      (await sql<{ id: string }>`select id from rooms where dm_key = ${key}`)[0]?.id ||
      "";
  }
  if (!roomId) throw new Error("Диалог не открылся");
  await sql`insert into room_members (room_id, user_id) values (${roomId}, ${userId}) on conflict do nothing`;
  await sql`insert into room_members (room_id, user_id) values (${roomId}, ${peerId}) on conflict do nothing`;
  return roomId;
}

async function sendToFriend(userId: string, arg: string): Promise<string> {
  const text = arg.trim();
  if (!text) return textSayHint(userId);
  const friends = await friendRows(userId);
  if (!friends.length) return "Друзей пока нет. Искать людей можно в сообщениях на сайте.";
  const lower = text.toLocaleLowerCase("ru");
  const matches = friends
    .filter((friend) => lower.startsWith(`${friend.name.toLocaleLowerCase("ru")} `))
    .sort((a, b) => b.name.length - a.name.length);
  const hit = matches[0];
  if (!hit) return textSayHint(userId);
  const same = matches.filter(
    (friend) => friend.name.toLocaleLowerCase("ru") === hit.name.toLocaleLowerCase("ru"),
  );
  if (same.length > 1) return "Несколько друзей с таким именем. Напишите им на сайте.";
  const body = text.slice(hit.name.length).trim().slice(0, 400);
  if (!body) return "После имени нужен текст.";
  const sql = await getSql();
  const recent = await sql<{ n: number }>`
    select count(*)::int as n from room_messages
    where user_id = ${userId} and created_at > now() - interval '10 minutes'
  `;
  if (Number(recent[0]?.n ?? 0) >= 20) return "Слишком много сообщений. Подождите немного.";
  const roomId = await roomWith(userId, hit.id);
  const id = crypto.randomUUID();
  await sql`
    insert into room_messages (id, room_id, user_id, body)
    values (${id}, ${roomId}, ${userId}, ${body})
  `;
  await sql`update rooms set updated_at = now() where id = ${roomId}`;
  await sql`
    update room_members set last_read_at = now()
    where room_id = ${roomId} and user_id = ${userId}
  `;
  const name = await displayName(userId);
  void notifyUser(hit.id, `Сообщение от ${name}:\n${body}`);
  return `Отправлено ${hit.name}: ${oneLine(body, 140)}`;
}

async function textRelease(): Promise<string> {
  const { RELEASE, NOTES: notes } = await import("@/lib/release");
  const latest = notes[0];
  if (!latest) return `Сейчас ${RELEASE}. Журнал: https://vvvion.space/updates`;
  return `${latest.version}. ${latest.title}.\n${latest.lead}\nhttps://vvvion.space/updates`;
}

async function runAction(token: string, chatId: string, userId: string, action: string) {
  if (await banned(userId)) {
    await say(token, chatId, "Аккаунт заблокирован. Бот для этого входа молчит.");
    return;
  }
  const { workspaceAction } = await import("@/lib/social/telegram-workspace.server");
  if (await workspaceAction(token, chatId, userId, action)) return;
  if (action === "balance") {
    await say(token, chatId, await textBalance(userId), MENU);
    return;
  }
  if (action === "grant") {
    await say(token, chatId, await takeDaily(userId), MENU);
    return;
  }
  if (action === "friends") {
    await say(token, chatId, await textFriends(userId), MENU);
    return;
  }
  if (action === "requests") {
    const page = await textRequests(userId);
    await say(token, chatId, page.text, page.keyboard ?? MENU);
    return;
  }
  if (action === "unread") {
    await say(token, chatId, await textUnread(userId), MENU);
    return;
  }
  if (action === "feed") {
    await say(token, chatId, await textFeed(), MENU);
    return;
  }
  if (action === "say") {
    await say(token, chatId, await textSayHint(userId), MENU);
    return;
  }
  if (action === "note") {
    await say(token, chatId, textNote(userId), MENU);
    return;
  }
  if (action === "release") {
    await say(token, chatId, await textRelease(), MENU);
    return;
  }
  if (action === "disk") {
    await say(
      token,
      chatId,
      "Пришлите сюда файл, фото, видео или аудио — положу в корень мегадиска. Telegram отдаёт боту не больше 20 МБ. Более тяжёлое отправляйте с сайта: если сеть моргнёт, кусок повторится сам, загрузка не начнётся с нуля.",
      MENU,
    );
    return;
  }
  if (action === "menu" || action === "help") {
    await say(
      token,
      chatId,
      action === "help"
        ? "VVVion Space в Telegram\n\n/ai — включить ИИ-чат\n/models — модели сайта\n/new — начать новый диалог\n/chats — продолжить историю с сайта\n/stop — выйти из ИИ-чата\n/bank и /topup — общий кошелёк и пополнение\n/books и /videos — библиотека и ролики\n/files — диск и Мегадиск\n/say Имя текст — написать другу\n\nФайлы до 20 МБ сохраняются на Мегадиск. /grant — ссылка на ежедневный бонус. Пароли и платёжные данные сюда не отправляйте."
        : `Что открыть?\n${dayLine(userId)}`,
      MENU,
    );
    return;
  }
  if (action === "unlink") {
    await say(token, chatId, "Отвязать этот чат от аккаунта?", [
      [{ text: "Отвязать", data: "unlink" }],
    ]);
    return;
  }
  await say(token, chatId, "Такой команды нет. Откройте меню или напишите /help.", MENU);
}

async function decideFriend(userId: string, fromId: string, accept: boolean): Promise<string> {
  if (!fromId || fromId.length > 128 || /[\s"'<>]/.test(fromId) || fromId === userId)
    return "Заявка не найдена.";
  const sql = await getSql();
  if (!accept) {
    await sql`
      delete from friend_links
      where from_id = ${fromId} and to_id = ${userId} and status = 'pending'
    `;
    return "Заявку убрали.";
  }
  const updated = await sql<{ from_id: string }>`
    update friend_links set status = 'accepted'
    where from_id = ${fromId} and to_id = ${userId} and status = 'pending'
    returning from_id
  `;
  if (!updated.length) return "Этой заявки уже нет.";
  const name = await displayName(userId);
  void notifyUser(fromId, `Вас добавили в друзья: ${name}.`);
  return "Теперь вы друзья.";
}

const TG_FILE = 20 * 1024 * 1024;

function fileOf(
  message: TgMessage,
): { id: string; unique: string; name: string; mime: string; size: number } | null {
  const pick = (file: TgFile | undefined, name: string, mime: string) => {
    const id = file?.file_id?.trim() || "";
    if (id.length < 8 || id.length > 256 || /\s/.test(id)) return null;
    return {
      id,
      unique: (file?.file_unique_id || id).slice(0, 128),
      name: (file?.file_name || name).slice(0, 80),
      mime: (file?.mime_type || mime).slice(0, 120),
      size: Number(file?.file_size) || 0,
    };
  };
  return (
    pick(message.document, "Файл", "application/octet-stream") ||
    pick(
      message.video,
      message.video?.file_name || "Видео.mp4",
      message.video?.mime_type || "video/mp4",
    ) ||
    pick(
      message.audio,
      message.audio?.file_name || "Аудио.mp3",
      message.audio?.mime_type || "audio/mpeg",
    ) ||
    pick(message.voice, "Голосовое.ogg", message.voice?.mime_type || "audio/ogg") ||
    pick(message.video_note, "Кружок.mp4", "video/mp4") ||
    pick(message.photo?.at(-1), "Фото.jpg", "image/jpeg")
  );
}

async function pullTelegram(token: string, fileId: string): Promise<Uint8Array> {
  token = openBotToken(token);
  let last = "Telegram не отдал файл";
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const meta = await tg<{ file_path?: string; file_size?: number }>(token, "getFile", {
        file_id: fileId,
      });
      const path = meta.result?.file_path || "";
      const size = Number(meta.result?.file_size) || 0;
      if (!meta.ok || !path || path.includes("..") || path.startsWith("/") || path.includes("://"))
        throw new Error(last);
      if (size > TG_FILE)
        throw new Error(
          "Telegram отдаёт боту файлы только до 20 МБ. Этот больше — загрузите его на сайте.",
        );
      const res = await fetch(`https://api.telegram.org/file/bot${token}/${path}`, {
        signal: AbortSignal.timeout(55_000),
      });
      if (!res.ok) throw new Error(last);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength < 1) throw new Error("Файл пустой");
      if (bytes.byteLength > TG_FILE)
        throw new Error(
          "Telegram отдаёт боту файлы только до 20 МБ. Этот больше — загрузите его на сайте.",
        );
      return bytes;
    } catch (error) {
      const message = error instanceof Error ? error.message : last;
      if (/20 МБ|пустой/i.test(message)) throw new Error(message);
      last = message;
      if (attempt + 1 >= 4) break;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw new Error(last);
}

async function keepOnMega(
  token: string,
  chatId: string,
  userId: string,
  file: { id: string; name: string; mime: string; size: number },
) {
  let label = "Файл";
  try {
    label = entryName(file.name);
  } catch {
    label = "Файл";
  }
  if (file.size > TG_FILE) {
    await say(
      token,
      chatId,
      "Telegram отдаёт боту файлы только до 20 МБ. Этот больше — загрузите его на сайте.",
      MENU,
    );
    return;
  }
  const sql = await getSql();
  const fresh = await sql<{ status: string }>`
    select status from mega_entries
    where user_id = ${userId} and name = ${label} and created_at > now() - interval '15 minutes'
    order by created_at desc
    limit 1
  `;
  if (fresh[0]?.status === "ok") {
    await say(token, chatId, `Уже на мегадиске: ${label}`, MENU);
    return;
  }
  if (fresh[0]?.status === "up") {
    await say(token, chatId, "Этот файл ещё едет. Подождите и не присылайте его второй раз.", MENU);
    return;
  }
  await tg(token, "sendChatAction", { chat_id: chatId, action: "upload_document" });
  await say(token, chatId, `Принимаю «${oneLine(label, 60)}» и кладу в корень мегадиска.`);
  try {
    const bytes = await pullTelegram(token, file.id);
    const saved = await storeMegaBytes(userId, label, file.mime, bytes);
    await say(token, chatId, `На мегадиске: ${saved.name}`, MENU);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Файл не лёг на мегадиск";
    await say(token, chatId, message, MENU);
  }
}

export async function handleTelegram(request: Request): Promise<Response> {
  const sql = await getSql();
  const bots = await sql<{
    token: string;
    secret: string;
    username: string;
  }>`select token, secret, username from telegram_bot where id = 1`;
  const bot = bots[0];
  if (!bot?.token || !bot.secret) {
    return new Response(JSON.stringify({ ok: false }), {
      status: 404,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }
  const header = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!sameSecret(header, bot.secret)) {
    return new Response(JSON.stringify({ ok: false }), {
      status: 404,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }
  const raw = await request.text();
  if (raw.length > 48_000) return new Response("ok");
  let update: TgUpdate = {};
  try {
    update = JSON.parse(raw) as TgUpdate;
    if (!update || typeof update !== "object") return new Response("ok");
  } catch {
    return new Response("ok");
  }
  if (!Number.isSafeInteger(update.update_id) || Number(update.update_id) < 0)
    return new Response("ok");
  await ensureTelegramWorkspace();
  const sourceChat = update.message?.chat || update.callback_query?.message?.chat;
  const sourceFrom = update.message?.from || update.callback_query?.from;
  if (!privateActor(sourceChat, sourceFrom)) return new Response("ok");
  const cid = chatIdOf(sourceChat);
  const receipt =
    await sql`insert into telegram_updates(bot_username,update_id,chat_id) values(${bot.username},${update.update_id},${cid}) on conflict do nothing returning update_id`;
  if (!receipt.length) return new Response("ok");
  const work = processTelegramUpdate(bot, update)
    .then(async () => {
      await sql`update telegram_updates set status='done' where bot_username=${bot.username} and update_id=${update.update_id}`;
    })
    .catch(async () => {
      await sql`update telegram_updates set status='failed' where bot_username=${bot.username} and update_id=${update.update_id}`;
    });
  try {
    waitUntil(work);
  } catch {
    await work;
  }
  return new Response("ok");
}

async function processTelegramUpdate(
  bot: { token: string; secret: string; username: string },
  update: TgUpdate,
) {
  const sql = await getSql();
  const cid = chatIdOf(update.message?.chat) || chatIdOf(update.callback_query?.message?.chat);
  const [rate] = await sql<{
    n: number;
  }>`select count(*)::int as n from telegram_updates where bot_username=${bot.username} and chat_id=${cid} and created_at>now()-interval '1 minute'`;
  if (Number(rate?.n) > 30) {
    if (update.callback_query)
      await ack(
        bot.token,
        update.callback_query.id || "",
        "Слишком много действий. Подождите минуту",
      );
    return new Response("ok");
  }
  try {
    if (update.callback_query) {
      const query = update.callback_query;
      const chatId = chatIdOf(query.message?.chat);
      const data = typeof query.data === "string" ? query.data.slice(0, 64) : "";
      if (!chatId || !privateActor(query.message?.chat, query.from)) {
        await ack(bot.token, query.id || "");
        return new Response("ok");
      }
      const userId = await linkedUser(chatId);
      if (!userId) {
        await ack(bot.token, query.id || "", "Сначала привяжите аккаунт в профиле");
        return new Response("ok");
      }
      if (await banned(userId)) {
        await ack(bot.token, query.id || "", "Аккаунт заблокирован");
        return new Response("ok");
      }
      const { workspaceAction } = await import("@/lib/social/telegram-workspace.server");
      if (/^(model|chat):/.test(data)) {
        await ack(bot.token, query.id || "");
        await workspaceAction(bot.token, chatId, userId, data);
        return new Response("ok");
      }
      if (data === "unlink") {
        await sql`delete from telegram_links where user_id = ${userId} or chat_id = ${chatId}`;
        await ack(bot.token, query.id || "", "Чат отвязан");
        await say(
          bot.token,
          chatId,
          "Этот чат больше не связан с аккаунтом. Привязка снова делается в профиле на сайте.",
        );
        return new Response("ok");
      }
      if (data.startsWith("go:")) {
        await ack(bot.token, query.id || "");
        await runAction(bot.token, chatId, userId, data.slice(3));
        return new Response("ok");
      }
      const choice = /^(y|n):(\S+)$/.exec(data);
      if (choice) {
        const text = await decideFriend(userId, choice[2] || "", choice[1] === "y");
        await ack(bot.token, query.id || "", text);
        await say(bot.token, chatId, text, MENU);
        return new Response("ok");
      }
      await ack(bot.token, query.id || "");
      return new Response("ok");
    }

    const message = update.message;
    const chatId = chatIdOf(message?.chat);
    if (!message || !privateActor(message.chat, message.from) || !chatId) return new Response("ok");
    const text = typeof message.text === "string" ? message.text.trim() : "";
    const command = commandOf(text);
    const handle =
      typeof message.from?.username === "string" ? message.from.username.slice(0, 32) : "";
    if (command?.name === "start") {
      const code = command.arg.split(/\s+/)[0] || "";
      if (!/^[a-z2-9]{10}$/.test(code)) {
        const userId = await linkedUser(chatId);
        if (userId) await runAction(bot.token, chatId, userId, "menu");
        else
          await say(
            bot.token,
            chatId,
            "Сначала войдите на vvvion.space и в профиле нажмите «Привязать Telegram». Пароль боту не нужен.",
          );
        return new Response("ok");
      }
      const userId = await withTransaction(async (tx) => {
        const rows = await tx<{
          user_id: string;
        }>`delete from telegram_codes where code=${code} and expires_at>now() returning user_id`;
        const id = rows[0]?.user_id;
        if (!id) return null;
        const [member] = await tx<{
          banned_at: unknown;
        }>`select banned_at from members where user_id=${id}`;
        if (member?.banned_at) throw new Error("Аккаунт заблокирован");
        await tx`delete from telegram_links where user_id=${id} or chat_id=${chatId}`;
        await tx`insert into telegram_links(user_id,chat_id,username,linked_at) values(${id},${chatId},${handle},now())`;
        await tx`delete from telegram_codes where user_id=${id}`;
        return id;
      });
      if (!userId) {
        await say(
          bot.token,
          chatId,
          "Ссылка устарела или уже использована. Получите новую в профиле VVVion Space.",
        );
        return new Response("ok");
      }
      await say(
        bot.token,
        chatId,
        "Аккаунт привязан. Откройте ИИ-чат, выберите модель или перейдите в банк, книги и файлы. История и баланс общие с сайтом. Файлы до 20 МБ сохраняются на Мегадиск. /help — все команды.",
        MENU,
      );
      return new Response("ok");
    }

    const userId = await linkedUser(chatId);
    if (!userId) {
      await say(
        bot.token,
        chatId,
        fileOf(message)
          ? "Файл приму, когда аккаунт привязан. Войдите на vvvion.space и в профиле нажмите «Привязать Telegram»."
          : "Этот бот говорит только с привязанным аккаунтом. Войдите на vvvion.space и в профиле нажмите «Привязать Telegram».",
      );
      return new Response("ok");
    }
    if (await banned(userId)) {
      await say(bot.token, chatId, "Аккаунт заблокирован. Бот для этого входа молчит.");
      return new Response("ok");
    }
    const incoming = fileOf(message);
    if (incoming) {
      await keepOnMega(bot.token, chatId, userId, incoming);
      return new Response("ok");
    }
    if (!command) {
      const { aiMessage } = await import("@/lib/social/telegram-workspace.server");
      if (!(await aiMessage(bot.token, chatId, userId, text)))
        await say(
          bot.token,
          chatId,
          "Чтобы общаться с ИИ, нажмите «ИИ-чат» или /ai. Другу: /say Имя текст. Файл до 20 МБ можно отправить прямо сюда.",
          MENU,
        );
      return new Response("ok");
    }
    if (command.name === "ask" && command.arg) {
      const { aiMessage } = await import("@/lib/social/telegram-workspace.server");
      await aiMessage(bot.token, chatId, userId, command.arg, true);
      return new Response("ok");
    }
    if (command.name === "say") {
      await say(bot.token, chatId, await sendToFriend(userId, command.arg), MENU);
      return new Response("ok");
    }
    await runAction(bot.token, chatId, userId, command.name);
  } catch (error) {
    const chatId = chatIdOf(update.message?.chat) || chatIdOf(update.callback_query?.message?.chat);
    if (chatId) await say(bot.token, chatId, safeBotError(error)).catch(() => undefined);
    throw new Error("telegram_update_failed");
  }
  return new Response("ok");
}

export async function diagnoseBot() {
  await ensureTelegramWorkspace();
  const sql = await getSql();
  const [bot] = await sql<{
    token: string;
    username: string;
  }>`select token,username from telegram_bot where id=1`;
  const [counts] = await sql<{
    links: number;
    failed: number;
    last_update: string | null;
  }>`select (select count(*)::int from telegram_links) as links,(select count(*)::int from telegram_updates where (status='failed' or (status='processing' and created_at<now()-interval '2 minutes')) and created_at>now()-interval '1 day') as failed,(select max(created_at)::text from telegram_updates) as last_update`;
  const base = {
    configured: Boolean(bot?.token),
    username: bot?.username || "",
    reachable: false,
    webhookReady: false,
    pending: 0,
    links: Number(counts?.links || 0),
    failed: Number(counts?.failed || 0),
    lastUpdate: counts?.last_update || null,
    webhookError: "",
    checkedAt: new Date().toISOString(),
  };
  if (!bot?.token) return base;
  const [me, hook] = await Promise.all([
    tg<{ username: string }>(bot.token, "getMe"),
    tg<{ url: string; pending_update_count: number; last_error_message?: string }>(
      bot.token,
      "getWebhookInfo",
    ),
  ]);
  return {
    ...base,
    reachable: me.ok,
    webhookReady: hook.ok && hook.result?.url === HOOK,
    pending: Number(hook.result?.pending_update_count || 0),
    webhookError: hook.result?.last_error_message
      ? safeBotError(new Error(hook.result.last_error_message))
      : hook.ok
        ? ""
        : "Telegram временно недоступен",
  };
}
export async function repairBot() {
  const sql = await getSql();
  const [bot] = await sql<{
    token: string;
    secret: string;
  }>`select token,secret from telegram_bot where id=1`;
  if (!bot?.token) throw new Error("Сначала сохраните токен бота");
  const hook = await tg(bot.token, "setWebhook", {
    url: HOOK,
    secret_token: bot.secret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: false,
  });
  if (!hook.ok) throw new Error("Не удалось восстановить доставку обновлений");
  if (!(await installBotMenu(bot.token)))
    throw new Error(
      "Доставка настроена, но меню обновилось не полностью. Повторите проверку позже",
    );
}
