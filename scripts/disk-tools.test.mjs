import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

let deps;
const source = readFileSync("src/lib/ai/disk-tools.server.ts", "utf8")
  .replace(/import[\s\S]*?from ["'][^"']+["'];\n/g, "")
  .replace(
    "export async function prepareDiskTools",
    "const { getSql, assertActive, readMegaDownload, peekMegaFile, storeMegaBytes, readTags } = globalThis.__diskToolsTest;\nexport async function prepareDiskTools",
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
test("creates one new file without overwrite and stops duplicate writes in same turn", async () => {
  reset();
  const tools = await pack("Сохрани файл");
  const result = JSON.parse(await tools.invoke("save_my_text", { name: "note.md", text: "hello" }));
  assert.equal(result.saved, true);
  assert.equal(deps.saved[0], "owner-123");
  assert.equal(new TextDecoder().decode(deps.saved[3]), "hello");
  assert.ok(
    JSON.parse(await tools.invoke("save_my_text", { name: "note.md", text: "again" })).error,
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
