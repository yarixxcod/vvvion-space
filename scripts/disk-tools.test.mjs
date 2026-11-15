import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { createHash } from "node:crypto";

let deps;
const source = readFileSync("src/lib/ai/disk-tools.server.ts", "utf8")
  .replace(/import[\s\S]*?from ["'][^"']+["'];\n/g, "")
  .replace(
    "export async function prepareDiskTools",
    "const { getSql, assertActive, readMegaDownload, peekMegaFile, storeMegaBytes, readTags, createHash, agentName, createAgentFolder, saveAgentText } = globalThis.__diskToolsTest;\nexport async function prepareDiskTools",
  );
async function pack(request = "Покажи файлы") {
  globalThis.__diskToolsTest = deps;
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const { prepareDiskTools } = await import(
    `data:text/javascript;base64,${Buffer.from(js).toString("base64")}#${Math.random()}`
  );
  return prepareDiskTools("owner-123", request, (part) => deps.images.push(part));
}
function reset() {
  deps = {
    createHash,
    agentName: (value) => {
      if (typeof value !== "string" || !value || /[/\\]/.test(value)) throw new Error("bad name");
      return value;
    },
    createAgentFolder: async (_id, storage, name) => ({
      id: "folder123",
      name,
      storage,
      created: true,
    }),
    saveAgentText: async (user, storage, name, text, folder) => {
      deps.saved = [user, name, "text/plain", new TextEncoder().encode(text), storage, folder];
      return { id: "new-file", name, url: `/api/${storage}/new-file`, saved: true };
    },
    images: [],
    calls: [],
    assertActive: async (id) => assert.equal(id, "owner-123"),
    getSql:
      async () =>
      async (strings, ...values) => {
        deps.calls.push({ query: strings.join("?"), values });
        return deps.rows ?? [];
      },
    peekMegaFile: async () => ({ name: "note.md", mime: "text/markdown", size: 5 }),
    readMegaDownload: async () => ({ response: new Response("hello") }),
    storeMegaBytes: async (...args) => {
      deps.saved = args;
      return { id: "new-file", name: args[1] };
    },
    readTags: () => ({ title: "Track", artist: "Artist", album: "", genre: "", duration: 0 }),
  };
}

test("file searches scope both disks to the authenticated owner and keep private links", async () => {
  reset();
  deps.rows = [
    { id: "abcdefghijklmnop", name: "Track", mime: "audio/mpeg", bytes: "42", storage: "mega" },
  ];
  const result = JSON.parse(await (await pack()).invoke("my_files", { query: "x' OR true--" }));
  assert.equal(result.files[0].url, "/api/mega/abcdefghijklmnop");
  assert.equal(deps.calls[0].values.filter((v) => v === "owner-123").length, 2);
  assert.ok(!deps.calls[0].query.includes("x' OR true--"));
});
test("cannot read an absent or another owner file", async () => {
  reset();
  const result = JSON.parse(
    await (await pack()).invoke("read_my_file", { id: "abcdefghijklmnop", storage: "disk" }),
  );
  assert.ok(result.error);
  assert.ok(deps.calls[0].query.includes("user_id ="));
  assert.ok(deps.calls[0].values.includes("owner-123"));
});
test("save requires explicit latest user intent and validates file names", async () => {
  reset();
  const tools = await pack();
  assert.ok(
    JSON.parse(await tools.invoke("save_my_text", { name: "note.md", text: "hello" })).error,
  );
  assert.equal(deps.saved, undefined);
  const write = await pack("Сохрани текст в файл");
  assert.ok(
    JSON.parse(await write.invoke("save_my_text", { name: "../secret.md", text: "hello" })).error,
  );
  assert.equal(deps.saved, undefined);
});
test("writes are bounded and identical retries return the same result without duplicate files", async () => {
  reset();
  const tools = await pack("Сохрани файл");
  const result = JSON.parse(await tools.invoke("save_my_text", { name: "note.md", text: "hello" }));
  assert.equal(result.saved, true);
  assert.equal(deps.saved[0], "owner-123");
  assert.equal(new TextDecoder().decode(deps.saved[3]), "hello");
  const again = JSON.parse(await tools.invoke("save_my_text", { text: "hello", name: "note.md" }));
  assert.equal(again.id, result.id);
  assert.equal(tools.changes().length, 1);
  for (let i = 1; i < 8; i++)
    await tools.invoke("save_my_text", { name: `note${i}.md`, text: "hello" });
  assert.ok(
    JSON.parse(await tools.invoke("save_my_text", { name: "overflow.md", text: "hello" })).error,
  );
});
test("bounded text reads report truncation instead of inventing binary document contents", async () => {
  reset();
  const tools = await pack();
  assert.equal(
    JSON.parse(await tools.invoke("read_my_file", { id: "abcdefghijklmnop", storage: "mega" }))
      .text,
    "hello",
  );
  deps.peekMegaFile = async () => ({ name: "book.pdf", mime: "application/pdf", size: 15 });
  const binary = await pack();
  const result = JSON.parse(
    await binary.invoke("read_my_file", { id: "abcdefghijklmnop", storage: "mega" }),
  );
  assert.equal(result.text, undefined);
  assert.match(result.note, /Binary document/);
});

