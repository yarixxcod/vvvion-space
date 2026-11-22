import { readMemory, writeMemory, type MemoryState } from "@/lib/ai/memory";
import {
  applyEdit,
  applyTextList,
  documentFromLegacy,
  documentFromView,
  editOps,
  hasWork,
  mergeOps,
  planMigration,
  toLegacy,
  type EditInput,
  type MemoryDocument,
  type MemoryView,
} from "@/lib/ai/memory-doc";
import { loadMemoryProfile, saveMemoryProfile } from "@/lib/ai/memory-sync";

export type SyncPhase = "idle" | "loading" | "saving" | "synced" | "pending" | "error";

export type SyncResult = {
  ok: boolean;
  phase: SyncPhase;
  state: MemoryState;
  syncedAt: string | null;
  message?: string;
};

type CacheFile = {
  migrated: boolean;
  syncedAt: string | null;
  pending: EditInput | null;
  doc: MemoryDocument | null;
};

const cacheKey = (owner: string) => `vv-memory-v2:${encodeURIComponent(owner)}`;

function blank(): CacheFile {
  return { migrated: false, syncedAt: null, pending: null, doc: null };
}

export function readCache(store: Pick<Storage, "getItem">, owner: string): CacheFile {
  try {
    const raw = store.getItem(cacheKey(owner));
    if (!raw) return blank();
    const parsed = JSON.parse(raw) as Partial<CacheFile>;
    return {
      migrated: parsed.migrated === true,
      syncedAt: typeof parsed.syncedAt === "string" ? parsed.syncedAt : null,
      pending: parsed.pending && typeof parsed.pending === "object" ? (parsed.pending as EditInput) : null,
      doc: parsed.doc ? documentFromView(viewish(parsed.doc)) : null,
    };
  } catch {
    return blank();
  }
}

function viewish(doc: MemoryDocument): MemoryView {
  return {
    ok: true,
    missing: false,
    revision: doc.revision || 0,
    updatedAt: doc.updatedAt,
    syncedAt: doc.updatedAt,
    enabledAt: doc.meta?.enabledAt || doc.updatedAt,
    settings: doc.settings || { enabled: true, disabledChats: [] },
    chatMarks: doc.meta?.chatMarks || [],
    entries: (doc.entries || []).filter((entry) => !entry.deletedAt).map((entry) => ({
      id: entry.id,
      text: entry.text,
      category: entry.category,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    })),
    deleted: (doc.entries || []).filter((entry) => entry.deletedAt).map((entry) => ({
      id: entry.id,
      text: entry.text,
      deletedAt: entry.deletedAt as string,
    })),
  };
}

export function writeCache(store: Pick<Storage, "setItem">, owner: string, doc: MemoryDocument, meta: { migrated: boolean; syncedAt: string | null; pending: EditInput | null }) {
  const state = toLegacy(doc);
  store.setItem(`vv-memory-v1:${encodeURIComponent(owner)}`, JSON.stringify(state));
  store.setItem(cacheKey(owner), JSON.stringify({ ...meta, doc }));
}

function fail(owner: string, message: string): SyncResult {
  const cache = readCache(localStorage, owner);
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  return {
    ok: false,
    phase: offline ? "pending" : "error",
    state: cache.doc ? toLegacy(cache.doc) : readMemory(owner),
    syncedAt: cache.syncedAt,
    message,
  };
}

function adopt(owner: string, view: MemoryView, migrated: boolean): SyncResult {
  const doc = documentFromView(view);
  writeCache(localStorage, owner, doc, { migrated, syncedAt: view.syncedAt, pending: null });
  window.dispatchEvent(new Event("vv-memory-change"));
  return { ok: true, phase: "synced", state: toLegacy(doc), syncedAt: view.syncedAt };
}

async function writeOps(owner: string, ops: EditInput, base: MemoryDocument): Promise<SyncResult> {
  const now = new Date().toISOString();
  const applied = applyEdit(base, ops, now);
  if ("error" in applied) return { ok: false, phase: "error", state: toLegacy(base), syncedAt: null, message: applied.error };
  const cache = readCache(localStorage, owner);
  writeCache(localStorage, owner, applied.doc, { migrated: cache.migrated, syncedAt: cache.syncedAt, pending: hasWork(ops) ? ops : null });
  window.dispatchEvent(new Event("vv-memory-change"));
  if (!hasWork(ops)) return { ok: true, phase: "synced", state: toLegacy(applied.doc), syncedAt: cache.syncedAt };
  let saved;
  try {
    saved = await saveMemoryProfile({ data: ops });
  } catch {
    return fail(owner, "Не удалось сохранить, попробуйте ещё раз");
  }
  if (!saved.ok) return fail(owner, saved.message || "Не удалось сохранить, попробуйте ещё раз");
  return adopt(owner, saved, true);
}

