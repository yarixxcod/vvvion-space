import { getSql, withTransaction } from "@/lib/db";
import { assertActive } from "@/lib/social/access";
import { memoryFeatureFor, memoryFlagEnabled } from "./flags.server";
import {
  MemoryInputError,
  memoryContext,
  normalizeFact,
  parseMemoryCommand,
  type Workspace,
  type MemoryFact,
} from "./policy";
import * as store from "./store";
export const OFF_WORKSPACE: Workspace = {
  available: false,
  prefs: { ...store.DEFAULT_PREFS },
  entries: [],
  chatDisabled: false,
};
export function requireMemory(owner: string) {
  if (!memoryFeatureFor(owner))
    throw new MemoryInputError("Память VVVion пока недоступна для этого аккаунта");
}
export async function workspace(owner: string, chatKey = ""): Promise<Workspace> {
  if (!memoryFeatureFor(owner)) return { ...OFF_WORKSPACE };
  const sql = await getSql();
  const [p, entries, disabled] = await Promise.all([
    store.prefs(sql, owner),
    store.listFacts(sql, owner),
    store.chatDisabled(sql, owner, chatKey),
  ]);
  return { available: true, prefs: p, entries, chatDisabled: disabled };
}
export async function mutate<T>(
  owner: string,
  fn: (sql: Awaited<ReturnType<typeof getSql>>) => Promise<T>,
) {
  requireMemory(owner);
  await assertActive(owner);
  return withTransaction(async (sql) => {
    await sql.query("set local statement_timeout='1500ms'");
    return fn(sql);
  });
}
function safeError(error: unknown) {
  return error instanceof MemoryInputError
    ? error.message
    : "Сервис памяти временно недоступен. Изменение не подтверждено; проверьте список в настройках.";
}
async function failure(owner: string, operation: string, started: number) {
  try {
    await store.event(await getSql(), owner, operation, "error", Date.now() - started);
  } catch {
    /* No facts, prompts, IDs or database errors are logged. */
  }
}
async function command(
  owner: string,
  text: string,
  key: string,
  temporary: boolean,
): Promise<string | null> {
  const cmd = parseMemoryCommand(text);
  if (!cmd) return null;
  if (cmd.type === "clarify")
    return "Уточните изменение: «Обнови память: старый факт => новый факт». Записи пока не изменены.";
  const started = Date.now();
  try {
    return await mutate(owner, async (sql) => {
      if (cmd.type === "private" || cmd.type === "resume") {
        if (!key)
          return "Откройте сохранённый диалог или выключите память в настройках. Изменение режима пока не выполнено.";
        await store.setChatPolicy(sql, owner, key, cmd.type === "private");
        return cmd.type === "private"
          ? "Память в этом диалоге выключена: не использую её и не сохраняю новые факты. Ранее сохранённые записи можно удалить в настройках."
          : "Память снова разрешена в этом диалоге. Общий переключатель в настройках сохраняет приоритет.";
      }
      if (temporary || (await store.chatDisabled(sql, owner, key)))
        return "В этом диалоге память выключена. Управлять записями можно в настройках «Память VVVion».";
      const p = await store.prefs(sql, owner);
      if (cmd.type === "list") {
        const rows = (await store.listFacts(sql, owner)).filter(
          (r) => r.status === "active" && (!r.expires_at || Date.parse(r.expires_at) > Date.now()),
        );
        return rows.length
          ? `Вы сами сохранили следующие сведения${p.enabled ? "" : " (использование памяти выключено)"}:\n${rows
              .slice(0, 20)
              .map((r) => `• ${r.content}`)
              .join("\n")}${rows.length > 20 ? "\nВсе записи доступны в настройках." : ""}`
          : "Сохранённых активных фактов пока нет.";
      }
      if (!p.enabled)
        return "Сначала включите «Память VVVion» в настройках. Ничего не сохранено и не удалено.";
      if (cmd.type === "remember") {
        const result = await store.saveFact(
          sql,
          owner,
          { content: cmd.text, category: undefined },
          "command",
        );
        return result.duplicate
          ? "Эта запись уже есть в памяти. Дубликат не создан."
          : "Запись действительно сохранена. Её можно проверить, изменить или удалить в настройках «Память VVVion».";
      }
      const needle = normalizeFact(cmd.type === "update" ? cmd.before : cmd.text);
      if (needle.length < 5) return "Уточните, какой факт нужно изменить. Записи пока не изменены.";
      const all = await store.listFacts(sql, owner);
      const exact = all.filter((r) => normalizeFact(r.content) === needle);
      const matches = exact.length
        ? exact
        : all.filter((r) => normalizeFact(r.content).includes(needle));
      if (matches.length !== 1)
        return matches.length
          ? "Найдено несколько записей. Уточните полный текст или выберите запись в настройках. Ничего не изменено."
          : "Такой записи в памяти нет. Ничего не изменено.";
      const row = matches[0];
      if (cmd.type === "forget") {
        await store.removeFact(sql, owner, row.id, row.version);
        return "Запись удалена из активной памяти. Повторное автоизвлечение этого же факта заблокировано. Копия могла остаться в ранее отправленных сообщениях и резервных копиях сервиса.";
      }
      await store.saveFact(
        sql,
        owner,
        { id: row.id, version: row.version, content: cmd.after, category: row.category },
        "command",
      );
      return "Запись успешно обновлена в памяти.";
    });
  } catch (error) {
    void failure(owner, "command", started);
    return safeError(error);
  }
}
export type DirectInput = { text: string; direct: boolean; attachments: boolean };
/** Same verified-account pipeline for site/WebView and Telegram. Facts never come from assistant/file output. */
export async function prepareMemoryTurn(
  owner: string,
  input: DirectInput,
  chatKey: string,
  temporary = false,
): Promise<{ context: string; reply?: string; capture?: () => Promise<void> }> {
  if (!memoryFeatureFor(owner)) return { context: "" };
  const direct = input.direct && !input.attachments;
  if (direct) {
    const reply = await command(owner, input.text, chatKey, temporary);
    if (reply !== null) return { context: "", reply };
  }
  if (temporary)
    return {
      context:
        "Этот диалог без долговременной памяти. Не утверждай, что запомнил сведения для будущих разговоров.",
    };
  const started = Date.now();
  try {
    const reading = (async () => {
      await assertActive(owner);
      return withTransaction(async (sql) => {
        await sql.query("set local statement_timeout='300ms'");
        return store.retrieveFacts(sql, owner, input.text, chatKey);
      });
    })();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      reading,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), 450);
      }),
    ]).finally(() => clearTimeout(timer));
    if (!result) {
      void failure(owner, "retrieve", started);
      return { context: "" };
    }
    const { settings, rows } = result;
    const capture =
      direct && settings.enabled && settings.automatic
        ? async () => {
            if (!memoryFeatureFor(owner)) return;
            try {
              await mutate(owner, (sql) =>
                store.captureFacts(sql, owner, input.text, chatKey, settings.generation),
              );
            } catch {
              await failure(owner, "extract", started);
            }
          }
        : undefined;
    // No cached plaintext or cross-account cache. Usage timestamps never create new facts.
    if (rows.length)
      void (async () => {
        try {
          const sql = await getSql();
          await sql.query(
            "update user_memories set last_used_at=now() where user_id=$1 and id=any($2::text[])",
            [owner, rows.map((r) => r.id)],
          );
        } catch {
          /* best effort */
        }
      })();
    return {
      context: [
        memoryContext(rows),
        "Операции долговременной памяти выполняет сервер по явным командам. Не обещай «запомнил», «забыл» или «обновил память» от своего имени; при необходимости предложи команду или настройки.",
      ]
        .filter(Boolean)
        .join("\n"),
      capture,
    };
  } catch {
    void failure(owner, "retrieve", started);
    return { context: "" };
  }
}
export async function memoryAdminStats() {
  if (!memoryFlagEnabled())
    return {
      available: false,
      users: 0,
      records: 0,
      average: 0,
      errors: 0,
      extractionMs: 0,
      aiCalls: 0,
      costUsd: 0,
    };
  const sql = await getSql();
  const [r] = await sql.query<{
    users: number;
    records: number;
    average: number;
    errors: number;
    extraction_ms: number;
    ai_calls: number;
    cost_usd: number;
  }>(`select
 (select count(*)::int from user_memory_settings where enabled) as users,
 (select count(*)::int from user_memories) as records,
 (select coalesce(avg(n),0)::float from (select count(*) as n from user_memories group by user_id) counts) as average,
 count(*) filter(where outcome='error')::int as errors,
 coalesce(avg(duration_ms) filter(where operation='extract'),0)::float as extraction_ms,
 coalesce(sum(ai_calls),0)::int as ai_calls,coalesce(sum(cost_usd),0)::float as cost_usd
 from user_memory_events where created_at>now()-interval '30 days'`);
  return {
    available: true,
    users: Number(r.users),
    records: Number(r.records),
    average: Number(r.average),
    errors: Number(r.errors),
    extractionMs: Number(r.extraction_ms),
    aiCalls: Number(r.ai_calls),
    costUsd: Number(r.cost_usd),
  };
}
export function publicMemoryError(error: unknown): never {
  throw new Error(safeError(error));
}
