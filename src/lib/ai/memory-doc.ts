import { isMemorySecret, memoryFact } from "./memory.ts";

export const MEMORY_TEXT_MAX = 500;
export const MEMORY_ENTRY_MAX = 40;
export const MEMORY_JSON_MAX = 64 * 1024;
export const TOMBSTONE_MAX = 80;

export type MemoryCategory = "identity" | "preferences" | "personal" | "projects" | "instructions";

export type MemoryFact = {
  id: string;
  text: string;
  category?: MemoryCategory;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
};

export type ChatMark = { id: string; off: boolean; at: string };

export type MemoryDocument = {
  schemaVersion: 2;
  revision: number;
  updatedAt: string;
  entries: MemoryFact[];
  settings: { enabled: boolean; disabledChats: string[] };
  meta: { enabledAt: string; chatMarks: ChatMark[] };
};

export type LegacyMemory = {
  enabled: boolean;
  entries: { id: string; text: string; updatedAt?: number }[];
  disabledChats: string[];
};

export type MigrateInput = {
  mode: "migrate";
  enabled: boolean;
  disabledChats: string[];
  entries: { id: string; text: string; updatedAt?: string | number }[];
};

export type EditInput = {
  mode: "edit";
  enabledTouched: boolean;
  enabled: boolean;
  chatTouches: { id: string; off: boolean }[];
  upserts: { id: string; text: string; updatedAt: string }[];
  deletes: { id: string; seenUpdatedAt: string }[];
};

export type MemoryInput = MigrateInput | EditInput;

export type Produced = { doc: MemoryDocument; changed: boolean } | { error: string };

export type MemoryView = {
  ok: true;
  missing: boolean;
  revision: number;
  updatedAt: string;
  syncedAt: string;
  enabledAt: string;
  settings: { enabled: boolean; disabledChats: string[] };
  chatMarks: ChatMark[];
  entries: { id: string; text: string; category?: MemoryCategory; createdAt: string; updatedAt: string }[];
  deleted: { id: string; text: string; deletedAt: string }[];
};

export type MemoryFailure = {
  ok: false;
  error: "MEMORY_WRITE_FAILED" | "MEMORY_STORE_UNAVAILABLE" | "MEMORY_READ_FAILED" | "REJECTED";
  message: string;
};

export type MemoryResponse = MemoryView | MemoryFailure;

const CATEGORIES = new Set<MemoryCategory>(["identity", "preferences", "personal", "projects", "instructions"]);
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const USER_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const CHAT_RE = /^[A-Za-z0-9_-]{1,80}$/;

export function memoryObjectKey(userId: string): string {
  const id = typeof userId === "string" ? userId.trim() : "";
  if (!USER_RE.test(id) || id.includes("..") || id.includes("/") || id.includes("\\") || id.includes("%")) {
    throw new Error("BAD_USER");
  }
  return `vvvion-memory/v2/users/${id}/memory.json`;
}

export function normFact(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export function categoryFor(text: string): MemoryCategory | undefined {
  const value = text.trim().toLowerCase();
  if (value.startsWith("имя:") || value.startsWith("возраст:")) return "identity";
  if (value.startsWith("предпочтение:")) return "preferences";
  if (value.startsWith("работа:") || value.startsWith("город:") || value.startsWith("личное:")) return "personal";
  if (value.startsWith("проект:")) return "projects";
  if (value.startsWith("инструкция:")) return "instructions";
  return undefined;
}

export function cleanUserText(text: string): string | null {
  const clean = text.replace(/\s+/g, " ").trim().slice(0, MEMORY_TEXT_MAX);
  if (!clean || isMemorySecret(clean)) return null;
  return clean;
}

export function emptyDocument(now = new Date().toISOString()): MemoryDocument {
  return {
    schemaVersion: 2,
    revision: 0,
    updatedAt: now,
    entries: [],
    settings: { enabled: true, disabledChats: [] },
    meta: { enabledAt: now, chatMarks: [] },
  };
}

function isoOf(value: unknown, fallback: string): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  if (typeof value === "string") {
    const time = Date.parse(value);
    if (!Number.isNaN(time)) return new Date(time).toISOString();
  }
  return fallback;
}

