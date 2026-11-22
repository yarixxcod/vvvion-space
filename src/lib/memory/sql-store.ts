import {
  MemoryInputError,
  CATEGORIES,
  MAX_MEMORIES,
  extractFacts,
  isSensitive,
  normalizeFact,
  rankMemory,
  validateFact,
  type Category,
  type MemoryFact,
  type MemoryPrefs,
} from "./policy.ts";
export type MemorySql = {
  query: <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<T[]>;
};
export const DEFAULT_PREFS: MemoryPrefs = { enabled: false, automatic: false, generation: 0 };
export async function prefs(sql: MemorySql, owner: string): Promise<MemoryPrefs> {
  const [r] = await sql.query<MemoryPrefs>(
    "select enabled,automatic,generation from user_memory_settings where user_id=$1",
    [owner],
  );
  return r || { ...DEFAULT_PREFS };
}
async function lock(sql: MemorySql, owner: string) {
  await sql.query("insert into user_memory_settings(user_id) values($1) on conflict do nothing", [
    owner,
  ]);
  const [r] = await sql.query<MemoryPrefs>(
    "select enabled,automatic,generation from user_memory_settings where user_id=$1 for update",
    [owner],
  );
  return r;
}
export async function event(
  sql: MemorySql,
  owner: string,
  operation: string,
  outcome: string,
  ms = 0,
  facts = 0,
) {
  await sql.query(
    "insert into user_memory_events(id,user_id,operation,outcome,duration_ms,facts) values($1,$2,$3,$4,$5,$6)",
    [
      crypto.randomUUID(),
      owner,
      operation,
      outcome,
      Math.max(0, Math.min(60000, Math.round(ms))),
      facts,
    ],
  );
}
async function throttle(sql: MemorySql, owner: string) {
  const [r] = await sql.query<{ n: number }>(
    "select count(*)::int as n from user_memory_events where user_id=$1 and created_at>now()-interval '1 hour'",
    [owner],
  );
  if (Number(r.n) >= 60)
    throw new MemoryInputError("Слишком много изменений памяти. Попробуйте позже");
  await sql.query(
    "delete from user_memory_events where user_id=$1 and created_at<now()-interval '30 days'",
    [owner],
  );
}
export async function listFacts(sql: MemorySql, owner: string): Promise<MemoryFact[]> {
  return sql.query<MemoryFact>(
    `select id,content,category,source_type,confidence,importance,status,version,sensitive,slot,created_at::text,updated_at::text,last_used_at::text,expires_at::text from user_memories where user_id=$1 order by updated_at desc,id limit ${MAX_MEMORIES}`,
    [owner],
  );
}
export async function chatDisabled(sql: MemorySql, owner: string, key: string) {
  if (!key) return false;
  const [r] = await sql.query<{ disabled: boolean }>(
    "select disabled from user_memory_chats where user_id=$1 and chat_key=$2",
    [owner, key],
  );
  return Boolean(r?.disabled);
}
export async function setPrefs(
  sql: MemorySql,
  owner: string,
  input: { enabled: boolean; automatic: boolean; consent?: boolean },
) {
  const before = await lock(sql, owner);
  await throttle(sql, owner);
  if (input.automatic && !before.automatic && !input.consent)
    throw new MemoryInputError("Нужно согласие на автоматическое запоминание");
  await sql.query(
    "update user_memory_settings set enabled=$2,automatic=$3,generation=generation+1,updated_at=now() where user_id=$1",
    [owner, input.enabled, input.enabled && input.automatic],
  );
  await event(sql, owner, "settings", "ok");
  return prefs(sql, owner);
}
export type SaveFact = {
  id?: string;
  version?: number;
  content: unknown;
  category?: unknown;
  confirmSensitive?: boolean;
  expiresAt?: string | null;
  activate?: boolean;
};
export async function saveFact(
  sql: MemorySql,
  owner: string,
  input: SaveFact,
  source = "manual",
  internal?: {
    slot: string;
    confidence: number;
    importance: number;
    status: "active" | "conflict";
  },
) {
  await lock(sql, owner);
  if (!internal) await throttle(sql, owner);
  const content = validateFact(input.content, input.confirmSensitive === true);
  const inferred = extractFacts(content)[0];
  if (input.category !== undefined && !(CATEGORIES as readonly unknown[]).includes(input.category))
    throw new MemoryInputError("Неизвестная категория");
  const category = (input.category || inferred?.category || "other") as Category;
  let expiry: string | null = null;
  if (input.expiresAt) {
    const ms = Date.parse(input.expiresAt);
    if (!Number.isFinite(ms) || ms <= Date.now() || ms > Date.now() + 3650 * 86400000)
      throw new MemoryInputError("Некорректный срок хранения");
    expiry = new Date(ms).toISOString();
  }
  const fingerprint = normalizeFact(content);
  const slot = internal?.slot || inferred?.slot || "";
  const [duplicate] = await sql.query<{ id: string }>(
    "select id from user_memories where user_id=$1 and fingerprint=md5($2)",
    [owner, fingerprint],
  );
  if (duplicate && duplicate.id !== input.id) return { id: duplicate.id, duplicate: true };
  if (input.id) {
    const [old] = await sql.query<{ slot: string; status: string }>(
      "select slot,status from user_memories where id=$1 and user_id=$2 and version=$3",
      [input.id, owner, input.version],
    );
    if (!old) throw new MemoryInputError("Запись изменена или удалена. Обновите список");
    if (input.activate && (old.status !== "conflict" || !old.slot || old.slot !== slot)) {
      throw new MemoryInputError("Подтвердить можно только неизменённый слот конфликтующей записи");
    }
    if (input.activate && old.status === "conflict" && old.slot)
      await sql.query(
        "delete from user_memories where user_id=$1 and slot=$2 and status='active' and id<>$3",
        [owner, old.slot, input.id],
      );
    const collision = slot
      ? await sql.query(
          "select id from user_memories where user_id=$1 and slot=$2 and status='active' and id<>$3",
          [owner, slot, input.id],
        )
      : [];
    const status = input.activate ? "active" : collision.length ? "conflict" : old.status;
    await sql.query(
      "update user_memories set content=$3,category=$4,fingerprint=md5($5),slot=$6,sensitive=$7,expires_at=$8,source_type=$9,status=$10,version=version+1,updated_at=now() where id=$1 and user_id=$2",
      [
        input.id,
        owner,
        content,
        category,
        fingerprint,
        slot,
        isSensitive(content),
        expiry,
        source,
        status,
      ],
    );
  } else {
    const [count] = await sql.query<{ n: number }>(
      "select count(*)::int as n from user_memories where user_id=$1",
      [owner],
    );
    if (Number(count.n) >= MAX_MEMORIES)
      throw new MemoryInputError(`Достигнут предел: ${MAX_MEMORIES} записей`);
    const prior =
      slot && !internal
        ? await sql.query(
            "select id from user_memories where user_id=$1 and slot=$2 and status='active'",
            [owner, slot],
          )
        : [];
    const status = internal?.status || (prior.length ? "conflict" : "active");
    input = { ...input, id: crypto.randomUUID() };
    await sql.query(
      "insert into user_memories(id,user_id,content,category,fingerprint,slot,source_type,confidence,importance,status,sensitive,expires_at) values($1,$2,$3,$4,md5($5),$6,$7,$8,$9,$10,$11,$12)",
      [
        input.id,
        owner,
        content,
        category,
        fingerprint,
        slot,
        source,
        internal?.confidence || 1,
        internal?.importance || 8,
        status,
        isSensitive(content),
        expiry,
      ],
    );
  }
  if (source !== "automatic")
    await sql.query("delete from user_memory_blocks where user_id=$1 and fingerprint=md5($2)", [
      owner,
      fingerprint,
    ]);
  await sql.query("update user_memory_settings set generation=generation+1 where user_id=$1", [
    owner,
  ]);
  if (!internal) await event(sql, owner, "save", "ok");
  return { id: input.id!, duplicate: false };
}
export async function removeFact(sql: MemorySql, owner: string, id: string, version: number) {
  await lock(sql, owner);
  await throttle(sql, owner);
  const [row] = await sql.query<{ fingerprint: string }>(
    "delete from user_memories where id=$1 and user_id=$2 and version=$3 returning fingerprint",
    [id, owner, version],
  );
  if (!row) throw new MemoryInputError("Запись изменена или удалена. Обновите список");
  await sql.query(
    "insert into user_memory_blocks(user_id,fingerprint) values($1,$2) on conflict do nothing",
    [owner, row.fingerprint],
  );
  await sql.query("update user_memory_settings set generation=generation+1 where user_id=$1", [
    owner,
  ]);
  await event(sql, owner, "delete", "ok");
}
export async function clearFacts(sql: MemorySql, owner: string) {
  await lock(sql, owner);
  await throttle(sql, owner);
  await sql.query("delete from user_memories where user_id=$1", [owner]);
  await sql.query("delete from user_memory_blocks where user_id=$1", [owner]);
  await sql.query(
    "update user_memory_settings set automatic=false,generation=generation+1,updated_at=now() where user_id=$1",
    [owner],
  );
  await event(sql, owner, "clear", "ok");
}
export async function setChatPolicy(sql: MemorySql, owner: string, key: string, disabled: boolean) {
  if (!/^[A-Za-z0-9_-]{3,100}$/.test(key)) throw new MemoryInputError("Диалог не найден");
  await lock(sql, owner);
  await throttle(sql, owner);
  if (key !== "telegram") {
    const [other] = await sql.query<{ user_id: string }>(
      "select user_id from saved_chats where id=$1",
      [key],
    );
    if (other && other.user_id !== owner) throw new MemoryInputError("Диалог недоступен");
  }
  await sql.query(
    "insert into user_memory_chats(user_id,chat_key,disabled) values($1,$2,$3) on conflict(user_id,chat_key) do update set disabled=excluded.disabled",
    [owner, key, disabled],
  );
  await sql.query("update user_memory_settings set generation=generation+1 where user_id=$1", [
    owner,
  ]);
  await event(sql, owner, "chat_policy", "ok");
}
/** Generation acts as an opt-out/deletion fence for jobs scheduled before the user's action. */
export async function captureFacts(
  sql: MemorySql,
  owner: string,
  text: string,
  key: string,
  generation: number,
) {
  const started = Date.now();
  const settings = await lock(sql, owner);
  if (
    !settings.enabled ||
    !settings.automatic ||
    settings.generation !== generation ||
    (await chatDisabled(sql, owner, key))
  )
    return 0;
  const candidates = extractFacts(text);
  if (!candidates.length) return 0;
  await throttle(sql, owner);
  let added = 0;
  for (const c of candidates) {
    const [blocked] = await sql.query(
      "select fingerprint from user_memory_blocks where user_id=$1 and fingerprint=md5($2)",
      [owner, normalizeFact(c.content)],
    );
    if (blocked) continue;
    const [existing] = await sql.query<{ id: string }>(
      "select id from user_memories where user_id=$1 and slot=$2 and status='active'",
      [owner, c.slot],
    );
    const result = await saveFact(
      sql,
      owner,
      {
        content: c.content,
        category: c.category,
        expiresAt: new Date(Date.now() + 365 * 86400000).toISOString(),
      },
      "automatic",
      { ...c, status: existing ? "conflict" : "active" },
    );
    if (!result.duplicate) added++;
  }
  await event(sql, owner, "extract", "ok", Date.now() - started, added);
  return added;
}
export async function retrieveFacts(sql: MemorySql, owner: string, query: string, key: string) {
  const settings = await prefs(sql, owner);
  if (!settings.enabled || (await chatDisabled(sql, owner, key)))
    return { settings, rows: [] as MemoryFact[] };
  const rows = rankMemory(await listFacts(sql, owner), query);
  return { settings, rows };
}
