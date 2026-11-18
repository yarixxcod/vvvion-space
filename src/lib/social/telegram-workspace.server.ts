import { getSql, withTransaction } from "@/lib/db";
import { loadAccess } from "@/lib/social/access";
import { ensureTelegramWorkspace } from "@/lib/social/telegram-schema.server";
import { tg, say, MENU, type Key } from "@/lib/social/telegram.server";
import { splitTelegramText, safeBotError } from "@/lib/social/telegram-core";
const SITE = "https://vvvion.space";
const BACK = [{ text: "‹ Меню", data: "go:menu" }];
const AI: Key = [
  [
    { text: "Модели", data: "go:models" },
    { text: "Новый диалог", data: "go:new" },
  ],
  [
    { text: "Мои диалоги", data: "go:chats" },
    { text: "Выйти из ИИ-чата", data: "go:stop" },
  ],
  BACK,
];
async function modelLabel(name: string) {
  if (!name) return "";
  const sql = await getSql();
  const [row] = await sql<{
    label: string;
  }>`select coalesce(nullif(display_name, ''), name) as label from catalog_models where name = ${name}`;
  return row?.label || name;
}
async function session(userId: string) {
  await ensureTelegramWorkspace();
  const sql = await getSql();
  await sql`insert into telegram_sessions(user_id) values (${userId}) on conflict do nothing`;
  const [row] = await sql<{
    model: string;
    chat_id: string | null;
    ai_enabled: boolean;
  }>`select model,chat_id,ai_enabled from telegram_sessions where user_id=${userId}`;
  return row;
}
export async function workspaceAction(
  token: string,
  chatId: string,
  userId: string,
  action: string,
): Promise<boolean> {
  const sql = await getSql();
  if (action === "ai" || action === "new") {
    await session(userId);
    if (action === "new") {
      const changed =
        await sql`update telegram_sessions set chat_id=null,ai_enabled=true where user_id=${userId} and busy_until < now() returning user_id`;
      if (!changed.length) {
        await say(token, chatId, "Дождитесь текущего ответа, затем начните новый диалог.", AI);
        return true;
      }
    } else await sql`update telegram_sessions set ai_enabled=true where user_id=${userId}`;
    const s = await session(userId);
    if (!s?.model) return workspaceAction(token, chatId, userId, "models");
    const label = await modelLabel(s.model);
    await say(
      token,
      chatId,
      `ИИ-чат включён · ${label}\n\nОтправьте вопрос обычным сообщением. История появится и на сайте. Лимиты общие с сайтом. /stop возвращает обычный режим.`,
      AI,
    );
    return true;
  }
  if (action === "stop") {
    await session(userId);
    await sql`update telegram_sessions set ai_enabled=false where user_id=${userId}`;
    await say(token, chatId, "Режим ИИ-чата выключен. История сохранена.", MENU);
    return true;
  }
  if (action === "models" || action.startsWith("models:")) {
    const page = Math.max(0, Math.min(1000, Number(action.split(":")[1]) || 0));
    const rows = await sql<{
      name: string;
      label: string;
      key: string;
    }>`select name,coalesce(nullif(display_name,''),name) as label,md5(name) as key from catalog_models order by name limit 9 offset ${page * 8}`;
    const s = await session(userId);
    const keys: Key = rows.slice(0, 8).map((r) => [
      {
        text: `${s.model === r.name ? "✓ " : ""}${r.label}`.slice(0, 60),
        data: `model:${r.key}`,
      },
    ]);
    const nav = [];
    if (page) nav.push({ text: "‹ Назад", data: `go:models:${page - 1}` });
    if (rows.length > 8) nav.push({ text: "Далее ›", data: `go:models:${page + 1}` });
    if (nav.length) keys.push(nav);
    keys.push(BACK);
    await say(
      token,
      chatId,
      rows.length
        ? "Выберите модель из каталога VVVion Space. Провайдеры переключаются в том же порядке, что на сайте."
        : "Каталог моделей пока пуст. Администратор может добавить модели на сайте.",
      keys,
    );
    return true;
  }
  if (action.startsWith("model:")) {
    const key = action.slice(6);
    if (!/^[a-f0-9]{32}$/.test(key)) return true;
    const [model] = await sql<{
      name: string;
      label: string;
    }>`select name, coalesce(nullif(display_name, ''), name) as label from catalog_models where md5(name) = ${key}`;
    if (!model) {
      await say(token, chatId, "Модель больше не найдена. Откройте /models.", AI);
      return true;
    }
    await session(userId);
    await sql`update telegram_sessions set model = ${model.name}, ai_enabled = true where user_id = ${userId}`;
    await say(
      token,
      chatId,
      `Выбрана ${model.label}. Можно писать вопрос. Контекст текущего диалога сохранён.`,
      AI,
    );
    return true;
  }
  if (action === "chats") {
    const rows = await sql<{
      id: string;
      title: string;
    }>`select id,title from saved_chats where user_id=${userId} order by updated_at desc limit 8`;
    const keyboard: Key = rows
      .map((r) => [{ text: r.title.slice(0, 55) || "Диалог", data: `chat:${r.id}` }])
      .filter((r) => r[0].data.length <= 64);
    keyboard.push([{ text: "＋ Новый диалог", data: "go:new" }], BACK);
    await say(
      token,
      chatId,
      "Ваши последние диалоги с сайта и Telegram. Выберите, чтобы продолжить здесь.",
      keyboard,
    );
    return true;
  }
  if (action.startsWith("chat:")) {
    const id = action.slice(5);
    const [row] = await sql<{
      id: string;
      title: string;
      messages: unknown;
    }>`select id,title,messages from saved_chats where id=${id} and user_id=${userId}`;
    if (!row) {
      await say(token, chatId, "Диалог удалён или недоступен.", AI);
      return true;
    }
    await session(userId);
    const changed =
      await sql`update telegram_sessions set chat_id=${row.id},ai_enabled=true where user_id=${userId} and busy_until<now() returning user_id`;
    await say(
      token,
      chatId,
      changed.length
        ? `Продолжаем «${row.title}». Следующий вопрос учтёт последние сообщения.`
        : "Дождитесь текущего ответа, затем выберите диалог.",
      AI,
    );
    return true;
  }
  if (action === "bank" || action === "topup") {
    const [wallet] = await sql<{
      balance: number;
    }>`select balance from wallets where user_id=${userId}`;
    const rows = await sql<{
      amount: number;
      note: string;
      incoming: boolean;
    }>`select amount,note,(to_id=${userId}) as incoming from wallet_transfers where to_id=${userId} or from_id=${userId} order by created_at desc limit 5`;
    await say(
      token,
      chatId,
      `Банк VVVion\nБаланс: ${Number(wallet?.balance || 0)} вуб.\n\n${rows.map((r) => `${r.incoming ? "+" : "−"}${r.amount} · ${r.note || "Операция"}`).join("\n") || "Операций пока нет."}\n\nПополнение и переводы открываются в защищённом банке сайта. Там показаны актуальный курс, счёт и подтверждение. Telegram использует тот же кошелёк.`,
      [
        [{ text: "Пополнить / открыть банк", url: `${SITE}/?place=bank` }],
        [{ text: "Ежедневный бонус", data: "go:grant" }],
        BACK,
      ],
    );
    return true;
  }
  if (action === "books") {
    const rows = await sql<{
      id: string;
      title: string;
      author: string;
    }>`select id,title,author from shelf_books order by added_at desc limit 8`;
    await say(
      token,
      chatId,
      `Книги на общей полке\n\n${rows.map((r, i) => `${i + 1}. ${r.title}${r.author ? ` — ${r.author}` : ""}`).join("\n") || "Полка пока пуста."}`,
      (
        rows.map((r) => [
          {
            text: r.title.slice(0, 55),
            url: `${SITE}/?place=play&book=${encodeURIComponent(r.id)}`,
          },
        ]) as Key
      ).concat([[{ text: "Вся библиотека", url: `${SITE}/?place=play` }], BACK]),
    );
    return true;
  }
  if (action === "videos") {
    const rows = await sql<{
      title: string;
      provider: string;
      external_id: string;
    }>`select title,provider,external_id from screen_videos order by created_at desc limit 8`;
    const keyboard: Key = rows.flatMap((r) => {
      // Only known provider URLs. Do not pass arbitrary embed HTML to Telegram.
      const url =
        r.provider === "youtube" && /^[\w-]{6,20}$/.test(r.external_id)
          ? `https://www.youtube.com/watch?v=${r.external_id}`
          : r.provider === "rutube" && /^[a-f0-9]{32}$/i.test(r.external_id)
            ? `https://rutube.ru/video/${r.external_id}/`
            : "";
      return url ? [[{ text: r.title.slice(0, 55), url }]] : [];
    });
    keyboard.push([{ text: "Все ролики в VVVion", url: `${SITE}/?place=play&view=watch` }], BACK);
    await say(
      token,
      chatId,
      `Смотрельня\n\n${rows.map((r) => `• ${r.title}`).join("\n") || "Роликов пока нет."}`,
      keyboard,
    );
    return true;
  }
  if (action === "files") {
    const disk = await sql<{
      name: string;
      bytes: number;
    }>`select name,bytes from disk_files where user_id=${userId} order by created_at desc limit 5`;
    const mega = await sql<{
      name: string;
      kind: string;
    }>`select name,kind from mega_entries where user_id=${userId} and parent_id is null and status='ok' order by created_at desc limit 5`;
    const recent = `\n\nДиск\n${disk.map((r) => `• ${r.name} · ${Math.ceil(Number(r.bytes) / 1024)} КБ`).join("\n") || "Пока пусто"}\n\nКорень Мегадиска\n${mega.map((r) => `${r.kind === "folder" ? "▸" : "•"} ${r.name}`).join("\n") || "Пока пусто"}`;
    await say(
      token,
      chatId,
      `Ваши файлы${recent}\n\nФайл, фото, видео или аудио до 20 МБ можно отправить сюда — бот сохранит его в корень Мегадиска. Просмотр, папки, скачивание и ссылки доступны на сайте с правами вашего аккаунта.`,
      [
        [{ text: "Диск", url: `${SITE}/?place=disk` }],
        [{ text: "Мегадиск", url: `${SITE}/?place=disk&view=mega` }],
        BACK,
      ],
    );
    return true;
  }
  if (action === "profile") {
    const [row] = await sql<{
      name: string;
      gamertag: string;
    }>`select u.name,m.handle as gamertag from "user" u left join user_handles m on m.user_id=u.id where u.id=${userId}`;
    await say(
      token,
      chatId,
      `${row?.name || "Участник"}${row?.gamertag ? `\n@${row.gamertag}` : ""}\n\nTelegram связан с вашим аккаунтом VVVion. Пароль и платёжные данные боту не нужны.`,
      [
        [{ text: "Мой аккаунт", url: SITE }],
        [{ text: "Отвязать Telegram", data: "go:unlink" }],
        BACK,
      ],
    );
    return true;
  }
  if (action === "admin") {
    const access = await loadAccess(userId);
    if (access.role !== "admin") {
      await say(token, chatId, "Этот раздел доступен администраторам.", MENU);
      return true;
    }
    const [r] = await sql<{
      members: number;
      linked: number;
      models: number;
    }>`select (select count(*)::int from members) as members,(select count(*)::int from telegram_links) as linked,(select count(*)::int from catalog_models) as models`;
    await say(
      token,
      chatId,
      `Пульт администратора\n\nУчастники: ${r.members}\nПривязок Telegram: ${r.linked}\nМоделей: ${r.models}\n\nИзменения ролей, моделей, цен и балансов требуют входа в админку сайта.`,
      [[{ text: "Открыть админ-панель", url: `${SITE}/?place=admin` }], BACK],
    );
    return true;
  }
  return false;
}
export async function aiMessage(
  token: string,
  chatId: string,
  userId: string,
  text: string,
  force = false,
  memoryDirect = true,
) {
  const sql = await getSql();
  const s = await session(userId);
  if (!s.ai_enabled && !force) return false;
  if (!s.model) {
    await workspaceAction(token, chatId, userId, "models");
    return true;
  }
  if (text.length > 12000) {
    await say(token, chatId, "Сообщение слишком длинное. До 12 000 символов за один вопрос.", AI);
    return true;
  }
  const lease =
    await sql`update telegram_sessions set busy_until=now()+interval '100 seconds' where user_id=${userId} and busy_until<now() returning user_id`;
  if (!lease.length) {
    await say(token, chatId, "Предыдущий ответ ещё готовится. Дождитесь его.", AI);
    return true;
  }
  let id = s.chat_id;
  try {
    if (!id) {
      id = crypto.randomUUID();
      await sql`insert into saved_chats(id,user_id,title,messages,created_at,updated_at) values(${id},${userId},${`Telegram · ${text.slice(0, 45)}`},'[]'::jsonb,now(),now())`;
      await sql`update telegram_sessions set chat_id=${id} where user_id=${userId}`;
    }
    const [row] = await sql<{
      messages: unknown;
    }>`select messages from saved_chats where id=${id} and user_id=${userId}`;
    if (!row) throw new Error("Диалог удалён. Нажмите /new");
    const messages = Array.isArray(row.messages) ? row.messages : [];
    const user = {
      id: `telegram-${crypto.randomUUID()}`,
      role: "user",
      content: text,
      createdAt: Date.now(),
    };
    // Persist the question before provider work, using a row lock only for the short append.
    await withTransaction(async (tx) => {
      const [current] = await tx<{
        messages: unknown;
      }>`select messages from saved_chats where id=${id} and user_id=${userId} for update`;
      if (!current) throw new Error("Диалог удалён");
      const list = Array.isArray(current.messages) ? current.messages : [];
      await tx`update saved_chats set messages=${JSON.stringify([...list, user].slice(-80))}::jsonb,updated_at=now() where id=${id} and user_id=${userId}`;
    });
    await tg(token, "sendChatAction", { chat_id: chatId, action: "typing" });
    const typing = setInterval(() => {
      void tg(token, "sendChatAction", { chat_id: chatId, action: "typing" });
    }, 4500);
    let answer: string;
    try {
      const { completeTelegramChat } = await import("@/lib/ai/proxy.server");
      answer = await completeTelegramChat(userId, s.model, [...messages, user], {text,chatKey:id,attachments:!memoryDirect});
    } finally {
      clearInterval(typing);
    }
    const assistant = {
      id: `telegram-${crypto.randomUUID()}`,
      role: "assistant",
      content: answer,
      model: s.model,
      modelLabel: (await modelLabel(s.model)) || undefined,
      createdAt: Date.now(),
    };
    await withTransaction(async (tx) => {
      const [current] = await tx<{
        messages: unknown;
      }>`select messages from saved_chats where id=${id} and user_id=${userId} for update`;
      if (!current) return;
      const list = Array.isArray(current.messages) ? current.messages : [];
      await tx`update saved_chats set messages=${JSON.stringify([...list, assistant].slice(-80))}::jsonb,updated_at=now(),unread=true where id=${id} and user_id=${userId}`;
    });
    const parts = splitTelegramText(answer);
    for (let i = 0; i < parts.length; i++)
      await say(
        token,
        chatId,
        parts[i],
        i === parts.length - 1
          ? [[{ text: "Продолжить на сайте", url: `${SITE}/?chat=${id}` }], ...AI]
          : undefined,
      );
  } catch (error) {
    await say(token, chatId, safeBotError(error), AI);
  } finally {
    await sql`update telegram_sessions set busy_until=now() where user_id=${userId}`;
  }
  return true;
}