export function safeId(value: unknown): string {
  if (typeof value === "string" && ID_RE.test(value)) return value;
  return crypto.randomUUID();
}

function chatId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return CHAT_RE.test(id) ? id : null;
}

export function cleanDocument(value: unknown, now = new Date().toISOString()): MemoryDocument {
  const doc = emptyDocument(now);
  if (!value || typeof value !== "object") return doc;
  const raw = value as Partial<MemoryDocument> & { settings?: { enabled?: unknown; disabledChats?: unknown } };
  doc.revision = Number.isInteger(raw.revision) && (raw.revision as number) > 0 ? Math.min(raw.revision as number, 1_000_000_000) : 0;
  doc.updatedAt = isoOf(raw.updatedAt, now);
  doc.settings.enabled = raw.settings?.enabled !== false;
  doc.meta.enabledAt = isoOf(raw.meta?.enabledAt, doc.updatedAt);
  const marks = new Map<string, ChatMark>();
  if (Array.isArray(raw.meta?.chatMarks)) {
    for (const mark of raw.meta.chatMarks) {
      if (!mark || typeof mark !== "object") continue;
      const id = chatId((mark as ChatMark).id);
      if (!id) continue;
      marks.set(id, { id, off: (mark as ChatMark).off === true, at: isoOf((mark as ChatMark).at, doc.updatedAt) });
    }
  }
  if (Array.isArray(raw.settings?.disabledChats)) {
    for (const item of raw.settings.disabledChats) {
      const id = chatId(item);
      if (id && !marks.has(id)) marks.set(id, { id, off: true, at: doc.meta.enabledAt });
    }
  }
  doc.meta.chatMarks = [...marks.values()].slice(-100);
  doc.settings.disabledChats = doc.meta.chatMarks.filter((mark) => mark.off).map((mark) => mark.id);
  const entries: MemoryFact[] = [];
  const seen = new Set<string>();
  if (Array.isArray(raw.entries)) {
    for (const item of raw.entries) {
      if (!item || typeof item !== "object") continue;
      const row = item as Partial<MemoryFact>;
      const text = cleanUserText(typeof row.text === "string" ? row.text : "");
      if (!text || seen.has(normFact(text))) continue;
      const id = safeId(row.id);
      if (entries.some((entry) => entry.id === id)) continue;
      seen.add(normFact(text));
      const category = typeof row.category === "string" && CATEGORIES.has(row.category as MemoryCategory) ? (row.category as MemoryCategory) : categoryFor(text);
      const updatedAt = isoOf(row.updatedAt, doc.updatedAt);
      const fact: MemoryFact = { id, text, createdAt: isoOf(row.createdAt, updatedAt), updatedAt };
      if (category) fact.category = category;
      const deletedAt = row.deletedAt ? isoOf(row.deletedAt, "") : "";
      if (deletedAt) fact.deletedAt = deletedAt;
      entries.push(fact);
    }
  }
  const live = entries.filter((entry) => !entry.deletedAt).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, MEMORY_ENTRY_MAX);
  const dead = entries.filter((entry) => entry.deletedAt).sort((a, b) => (a.deletedAt! < b.deletedAt! ? 1 : -1)).slice(0, TOMBSTONE_MAX);
  const liveNorms = new Set(live.map((entry) => normFact(entry.text)));
  doc.entries = [...live, ...dead.filter((entry) => !liveNorms.has(normFact(entry.text)))];
  return doc;
}

export function toLegacy(doc: MemoryDocument) {
  return {
    enabled: doc.settings.enabled !== false,
    disabledChats: doc.settings.disabledChats.slice(-100),
    entries: doc.entries
      .filter((entry) => !entry.deletedAt)
      .map((entry) => ({ id: entry.id, text: entry.text, updatedAt: Date.parse(entry.updatedAt) || 0 })),
  };
}

