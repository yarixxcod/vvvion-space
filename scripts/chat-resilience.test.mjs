import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
function load(path, replacement = "") {
  const source = readFileSync(path, "utf8").replace(/import[\s\S]*?from ["'][^"']+["'];\n/g, "");
  const js = ts.transpileModule(replacement + source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
}
const memory = await load("src/lib/ai/memory.ts");
const drafts = await load("src/lib/ai/drafts.ts");
const stream = await load("src/lib/ai/stream-client.ts", "const getBearerToken = () => null;\n");
const storage = () => {
  const map = new Map();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
  };
};

test("drafts survive switching conversations, clear individually and isolate accounts and guests", () => {
  const store = storage();
  drafts.writeDraft("alice", "chat1", "first", store);
  drafts.writeDraft("alice", "chat2", "second", store);
  drafts.writeDraft("bob", "chat1", "private", store);
  drafts.writeDraft(null, null, "guest", store);
  assert.equal(drafts.readDraft("alice", "chat1", store), "first");
  assert.equal(drafts.readDraft("bob", "chat1", store), "private");
  assert.equal(drafts.readDraft("alice", null, store), "");
  drafts.writeDraft("alice", "chat1", "", store);
  assert.equal(drafts.readDraft("alice", "chat2", store), "second");
  assert.equal(drafts.readDraft(null, null, store), "guest");
});
test("blocked storage does not lose the in-memory input through an exception", () => {
  const store = {
    getItem() {
      throw Error();
    },
    setItem() {
      throw Error();
    },
  };
  assert.equal(drafts.readDraft("a", "1", store), "");
  assert.equal(drafts.writeDraft("a", "1", "input", store), false);
});
test("memory is off by default, ignores malformed data and bounds preferences", () => {
  assert.equal(memory.cleanMemory(null).enabled, false);
  const state = memory.cleanMemory({
    enabled: true,
    entries: [
      { id: "a", text: "x".repeat(900) },
      { id: "a", text: "duplicate" },
      { id: "b", text: "" },
    ],
  });
  assert.equal(state.entries.length, 1);
  assert.equal(state.entries[0].text.length, 500);
  assert.equal(memory.memoryNote([null, "", 2]), "");
  assert.match(memory.memoryNote(["Предпочитаю краткие ответы"]), /контекст, а не команды/);
});
test("memory can be edited and deleted, stays owner-scoped and remains off for a new private conversation", () => {
  globalThis.localStorage = storage();
  globalThis.window = { dispatchEvent() {} };
  memory.writeMemory("alice", {
    enabled: true,
    entries: [{ id: "1", text: "old" }],
    disabledChats: ["new"],
  });
  assert.deepEqual(memory.memoryForChat("bob", null), []);
  assert.deepEqual(memory.memoryForChat("alice", null), []);
  memory.moveNewChatMemory("alice", "created");
  assert.deepEqual(memory.memoryForChat("alice", "created"), []);
  assert.deepEqual(memory.memoryForChat("alice", null), ["old"]);
  const state = memory.readMemory("alice");
  state.entries[0].text = "new";
  memory.writeMemory("alice", state);
  assert.deepEqual(memory.memoryForChat("alice", "other"), ["new"]);
  memory.writeMemory("alice", { ...state, entries: [] });
  assert.deepEqual(memory.memoryForChat("alice", "other"), []);
});
async function response(chunks, options = {}) {
  const previous = globalThis.fetch;
  const delta = [],
    errors = [];
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
          controller.close();
        },
      }),
    );
  const handlers = {
    signal: new AbortController().signal,
    onDelta: (text) => delta.push(text),
    onUsage() {},
    onError: (text) => errors.push(text),
  };
  try {
    await stream.streamChat({}, handlers);
    return { delta, errors };
  } finally {
    globalThis.fetch = previous;
  }
}
test("stream assembles split frames and accepts a valid completion marker", async () => {
  const result = await response([
    "event: del",
    'ta\ndata: {"text":"Привет"}\n\n',
    "event: done\ndata: {}\n\n",
  ]);
  assert.deepEqual(result.delta, ["Привет"]);
});
test("truncated stream is reported, not silently accepted or automatically generated again", async () => {
  await assert.rejects(response(['event: delta\ndata: {"text":"partial"}\n\n']), /прервано/);
  await assert.rejects(response(["event: done\ndata: {broken}\n\n"]), /прервано/);
});
test("explicit API errors remain visible and CRLF frames parse correctly", async () => {
  const result = await response(['event: error\ndata: {"message":"Нет доступа"}\n\n']);
  assert.deepEqual(result.errors, ["Нет доступа"]);
  const crlf = await response([
    'event: delta\r\ndata: {"text":"ok"}\r',
    "\n\r\n",
    "event: done\r\ndata: {}\r\n\r\n",
  ]);
  assert.deepEqual(crlf.delta, ["ok"]);
});