async function pullOnce(owner: string): Promise<SyncResult> {
  let remote;
  try {
    remote = await loadMemoryProfile();
  } catch {
    return fail(owner, "Не удалось обновить память. Попробуйте ещё раз.");
  }
  if (!remote.ok) return fail(owner, remote.message || "Не удалось обновить память. Попробуйте ещё раз.");
  const cache = readCache(localStorage, owner);
  const local = readMemory(owner);
  if (!cache.migrated) {
    const plan = planMigration(local, { missing: remote.missing, doc: documentFromView(remote) }, false);
    if (plan.upload) {
      let saved;
      try {
        saved = await saveMemoryProfile({
          data: { mode: "migrate", enabled: local.enabled, disabledChats: local.disabledChats, entries: local.entries },
        });
      } catch {
        return fail(owner, "Не удалось сохранить, попробуйте ещё раз");
      }
      if (!saved.ok) return fail(owner, saved.message || "Не удалось сохранить, попробуйте ещё раз");
      return adopt(owner, saved, true);
    }
  }
  const base = cache.doc;
  if (base) {
    const ops = mergeOps(cache.pending, editOps(base, local));
    if (hasWork(ops)) return writeOps(owner, ops, base);
  }
  return adopt(owner, remote, true);
}

async function saveOnce(owner: string, base: MemoryDocument, ops: EditInput): Promise<SyncResult> {
  const cache = readCache(localStorage, owner);
  return writeOps(owner, mergeOps(cache.pending, ops), cache.doc ?? base);
}

async function flushOnce(owner: string): Promise<SyncResult> {
  const cache = readCache(localStorage, owner);
  if (!cache.migrated || !cache.doc) return pullOnce(owner);
  const ops = mergeOps(cache.pending, editOps(cache.doc, readMemory(owner)));
  if (!hasWork(ops)) {
    return { ok: true, phase: cache.syncedAt ? "synced" : "pending", state: readMemory(owner), syncedAt: cache.syncedAt };
  }
  return writeOps(owner, ops, cache.doc);
}

const chains = new Map<string, Promise<unknown>>();

function enqueue(owner: string, run: () => Promise<SyncResult>): Promise<SyncResult> {
  const prev = chains.get(owner) ?? Promise.resolve();
  const job = prev.then(run, run);
  chains.set(owner, job.then(() => undefined, () => undefined));
  return job;
}

export function pullOwner(owner: string): Promise<SyncResult> {
  return enqueue(owner, () => pullOnce(owner));
}

export function saveOwner(owner: string, next: MemoryState): Promise<SyncResult> {
  const cache = readCache(localStorage, owner);
  const base = cache.doc ?? documentFromLegacy(readMemory(owner));
  const ops = editOps(base, next);
  writeMemory(owner, next);
  return enqueue(owner, () => saveOnce(owner, base, ops));
}

export function flushOwner(owner: string): Promise<SyncResult> {
  return enqueue(owner, () => flushOnce(owner));
}

export function noteConfirmed(owner: string, texts: string[], revision?: number): void {
  const cache = readCache(localStorage, owner);
  const now = new Date().toISOString();
  let doc = applyTextList(cache.doc ?? documentFromLegacy(readMemory(owner)), texts, now);
  if (typeof revision === "number" && revision > doc.revision) doc = { ...doc, revision };
  if (cache.pending && hasWork(cache.pending)) {
    const applied = applyEdit(doc, cache.pending, now);
    if (!("error" in applied)) doc = applied.doc;
  }
  writeCache(localStorage, owner, doc, {
    migrated: cache.migrated,
    syncedAt: cache.pending ? cache.syncedAt : now,
    pending: cache.pending,
  });
  window.dispatchEvent(new Event("vv-memory-change"));
}

export function memoryPhaseLabel(phase: SyncPhase, syncedAt: string | null): string {
  if (phase === "loading") return "Память обновляется";
  if (phase === "saving") return "Сохранение…";
  if (phase === "pending") return "Ожидает синхронизации";
  if (phase === "error") return "Ошибка синхронизации";
  if (phase === "synced") {
    if (!syncedAt) return "Синхронизировано";
    const date = new Date(syncedAt);
    if (Number.isNaN(date.getTime())) return "Синхронизировано";
    return `Синхронизировано · ${date.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`;
  }
  return "";
}