export function documentFromLegacy(state: LegacyMemory, now = new Date().toISOString()): MemoryDocument {
  const doc = emptyDocument(now);
  doc.settings.enabled = state.enabled !== false;
  doc.meta.enabledAt = now;
  for (const item of state.disabledChats) {
    const id = chatId(item);
    if (!id) continue;
    doc.meta.chatMarks.push({ id, off: true, at: now });
  }
  doc.settings.disabledChats = doc.meta.chatMarks.map((mark) => mark.id);
  for (const entry of state.entries) {
    const text = cleanUserText(entry.text);
    if (!text || doc.entries.some((item) => normFact(item.text) === normFact(text))) continue;
    if (doc.entries.length >= MEMORY_ENTRY_MAX) break;
    const at = isoOf(entry.updatedAt, now);
    const fact: MemoryFact = { id: safeId(entry.id), text, createdAt: at, updatedAt: at };
    const category = categoryFor(text);
    if (category) fact.category = category;
    doc.entries.push(fact);
  }
  return doc;
}

export function documentFromView(view: MemoryView): MemoryDocument {
  const doc = emptyDocument(view.updatedAt || new Date().toISOString());
  doc.revision = view.revision || 0;
  doc.updatedAt = view.updatedAt || doc.updatedAt;
  doc.settings.enabled = view.settings.enabled !== false;
  doc.meta.enabledAt = isoOf(view.enabledAt, doc.updatedAt);
  doc.meta.chatMarks = (view.chatMarks || [])
    .map((mark) => {
      const id = chatId(mark.id);
      return id ? { id, off: mark.off === true, at: isoOf(mark.at, doc.updatedAt) } : null;
    })
    .filter((mark): mark is ChatMark => Boolean(mark))
    .slice(-100);
  doc.settings.disabledChats = doc.meta.chatMarks.filter((mark) => mark.off).map((mark) => mark.id);
  const rows: MemoryFact[] = [];
  for (const entry of view.entries || []) {
    const text = cleanUserText(entry.text);
    if (!text) continue;
    const fact: MemoryFact = {
      id: safeId(entry.id),
      text,
      createdAt: isoOf(entry.createdAt, doc.updatedAt),
      updatedAt: isoOf(entry.updatedAt, doc.updatedAt),
    };
    const category = entry.category && CATEGORIES.has(entry.category) ? entry.category : categoryFor(text);
    if (category) fact.category = category;
    rows.push(fact);
  }
  for (const entry of view.deleted || []) {
    const text = cleanUserText(entry.text);
    if (!text || rows.some((item) => normFact(item.text) === normFact(text))) continue;
    rows.push({ id: safeId(entry.id), text, createdAt: entry.deletedAt, updatedAt: entry.deletedAt, deletedAt: entry.deletedAt });
  }
  return cleanDocument({ ...doc, entries: rows });
}

export function viewOf(doc: MemoryDocument, missing: boolean, syncedAt = new Date().toISOString()): MemoryView {
  const clean = cleanDocument(doc);
  return {
    ok: true,
    missing,
    revision: clean.revision,
    updatedAt: clean.updatedAt,
    syncedAt,
    enabledAt: clean.meta.enabledAt,
    settings: { enabled: clean.settings.enabled, disabledChats: clean.settings.disabledChats },
    chatMarks: clean.meta.chatMarks,
    entries: clean.entries
      .filter((entry) => !entry.deletedAt)
      .map((entry) => ({
        id: entry.id,
        text: entry.text,
        ...(entry.category ? { category: entry.category } : {}),
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      })),
    deleted: clean.entries
      .filter((entry) => entry.deletedAt)
      .map((entry) => ({ id: entry.id, text: entry.text, deletedAt: entry.deletedAt as string })),
  };
}

export function liveTexts(doc: MemoryDocument): string[] {
  return cleanDocument(doc).entries.filter((entry) => !entry.deletedAt).map((entry) => entry.text);
}

function knownTexts(doc: MemoryDocument): Set<string> {
  return new Set(doc.entries.map((entry) => normFact(entry.text)));
}