test("folders and disk text files use storage and returned folder ids", async () => {
  reset();
  const tools = await pack("Создай папку и сохрани файл");
  const folder = JSON.parse(
    await tools.invoke("create_my_folder", { storage: "disk", name: "Планы" }),
  );
  const file = JSON.parse(
    await tools.invoke("save_my_text", {
      storage: "disk",
      folder_id: folder.id,
      name: "plan.md",
      text: "План",
    }),
  );
  assert.equal(file.saved, true);
  assert.equal(deps.saved[4], "disk");
  assert.equal(deps.saved[5], folder.id);
});
test("a site file without storage is written into the folder created in this request", async () => {
  reset();
  const tools = await pack("Напиши сайт, создай папку и помести туда файлы");
  assert.equal(tools.filesRequested, true);
  const folder = JSON.parse(await tools.invoke("create_my_folder", { name: "site" }));
  assert.equal(folder.storage, "disk");
  const file = JSON.parse(
    await tools.invoke("save_my_text", { name: "index.html", text: "<h1>Привет</h1>" }),
  );
  assert.equal(file.saved, true);
  assert.equal(deps.saved[4], "disk");
  assert.equal(deps.saved[5], folder.id);
});
test("editing requires this turn's complete read and version; original remains intact", async () => {
  reset();
  const tools = await pack("Измени файл");
  assert.ok(
    JSON.parse(
      await tools.invoke("write_my_file", {
        storage: "mega",
        id: "abcdefghijklmnop",
        version: "fake",
        text: "new",
      }),
    ).error,
  );
  const read = JSON.parse(
    await tools.invoke("read_my_file", { storage: "mega", id: "abcdefghijklmnop" }),
  );
  deps.rows = [{ folder_id: null }];
  const saved = JSON.parse(
    await tools.invoke("write_my_file", {
      storage: "mega",
      id: "abcdefghijklmnop",
      version: read.version,
      text: "new",
    }),
  );
  assert.equal(saved.originalPreserved, true);
  assert.equal(saved.previousId, "abcdefghijklmnop");
  assert.equal(deps.saved[1], "note.md");
});
test("cancelled agent never writes and invalid storage cannot fall through to another disk", async () => {
  reset();
  const controller = new AbortController();
  controller.abort();
  globalThis.__diskToolsTest = deps;
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const { prepareDiskTools } = await import(
    `data:text/javascript;base64,${Buffer.from(js).toString("base64")}#cancel`
  );
  const tools = await prepareDiskTools("owner-123", "Сохрани файл", () => {}, controller.signal);
  assert.ok(
    JSON.parse(await tools.invoke("save_my_text", { storage: "disk", name: "x.md", text: "x" }))
      .error,
  );
  assert.equal(deps.saved, undefined);
  const active = await pack("Сохрани файл");
  assert.ok(
    JSON.parse(await active.invoke("save_my_text", { storage: "other", name: "x.md", text: "x" }))
      .error,
  );
});

test("paged text must be fully read before a new edited version is allowed", async () => {
  reset();
  const text = "x".repeat(5000);
  deps.rows = [
    {
      name: "long.md",
      mime: "text/plain",
      bytes: 5000,
      data: Buffer.from(text).toString("base64"),
    },
  ];
  const tools = await pack("Измени файл");
  const first = JSON.parse(
    await tools.invoke("read_my_file", { storage: "disk", id: "abcdefghijklmnop" }),
  );
  assert.equal(first.text.length, 4000);
  assert.equal(first.next_offset, 4000);
  assert.ok(
    JSON.parse(
      await tools.invoke("write_my_file", {
        storage: "disk",
        id: "abcdefghijklmnop",
        version: first.version,
        text: "edited",
      }),
    ).error,
  );
  const second = JSON.parse(
    await tools.invoke("read_my_file", {
      storage: "disk",
      id: "abcdefghijklmnop",
      offset: first.next_offset,
    }),
  );
  assert.equal(second.truncated, false);
  deps.rows = [{ folder_id: null }];
  const saved = JSON.parse(
    await tools.invoke("write_my_file", {
      storage: "disk",
      id: "abcdefghijklmnop",
      version: second.version,
      text: "edited",
    }),
  );
  assert.equal(saved.originalPreserved, true);
});
test("invalid JSON is repaired before saving rather than creating a corrupt JSON file", async () => {
  reset();
  const tools = await pack("Сохрани файл");
  assert.ok(
    JSON.parse(
      await tools.invoke("save_my_text", { storage: "disk", name: "data.json", text: "{broken" }),
    ).error,
  );
  assert.equal(deps.saved, undefined);
  assert.equal(
    JSON.parse(
      await tools.invoke("save_my_text", {
        storage: "disk",
        name: "data.json",
        text: '{"ok":true}',
      }),
    ).saved,
    true,
  );
});
