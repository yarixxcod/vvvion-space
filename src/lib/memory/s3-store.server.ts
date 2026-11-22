import { createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { MemoryInputError, CATEGORIES, MAX_MEMORIES, extractFacts, isSensitive, normalizeFact, rankMemory, validateFact, type MemoryFact, type MemoryPrefs, type Category } from "./policy.ts";
import type { SaveFact } from "./sql-store.ts";
export type State = { format: 1; prefs: MemoryPrefs; entries: MemoryFact[]; blocks: string[]; chats: Record<string, boolean>; events: number[] };
export type S3Session = { kind: "s3-memory"; owner: string; state: State };
const empty = (): State => ({ format: 1, prefs: { enabled: false, automatic: false, generation: 0 }, entries: [], blocks: [], chats: {}, events: [] });
const fingerprint = (text: string) => createHash("sha256").update(normalizeFact(text)).digest("hex");
export function s3MemoryEnabled() { return process.env.VVVION_MEMORY_STORAGE === "s3"; }
function encryptionKey() {
  const key = process.env.VVVION_MEMORY_ENCRYPTION_KEY || "";
  if (!/^[a-f0-9]{64}$/i.test(key)) throw new Error("Ключ шифрования памяти не настроен");
  return Buffer.from(key, "hex");
}
export function sealState(owner: string, state: State): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(`vvvion-memory-v1:${owner}`));
  const bytes = Buffer.concat([cipher.update(JSON.stringify(state), "utf8"), cipher.final()]);
  return JSON.stringify({ format: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: bytes.toString("base64") });
}
export function openState(owner: string, body: string | null): State {
  if (body === null) return empty();
  const sealed = JSON.parse(body);
  if (sealed.format !== 1 || typeof sealed.data !== "string") throw new Error("Некорректная память");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(sealed.iv, "base64"));
  decipher.setAAD(Buffer.from(`vvvion-memory-v1:${owner}`));
  decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
  const state = JSON.parse(Buffer.concat([decipher.update(Buffer.from(sealed.data, "base64")), decipher.final()]).toString("utf8"));
  if (state.format !== 1 || !state.prefs || !Array.isArray(state.entries) || state.entries.length > MAX_MEMORIES || !Array.isArray(state.blocks) || state.blocks.length > 512 || !Array.isArray(state.events) || !state.chats || Object.keys(state.chats).length > 256) throw new Error("Некорректная память");
  return state;
}
/** S3-compatible services may ignore If-Match. Serialize writes using the existing database's distributed advisory lock; facts stay only in encrypted S3. */
export async function transaction<T>(owner: string, fn: (session: S3Session) => Promise<T>, write = true): Promise<T> {
  const { readMemoryObject, writeMemoryObject } = await import("../storage/s3.server.ts");
  const run = async () => {
    const before = await readMemoryObject(owner);
    const state = openState(owner, before.body);
    const original = JSON.stringify(state);
    const result = await fn({ kind: "s3-memory", owner, state });
    if (write && JSON.stringify(state) !== original) await writeMemoryObject(owner, sealState(owner, state));
    return result;
  };
  if (!write) return run();
  const { withTransaction } = await import("../db");
  return withTransaction(async sql => {
    await sql.query("set local lock_timeout='5000ms'");
    await sql.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`vvvion-memory-s3:${owner}`]);
    return run();
  });
}

