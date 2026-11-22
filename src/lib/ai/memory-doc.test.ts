import assert from "node:assert/strict";
import { test } from "node:test";
import { factsFromUserText } from "./memory.ts";
import {
  applyEdit,
  applyFact,
  cleanUserText,
  commitMemory,
  documentFromLegacy,
  emptyDocument,
  entriesForAccount,
  liveTexts,
  memoryObjectKey,
  mergeMigration,
  parseMemoryInput,
  planMigration,
  type MemoryBackend,
  type MemoryDocument,
} from "./memory-doc.ts";

const NOW = "2026-11-22T12:00:00.000Z";
const LATER = "2026-11-22T13:00:00.000Z";

function must(result: { doc: MemoryDocument } | { error: string }): MemoryDocument {
  if ("error" in result) throw new Error(result.error);
  return result.doc;
}

test("object keys stay inside the memory prefix and reject traversal", () => {
  assert.equal(memoryObjectKey("dev-user"), "vvvion-memory/v2/users/dev-user/memory.json");
  assert.equal(memoryObjectKey("6f1c0a"), "vvvion-memory/v2/users/6f1c0a/memory.json");
  for (const id of ["../etc", "a/b", "a\\b", "a..b", "", "has space", "user@mail", ".."]) {
    assert.throws(() => memoryObjectKey(id), /BAD_USER/);
  }
});

test("the 41st entry is rejected and a 501-character fact is trimmed to 500", () => {
  let doc = emptyDocument(NOW);
  for (let i = 0; i < 40; i += 1) doc = must(applyFact(doc, `Факт номер ${i} сохранён`, NOW));
  const extra = applyFact(doc, "ещё один лишний факт", LATER);
  assert.equal("error" in extra, true);
  assert.equal(liveTexts(doc).length, 40);
  const long = must(applyFact(emptyDocument(NOW), `Я${"а".repeat(500)}`, NOW));
  assert.equal(long.entries[0]?.text.length, 500);
  assert.equal(cleanUserText(`б${"в".repeat(500)}`)?.length, 500);
});

test("passwords and tokens are not saved", () => {
  const secret = applyFact(emptyDocument(NOW), "пароль: hunter2", NOW);
  const token = applyFact(emptyDocument(NOW), "api key sk-test-123", NOW);
  assert.equal("error" in secret, true);
  assert.equal("error" in token, true);
  assert.equal(liveTexts(emptyDocument(NOW)).length, 0);
});

test("merge keeps distinct facts and the newer text of the same id", () => {
  let doc = must(applyFact(emptyDocument(NOW), "Имя: Старое", NOW));
  doc = must(applyFact(doc, "Город: Алматы", NOW));
  const id = doc.entries.find((entry) => entry.text.startsWith("Имя"))?.id || "";
  const merged = must(applyEdit(doc, {
    mode: "edit",
    enabledTouched: false,
    enabled: true,
    chatTouches: [],
    deletes: [],
    upserts: [
      { id, text: "Имя: Новое", updatedAt: LATER },
      { id: "job", text: "Работа: дизайнер", updatedAt: LATER },
    ],
  }, LATER));
  const texts = liveTexts(merged);
  assert.ok(texts.includes("Имя: Новое"));
  assert.equal(texts.includes("Имя: Старое"), false);
  assert.ok(texts.includes("Город: Алматы"));
  assert.ok(texts.includes("Работа: дизайнер"));
  const stale = must(applyEdit(merged, {
    mode: "edit",
    enabledTouched: false,
    enabled: true,
    chatTouches: [],
    deletes: [],
    upserts: [{ id, text: "Имя: Старое", updatedAt: NOW }],
  }, LATER));
  assert.ok(liveTexts(stale).includes("Имя: Новое"));
  assert.equal(liveTexts(stale).includes("Имя: Старое"), false);
});

test("a stale delete does not remove a newer edit, and a seen delete stays deleted", () => {
  const doc = must(applyFact(emptyDocument(LATER), "Город: Алматы", LATER));
  const id = doc.entries[0]?.id || "";
  const kept = must(applyEdit(doc, {
    mode: "edit",
    enabledTouched: false,
    enabled: true,
    chatTouches: [],
    deletes: [{ id, seenUpdatedAt: NOW }],
    upserts: [],
  }, LATER));
  assert.deepEqual(liveTexts(kept), ["Город: Алматы"]);
  const gone = must(applyEdit(doc, {
    mode: "edit",
    enabledTouched: false,
    enabled: true,
    chatTouches: [],
    deletes: [{ id, seenUpdatedAt: LATER }],
    upserts: [],
  }, LATER));
  assert.deepEqual(liveTexts(gone), []);
});