export function mergeMigration(server: MemoryDocument, local: LegacyMemory): { doc: MemoryDocument; changed: boolean } {
  const doc = cleanDocument(server);
  const known = knownTexts(doc);
  let changed = false;
  for (const entry of local.entries) {
    const text = cleanUserText(entry.text);
    if (!text || known.has(normFact(text))) continue;
    if (doc.entries.filter((item) => !item.deletedAt).length >= MEMORY_ENTRY_MAX) break;
    const at = isoOf(entry.updatedAt, doc.updatedAt);
    const fact: MemoryFact = { id: safeId(entry.id), text, createdAt: at, updatedAt: at };
    const category = categoryFor(text);
    if (category) fact.category = category;
    doc.entries.push(fact);
    known.add(normFact(text));
    changed = true;
  }
  return { doc, changed };
}

function clampTime(value: string, now: string): string {
  const time = Date.parse(value);
  const current = Date.parse(now);
  if (Number.isNaN(time) || Number.isNaN(current)) return now;
  if (time > current + 120_000) return now;
  return new Date(time).toISOString();
}

function liveCount(doc: MemoryDocument): number {
  return doc.entries.filter((entry) => !entry.deletedAt).length;
}

export function applyEdit(doc: MemoryDocument, input: EditInput, now: string): Produced {
  const next = cleanDocument(doc, now);
  const before = JSON.stringify(next);
  if (input.enabledTouched && next.settings.enabled !== input.enabled) {
    next.settings.enabled = input.enabled;
    next.meta.enabledAt = now;
  }
  for (const touch of input.chatTouches) {
    const id = chatId(touch.id);
    if (!id) continue;
    const prev = next.meta.chatMarks.find((mark) => mark.id === id);
    if (prev?.off === touch.off) continue;
    next.meta.chatMarks = [...next.meta.chatMarks.filter((mark) => mark.id !== id), { id, off: touch.off, at: now }].slice(-100);
  }
  next.settings.disabledChats = next.meta.chatMarks.filter((mark) => mark.off).map((mark) => mark.id);
  for (const del of input.deletes) {
    const entry = next.entries.find((item) => item.id === del.id && !item.deletedAt);
    if (!entry) continue;
    if (entry.updatedAt > del.seenUpdatedAt) continue;
    entry.deletedAt = now;
  }
  for (const upsert of input.upserts) {
    const text = cleanUserText(upsert.text);
    if (!text) {
      if (input.upserts.length === 1 && input.deletes.length === 0 && !input.enabledTouched && input.chatTouches.length === 0) {
        return { error: "Пароли и ключи не сохраняются" };
      }
      continue;
    }
    const at = clampTime(upsert.updatedAt, now);
    const same = next.entries.find((item) => normFact(item.text) === normFact(text));
    const current = next.entries.find((item) => item.id === upsert.id);
    if (same && same.id !== upsert.id && !same.deletedAt) continue;
    const target = current || same;
    if (target && !target.deletedAt && target.updatedAt > at && target.text !== text) continue;
    if (target) {
      target.text = text;
      target.updatedAt = at > target.updatedAt ? at : now;
      target.createdAt = target.createdAt || at;
      delete target.deletedAt;
      const category = categoryFor(text) || target.category;
      if (category) target.category = category;
      continue;
    }
    if (liveCount(next) >= MEMORY_ENTRY_MAX) {
      if (input.upserts.length === 1 && !input.enabledTouched && input.chatTouches.length === 0 && input.deletes.length === 0) {
        return { error: "Можно сохранить до 40 записей" };
      }
      continue;
    }
    const fact: MemoryFact = { id: safeId(upsert.id), text, createdAt: at, updatedAt: at };
    const category = categoryFor(text);
    if (category) fact.category = category;
    next.entries.push(fact);
  }
  const fitted = fitDocument(next);
  if (!fitted) return { error: "Память слишком большая" };
  return { doc: fitted, changed: JSON.stringify(fitted) !== before };
}

export function applyFact(doc: MemoryDocument, text: string, now: string): Produced {
  const fact = memoryFact(text);
  if (!fact) return { error: "Это не сохраняется: пусто, вопрос, пароль или ключ." };
  return applyEdit(
    doc,
    { mode: "edit", enabledTouched: false, enabled: doc.settings.enabled, chatTouches: [], deletes: [], upserts: [{ id: crypto.randomUUID(), text: fact, updatedAt: now }] },
    now,
  );
}