function own(s: S3Session, owner: string) { if (s.owner !== owner) throw new MemoryInputError("Память недоступна"); return s.state; }
function throttle(s: State) {
  s.events = s.events.filter(t => t > Date.now() - 3600_000);
  if (s.events.length >= 60) throw new MemoryInputError("Слишком много изменений памяти. Попробуйте позже");
  s.events.push(Date.now());
}
export async function prefs(s: S3Session, owner: string) { return { ...own(s, owner).prefs }; }
export async function listFacts(s: S3Session, owner: string) { return [...own(s, owner).entries].sort((a,b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id)); }
export async function chatDisabled(s: S3Session, owner: string, key: string) { return own(s, owner).chats[key] === true; }
export async function setPrefs(s: S3Session, owner: string, input: { enabled: boolean; automatic: boolean; consent?: boolean }) {
  const state = own(s, owner);
  if (input.automatic && !state.prefs.automatic && !input.consent) throw new MemoryInputError("Нужно согласие на автоматическое запоминание");
  throttle(state);
  state.prefs = { enabled: input.enabled, automatic: input.enabled && input.automatic, generation: state.prefs.generation + 1 };
  return state.prefs;
}
export async function saveFact(s: S3Session, owner: string, input: SaveFact, source = "manual", internal?: { slot: string; confidence: number; importance: number; status: "active" | "conflict" }) {
  const state = own(s, owner);
  if (!internal) throttle(state);
  const content = validateFact(input.content, input.confirmSensitive === true);
  const inferred = extractFacts(content)[0];
  if (input.category !== undefined && !(CATEGORIES as readonly unknown[]).includes(input.category)) throw new MemoryInputError("Неизвестная категория");
  const category = (input.category || inferred?.category || "other") as Category;
  let expiry: string | null = null;
  if (input.expiresAt) {
    const ms = Date.parse(input.expiresAt);
    if (!Number.isFinite(ms) || ms <= Date.now() || ms > Date.now() + 3650 * 86400_000) throw new MemoryInputError("Некорректный срок хранения");
    expiry = new Date(ms).toISOString();
  }
  const duplicate = state.entries.find(r => fingerprint(r.content) === fingerprint(content));
  if (duplicate && duplicate.id !== input.id) return { id: duplicate.id, duplicate: true };
  const slot = internal?.slot || inferred?.slot || "";
  const now = new Date().toISOString();
  let id = input.id;
  if (id) {
    const old = state.entries.find(r => r.id === id && r.version === input.version);
    if (!old) throw new MemoryInputError("Запись изменена или удалена. Обновите список");
    if (input.activate && (old.status !== "conflict" || !old.slot || old.slot !== slot)) throw new MemoryInputError("Подтвердить можно только неизменённый слот конфликтующей записи");
    if (input.activate) state.entries = state.entries.filter(r => r.id === id || r.slot !== old.slot || r.status !== "active");
    const collision = slot && state.entries.some(r => r.id !== id && r.slot === slot && r.status === "active");
    Object.assign(old, { content, category, slot, sensitive: isSensitive(content), expires_at: expiry, source_type: source, status: input.activate ? "active" : collision ? "conflict" : old.status, version: old.version + 1, updated_at: now });
  } else {
    if (state.entries.length >= MAX_MEMORIES) throw new MemoryInputError(`Достигнут предел: ${MAX_MEMORIES} записей`);
    id = crypto.randomUUID();
    const collision = slot && state.entries.some(r => r.slot === slot && r.status === "active");
    state.entries.push({ id, content, category, slot, sensitive: isSensitive(content), expires_at: expiry, source_type: source, status: internal?.status || (collision ? "conflict" : "active"), version: 1, confidence: internal?.confidence ?? 1, importance: internal?.importance ?? 8, created_at: now, updated_at: now, last_used_at: null });
  }
  if (source !== "automatic") state.blocks = state.blocks.filter(h => h !== fingerprint(content));
  state.prefs.generation++;
  return { id, duplicate: false };
}
export async function removeFact(s: S3Session, owner: string, id: string, version: number) {
  const state = own(s, owner);
  throttle(state);
  const row = state.entries.find(r => r.id === id && r.version === version);
  if (!row) throw new MemoryInputError("Запись изменена или удалена. Обновите список");
  if (state.blocks.length >= 512) throw new MemoryInputError("Для дальнейшей очистки используйте «Удалить всю память»");
  state.blocks.push(fingerprint(row.content));
  state.entries = state.entries.filter(r => r.id !== id);
  state.prefs.generation++;
}
export async function clearFacts(s: S3Session, owner: string) {
  const state = own(s, owner); throttle(state);
  state.entries = []; state.blocks = []; state.prefs.automatic = false; state.prefs.generation++;
}
export async function setChatPolicy(s: S3Session, owner: string, key: string, disabled: boolean) {
  if (!/^[A-Za-z0-9_-]{3,100}$/.test(key)) throw new MemoryInputError("Диалог не найден");
  const state = own(s, owner);
  if (key !== "telegram") {
    const { getSql } = await import("../db");
    const [row] = await (await getSql()).query<{ user_id: string }>("select user_id from saved_chats where id=$1", [key]);
    if (row && row.user_id !== owner) throw new MemoryInputError("Диалог недоступен");
  }
  if (!(key in state.chats) && Object.keys(state.chats).length >= 256) throw new MemoryInputError("Достигнут предел настроек диалогов");
  throttle(state); state.chats[key] = disabled; state.prefs.generation++;
}
export async function captureFacts(s: S3Session, owner: string, text: string, key: string, generation: number) {
  const state = own(s, owner);
  if (!state.prefs.enabled || !state.prefs.automatic || state.prefs.generation !== generation || state.chats[key]) return 0;
  const candidates = extractFacts(text);
  if (!candidates.length) return 0;
  throttle(state);
  let count = 0;
  for (const c of candidates) {
    if (state.blocks.includes(fingerprint(c.content))) continue;
    const existing = state.entries.some(r => r.slot === c.slot && r.status === "active");
    const result = await saveFact(s, owner, { content: c.content, category: c.category, expiresAt: new Date(Date.now() + 365 * 86400_000).toISOString() }, "automatic", { ...c, status: existing ? "conflict" : "active" });
    if (!result.duplicate) count++;
  }
  return count;
}
export async function retrieveFacts(s: S3Session, owner: string, query: string, key: string) {
  const settings = await prefs(s, owner);
  return { settings, rows: settings.enabled && !(await chatDisabled(s, owner, key)) ? rankMemory(await listFacts(s, owner), query) : [] as MemoryFact[] };
}
export async function event(_s: S3Session, _owner: string, _operation: string, _outcome: string, _ms = 0, _facts = 0) { /* No fact data or account enumeration in aggregate logs. */ }