test("a missing object is an empty enabled profile and is not created until a real save", async () => {
  let writes = 0;
  const backend: MemoryBackend = {
    async read() {
      return null;
    },
    async write() {
      writes += 1;
      return { etag: "1" };
    },
  };
  const same = await commitMemory(backend, "alice", (doc) => ({ doc, changed: false }));
  assert.equal(same.ok, true);
  if (same.ok) {
    assert.equal(same.missing, true);
    assert.equal(same.doc.settings.enabled, true);
    assert.equal(same.doc.entries.length, 0);
  }
  assert.equal(writes, 0);
  const saved = await commitMemory(backend, "alice", (doc) => applyFact(doc, "Имя: Ярик", NOW));
  assert.equal(saved.ok, true);
  assert.equal(writes, 1);
});

test("an etag conflict retries and keeps both devices' facts", async () => {
  const store = new Map<string, { doc: MemoryDocument; etag: string }>();
  let writes = 0;
  const backend: MemoryBackend = {
    async read(userId) {
      return store.get(userId) ?? null;
    },
    async write(userId, doc) {
      writes += 1;
      if (writes === 1) {
        const other = must(applyFact(emptyDocument(NOW), "Работа: дизайнер", NOW));
        store.set(userId, { doc: other, etag: "raced" });
        return { conflict: true };
      }
      store.set(userId, { doc, etag: "ok" });
      return { etag: "ok" };
    },
  };
  const saved = await commitMemory(backend, "alice", (doc) => applyFact(doc, "Город: Алматы", LATER));
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  const texts = liveTexts(saved.doc);
  assert.ok(texts.includes("Город: Алматы"));
  assert.ok(texts.includes("Работа: дизайнер"));
  assert.equal(writes, 2);
});

test("another user cannot read this profile", async () => {
  const store = new Map<string, { doc: MemoryDocument; etag: string }>();
  const backend: MemoryBackend = {
    async read(userId) {
      return store.get(userId) ?? null;
    },
    async write(userId, doc) {
      store.set(userId, { doc, etag: "1" });
      return { etag: "1" };
    },
  };
  await commitMemory(backend, "alice", (doc) => applyFact(doc, "Имя: Аян", NOW));
  assert.equal(await backend.read("bob"), null);
  assert.equal((await backend.read("alice"))?.doc.entries[0]?.text, "Имя: Аян");
  assert.notEqual(memoryObjectKey("alice"), memoryObjectKey("bob"));
});

test("migration uploads local facts only when the server object is absent and does not overwrite it", () => {
  const local = {
    enabled: true,
    disabledChats: [],
    entries: [
      { id: "1", text: "Имя: Аян", updatedAt: 1 },
      { id: "2", text: "Город: Алматы", updatedAt: 2 },
      { id: "3", text: "Город: Астана", updatedAt: 3 },
    ],
  };
  const missing = planMigration(local, null, false);
  assert.equal(missing.upload, true);
  assert.ok(liveTexts(missing.doc).includes("Город: Алматы"));
  const server = documentFromLegacy({ enabled: true, disabledChats: [], entries: [{ id: "s", text: "Имя: Аян", updatedAt: 5 }] }, NOW);
  server.entries.push({ id: "dead", text: "Город: Астана", createdAt: NOW, updatedAt: NOW, deletedAt: NOW });
  const merged = mergeMigration(server, local);
  const texts = liveTexts(merged.doc);
  assert.ok(texts.includes("Имя: Аян"));
  assert.ok(texts.includes("Город: Алматы"));
  assert.equal(texts.includes("Город: Астана"), false);
  assert.equal(texts.filter((item) => item === "Имя: Аян").length, 1);
  const again = planMigration(local, { missing: false, doc: merged.doc }, true);
  assert.equal(again.upload, false);
  const empty = planMigration({ enabled: true, entries: [], disabledChats: [] }, null, false);
  assert.equal(empty.upload, false);
});

test("logout and account switch hide the previous account", () => {
  assert.deepEqual(entriesForAccount(null, "alice", ["Имя: Аян"]), []);
  assert.deepEqual(entriesForAccount("bob", "alice", ["Имя: Аян"]), []);
  assert.deepEqual(entriesForAccount("alice", "alice", ["Имя: Аян"]), ["Имя: Аян"]);
});

test("the client cannot choose whose memory is saved", () => {
  const parsed = parseMemoryInput({
    mode: "edit",
    userId: "victim",
    enabled: true,
    enabledTouched: false,
    chatTouches: [],
    deletes: [],
    upserts: [{ id: "1", text: "Имя: Ярик", updatedAt: NOW }],
  });
  assert.equal("userId" in parsed, false);
  assert.equal(parsed.mode, "edit");
  assert.throws(() => parseMemoryInput({ mode: "edit", upserts: [{ id: "1", text: "я".repeat(2001) }] }), /длинная/);
});

test("age and pets are durable facts", () => {
  assert.deepEqual(factsFromUserText("Меня зовут Ярик"), ["Имя: Ярик"]);
  assert.deepEqual(factsFromUserText("Мне 23"), ["Возраст: 23"]);
  assert.deepEqual(factsFromUserText("У меня две кошки и три собаки"), ["Личное: две кошки и три собаки"]);
});