export function applyForget(doc: MemoryDocument, needle: string, now: string): Produced & { forgotten?: number } {
  const clean = needle.replace(/\s+/g, " ").trim();
  if (clean.length < 2 || isMemorySecret(clean)) return { error: "Напишите, что забыть." };
  const next = cleanDocument(doc, now);
  const ids = next.entries.filter((entry) => !entry.deletedAt && entry.text.toLowerCase().includes(clean.toLowerCase()));
  if (!ids.length) return { doc: next, changed: false, forgotten: 0 };
  const edited = applyEdit(
    next,
    {
      mode: "edit",
      enabledTouched: false,
      enabled: next.settings.enabled,
      chatTouches: [],
      upserts: [],
      deletes: ids.map((entry) => ({ id: entry.id, seenUpdatedAt: entry.updatedAt })),
    },
    now,
  );
  if ("error" in edited) return edited;
  return { ...edited, forgotten: ids.length };
}

export function mergeOps(base: EditInput | null, extra: EditInput): EditInput {
  if (!base) return extra;
  const deletes = new Map(base.deletes.map((item) => [item.id, item]));
  const upserts = new Map(base.upserts.map((item) => [item.id, item]));
  for (const item of extra.deletes) {
    upserts.delete(item.id);
    deletes.set(item.id, item);
  }
  for (const item of extra.upserts) {
    deletes.delete(item.id);
    upserts.set(item.id, item);
  }
  const chats = new Map(base.chatTouches.map((item) => [item.id, item]));
  for (const item of extra.chatTouches) chats.set(item.id, item);
  return {
    mode: "edit",
    enabledTouched: extra.enabledTouched || base.enabledTouched,
    enabled: extra.enabledTouched ? extra.enabled : base.enabled,
    chatTouches: [...chats.values()],
    upserts: [...upserts.values()],
    deletes: [...deletes.values()],
  };
}

export function hasWork(ops: EditInput | null | undefined): boolean {
  if (!ops) return false;
  return ops.enabledTouched || ops.chatTouches.length > 0 || ops.upserts.length > 0 || ops.deletes.length > 0;
}

export function editOps(prev: MemoryDocument | null, next: LegacyMemory, now = new Date().toISOString()): EditInput {
  const base = prev ? cleanDocument(prev, now) : emptyDocument(now);
  const upserts: EditInput["upserts"] = [];
  const deletes: EditInput["deletes"] = [];
  for (const entry of next.entries) {
    const text = cleanUserText(entry.text);
    if (!text) continue;
    const known = base.entries.find((item) => item.id === entry.id);
    const same = base.entries.find((item) => !item.deletedAt && normFact(item.text) === normFact(text));
    if (known && !known.deletedAt && known.text === text) continue;
    if (!known && same) continue;
    upserts.push({ id: safeId(entry.id), text, updatedAt: isoOf(entry.updatedAt, now) });
  }
  for (const entry of base.entries) {
    if (entry.deletedAt) continue;
    const still = next.entries.some((item) => item.id === entry.id || normFact(item.text || "") === normFact(entry.text));
    if (!still) deletes.push({ id: entry.id, seenUpdatedAt: entry.updatedAt });
  }
  const chatTouches: EditInput["chatTouches"] = [];
  const nextOff = new Set(next.disabledChats.filter((id) => chatId(id)));
  const prevOff = new Set(base.settings.disabledChats);
  for (const id of nextOff) if (!prevOff.has(id)) chatTouches.push({ id, off: true });
  for (const id of prevOff) if (!nextOff.has(id)) chatTouches.push({ id, off: false });
  return {
    mode: "edit",
    enabledTouched: base.settings.enabled !== (next.enabled !== false),
    enabled: next.enabled !== false,
    chatTouches,
    upserts,
    deletes,
  };
}

export function planMigration(local: LegacyMemory, remote: { missing: boolean; doc: MemoryDocument } | null, migrated: boolean): { upload: boolean; doc: MemoryDocument } {
  if (migrated && remote && !remote.missing) return { upload: false, doc: cleanDocument(remote.doc) };
  if (!remote || remote.missing) {
    const doc = documentFromLegacy(local);
    const upload = doc.entries.some((entry) => !entry.deletedAt) || doc.settings.enabled === false || doc.settings.disabledChats.length > 0;
    return { upload, doc };
  }
  const merged = mergeMigration(remote.doc, local);
  return { upload: merged.changed, doc: merged.doc };
}

function shortText(value: unknown): string {
  if (typeof value !== "string") return "";
  if (value.length > 2000) throw new Error("Слишком длинная запись");
  return value;
}

export function parseMemoryInput(input: unknown): MemoryInput {
  if (!input || typeof input !== "object") throw new Error("Некорректная память");
  const raw = input as Record<string, unknown>;
  if (raw.mode === "migrate") {
    const entries = Array.isArray(raw.entries) ? raw.entries.slice(0, MEMORY_ENTRY_MAX) : [];
    return {
      mode: "migrate",
      enabled: raw.enabled !== false,
      disabledChats: Array.isArray(raw.disabledChats) ? raw.disabledChats.map(chatId).filter((id): id is string => Boolean(id)).slice(0, 100) : [],
      entries: entries.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const row = item as { id?: unknown; text?: unknown; updatedAt?: unknown };
        const text = shortText(row.text);
        if (!text) return [];
        return [{ id: safeId(row.id), text, updatedAt: typeof row.updatedAt === "number" || typeof row.updatedAt === "string" ? row.updatedAt : undefined }];
      }),
    };
  }
  if (raw.mode !== "edit") throw new Error("Некорректная память");
  const upserts = Array.isArray(raw.upserts) ? raw.upserts.slice(0, MEMORY_ENTRY_MAX) : [];
  const deletes = Array.isArray(raw.deletes) ? raw.deletes.slice(0, TOMBSTONE_MAX) : [];
  const chats = Array.isArray(raw.chatTouches) ? raw.chatTouches.slice(0, 100) : [];
  return {
    mode: "edit",
    enabledTouched: raw.enabledTouched === true,
    enabled: raw.enabled !== false,
    chatTouches: chats.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as { id?: unknown; off?: unknown };
      const id = chatId(row.id);
      return id ? [{ id, off: row.off === true }] : [];
    }),
    upserts: upserts.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as { id?: unknown; text?: unknown; updatedAt?: unknown };
      const text = shortText(row.text);
      if (!text) return [];
      return [{ id: safeId(row.id), text, updatedAt: isoOf(row.updatedAt, new Date().toISOString()) }];
    }),
    deletes: deletes.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as { id?: unknown; seenUpdatedAt?: unknown };
      const id = typeof row.id === "string" && ID_RE.test(row.id) ? row.id : "";
      if (!id) return [];
      return [{ id, seenUpdatedAt: isoOf(row.seenUpdatedAt, new Date().toISOString()) }];
    }),
  };
}

export function fitDocument(doc: MemoryDocument): MemoryDocument | null {
  const next = cleanDocument(doc);
  const size = () => JSON.stringify(next).length;
  if (size() <= MEMORY_JSON_MAX) return next;
  const tombs = next.entries.filter((entry) => entry.deletedAt).sort((a, b) => (a.deletedAt! < b.deletedAt! ? -1 : 1));
  for (const tomb of tombs) {
    next.entries = next.entries.filter((entry) => entry !== tomb);
    if (size() <= MEMORY_JSON_MAX) return next;
  }
  return size() <= MEMORY_JSON_MAX ? next : null;
}

export function legacyFromInput(input: MigrateInput): LegacyMemory {
  return {
    enabled: input.enabled,
    disabledChats: input.disabledChats,
    entries: input.entries.map((entry) => ({
      id: entry.id,
      text: entry.text,
      updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : Date.parse(String(entry.updatedAt || "")) || Date.now(),
    })),
  };
}

export function entriesForAccount(active: string | null, cachedOwner: string | null, entries: string[]): string[] {
  if (!active || active !== cachedOwner) return [];
  return entries;
}

export type MemoryBackend = {
  read(userId: string): Promise<{ doc: MemoryDocument; etag: string } | null>;
  write(userId: string, doc: MemoryDocument, match: { etag: string } | { create: true }): Promise<{ etag: string } | { conflict: true }>;
};

export type CommitResult =
  | { ok: true; missing: boolean; doc: MemoryDocument; revision: number; wrote: boolean }
  | { ok: false; error: "MEMORY_WRITE_FAILED" | "MEMORY_READ_FAILED" | "REJECTED"; message: string; doc?: MemoryDocument };

export async function commitMemory(
  backend: MemoryBackend,
  userId: string,
  produce: (doc: MemoryDocument, missing: boolean) => Produced,
  attempts = 3,
): Promise<CommitResult> {
  memoryObjectKey(userId);
  let failure: CommitResult = { ok: false, error: "MEMORY_WRITE_FAILED", message: "Не удалось сохранить, попробуйте ещё раз" };
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let current: { doc: MemoryDocument; etag: string } | null;
    try {
      current = await backend.read(userId);
    } catch {
      return { ok: false, error: "MEMORY_READ_FAILED", message: "Не удалось обновить память. Попробуйте ещё раз." };
    }
    const missing = !current;
    const base = current?.doc ?? emptyDocument();
    const produced = produce(cleanDocument(base), missing);
    if ("error" in produced) return { ok: false, error: "REJECTED", message: produced.error, doc: base };
    if (!produced.changed) return { ok: true, missing, doc: cleanDocument(base), revision: base.revision || 0, wrote: false };
    const fitted = fitDocument(produced.doc);
    if (!fitted) return { ok: false, error: "REJECTED", message: "Память слишком большая", doc: base };
    const now = new Date().toISOString();
    fitted.schemaVersion = 2;
    fitted.revision = (base.revision || 0) + 1;
    fitted.updatedAt = now;
    try {
      const put = await backend.write(userId, fitted, current ? { etag: current.etag } : { create: true });
      if ("conflict" in put) continue;
      return { ok: true, missing: false, doc: fitted, revision: fitted.revision, wrote: true };
    } catch {
      failure = { ok: false, error: "MEMORY_WRITE_FAILED", message: "Не удалось сохранить, попробуйте ещё раз", doc: base };
    }
  }
  return failure;
}

export function textsForModel(doc: MemoryDocument, clientTexts: string[]): string[] {
  const clean = cleanDocument(doc);
  const dead = new Set(clean.entries.filter((entry) => entry.deletedAt).map((entry) => normFact(entry.text)));
  const live = clean.entries.filter((entry) => !entry.deletedAt).map((entry) => entry.text);
  for (const text of clientTexts) {
    const fact = memoryFact(text);
    if (!fact || dead.has(normFact(fact)) || live.some((item) => normFact(item) === normFact(fact))) continue;
    if (live.length >= MEMORY_ENTRY_MAX) break;
    live.push(fact);
  }
  return live;
}

export function applyTextList(doc: MemoryDocument, texts: string[], now: string): MemoryDocument {
  const wanted = texts.flatMap((text) => {
    const fact = memoryFact(text) || cleanUserText(text);
    return fact ? [fact] : [];
  });
  const norms = new Set(wanted.map(normFact));
  const next = cleanDocument(doc, now);
  for (const entry of next.entries) {
    if (!entry.deletedAt && !norms.has(normFact(entry.text))) entry.deletedAt = now;
  }
  for (const fact of wanted) {
    const live = next.entries.find((entry) => !entry.deletedAt && normFact(entry.text) === normFact(fact));
    if (live) continue;
    const dead = next.entries.find((entry) => entry.deletedAt && normFact(entry.text) === normFact(fact));
    if (dead) {
      delete dead.deletedAt;
      dead.text = fact;
      dead.updatedAt = now;
      continue;
    }
    if (liveCount(next) >= MEMORY_ENTRY_MAX) break;
    const row: MemoryFact = { id: crypto.randomUUID(), text: fact, createdAt: now, updatedAt: now };
    const category = categoryFor(fact);
    if (category) row.category = category;
    next.entries.push(row);
  }
  return cleanDocument(next, now);
}
