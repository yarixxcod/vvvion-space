import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import ts from "typescript";
const text = readFileSync("src/lib/files/documents.fn.ts", "utf8").replace(
  /import[\s\S]*?from ["'][^"']+["'];\n/g,
  "",
);
async function setup() {
  const files = new Map([
    [
      "document-01",
      {
        id: "document-01",
        name: "notes.md",
        mime: "text/markdown",
        bytes: Buffer.from("original"),
        owner: "owner-id",
        storage: "disk",
      },
    ],
    [
      "another-01",
      {
        id: "another-01",
        name: "private.txt",
        mime: "text/plain",
        bytes: Buffer.from("secret"),
        owner: "other-user",
        storage: "disk",
      },
    ],
    [
      "mega-file-01",
      {
        id: "mega-file-01",
        name: "app.js",
        mime: "text/javascript",
        bytes: Buffer.from("old code"),
        owner: "owner-id",
        storage: "mega",
        parent_id: null,
      },
    ],
  ]);
  const state = { files, quota: false, uploadFail: false, stage: 0 };
  const sql = async (parts, ...values) => {
    const query = parts.join("?");
    if (query.includes("insert into disk_accounts")) return [];
    if (query.includes("select bonus_bytes"))
      return [{ bonus_bytes: state.quota ? -100 * 1024 * 1024 : 0 }];
    if (query.includes("sum(bytes)"))
      return [
        {
          size: String(
            [...files.values()]
              .filter((x) => x.owner === "owner-id" && x.storage === "disk")
              .reduce((sum, x) => sum + x.bytes.length, 0),
          ),
        },
      ];
    if (query.includes("from disk_folders"))
      return values[1] === "owner-id" ? [{ id: values[0] }] : [];
    if (query.includes("folder_id is not distinct"))
      return [...files.values()]
        .filter(
          (row) =>
            row.owner === values[0] &&
            row.name === values[2] &&
            (row.folder_id ?? null) === values[1],
        )
        .map((row) => ({ id: row.id }));
    if (query.includes("insert into disk_files")) {
      const [id, owner, name, mime, size, encoded, folder_id] = values;
      assert.equal(owner, "owner-id");
      files.set(id, {
        id,
        owner,
        name,
        mime,
        folder_id,
        bytes: Buffer.from(encoded, "base64"),
        storage: "disk",
      });
      assert.equal(size, files.get(id).bytes.length);
      return [];
    }
    if (query.includes("update disk_files")) {
      const [encoded, size, id, owner] = values;
      const row = files.get(id);
      assert.equal(row.owner, owner);
      row.bytes = Buffer.from(encoded, "base64");
      assert.equal(row.bytes.length, size);
      return [];
    }
    if (query.includes("update mega_entries")) {
      const [name, id, owner] = values;
      const row = files.get(id);
      assert.equal(row.owner, owner);
      row.name = name;
      return [];
    }
    if (query.includes("from disk_files") || query.includes("from mega_entries")) {
      assert.match(query, /user_id/);
      const [id, owner] = values;
      const row = files.get(id);
      if (!row || row.owner !== owner) return [];
      return [{ ...row, data: row.bytes.toString("base64"), bytes: row.bytes.length }];
    }
    throw Error("Unexpected SQL " + query);
  };
  const deps = {
    authMiddleware: {},
    getSql: async () => sql,
    withTransaction: async (fn) => fn(sql),
    assertActive: async () => {},
    isPremium: async () => false,
    DISK_BASE: 100 * 1024 * 1024,
    PREMIUM_DISK: 0,
    DOCUMENT_MAX: 3 * 1024 * 1024,
    TEXT_MAX: 1024 * 1024,
    documentKind: (name) =>
      name.endsWith(".docx") ? "docx" : /\.(md|txt|js|html|css)$/.test(name) ? "text" : null,
    isSiteAsset: (name) => /\.(js|html|css|png)$/.test(name),
    encodeDiskBlob: async (_owner, bytes) => Buffer.from(bytes).toString("base64"),
    decodeDiskBlob: async (_owner, data) => Buffer.from(data, "base64"),
    createHash,
    createServerFn: () => {
      let validate;
      return {
        middleware() {
          return this;
        },
        validator(fn) {
          validate = fn;
          return this;
        },
        handler(fn) {
          return async (data) => fn({ context: { userId: "owner-id" }, data: validate(data) });
        },
      };
    },
    readMegaDownload: async (_user, id) => {
      const row = files.get(id);
      return { name: row.name, mime: row.mime, response: new Response(row.bytes) };
    },
    storeMegaBytes: async (_user, name, mime, bytes, _ttl, parent) => {
      if (state.uploadFail) throw Error("storage offline");
      const id = "staged-file-" + ++state.stage;
      files.set(id, {
        id,
        name,
        mime,
        bytes: Buffer.from(bytes),
        owner: "owner-id",
        storage: "mega",
        parent_id: parent,
      });
      return { id, name };
    },
  };
  globalThis.__documentDeps = deps;
  const prefix = "const { " + Object.keys(deps).join(",") + " } = globalThis.__documentDeps;\n";
  const js = ts.transpileModule(prefix + text, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const api = await import(
    "data:text/javascript;base64," + Buffer.from(js).toString("base64") + "#" + Math.random()
  );
  return { api, state };
}
const b64 = (text) => Buffer.from(text).toString("base64");
test("document read and preview enforce owner scope", async () => {
  const { api } = await setup();
  await assert.rejects(api.readDocument({ storage: "disk", id: "another-01" }));
  await assert.rejects(api.readSiteAsset({ storage: "disk", id: "another-01" }));
  const file = await api.readDocument({ storage: "disk", id: "document-01" });
  assert.equal(Buffer.from(file.data, "base64").toString(), "original");
});
test("disk save updates same ID, including an empty document", async () => {
  const { api, state } = await setup();
  const file = await api.readDocument({ storage: "disk", id: "document-01" });
  const saved = await api.saveDocument({
    storage: "disk",
    id: "document-01",
    version: file.version,
    data: b64(""),
  });
  assert.equal(saved.id, "document-01");
  assert.equal(state.files.get("document-01").bytes.length, 0);
  assert.equal(saved.backup, false);
});
test("stale content and renamed files reject a save", async () => {
  const { api, state } = await setup();
  const target = { storage: "disk", id: "document-01" };
  const file = await api.readDocument(target);
  state.files.get(target.id).bytes = Buffer.from("newer");
  await assert.rejects(
    api.saveDocument({ ...target, version: file.version, data: b64("mine") }),
    /изменён/,
  );
  state.files.get(target.id).bytes = Buffer.from("original");
  state.files.get(target.id).name = "renamed.md";
  await assert.rejects(
    api.saveDocument({ ...target, version: file.version, data: b64("mine") }),
    /изменён/,
  );
});
test("quota failure leaves original bytes intact", async () => {
  const { api, state } = await setup();
  const file = await api.readDocument({ storage: "disk", id: "document-01" });
  state.quota = true;
  await assert.rejects(
    api.saveDocument({
      storage: "disk",
      id: "document-01",
      version: file.version,
      data: b64("larger content"),
    }),
    /недостаточно/,
  );
  assert.equal(state.files.get("document-01").bytes.toString(), "original");
});
test("Mega upload failure never renames or removes the original", async () => {
  const { api, state } = await setup();
  const file = await api.readDocument({ storage: "mega", id: "mega-file-01" });
  state.uploadFail = true;
  await assert.rejects(
    api.saveDocument({
      storage: "mega",
      id: "mega-file-01",
      version: file.version,
      data: b64("new code"),
    }),
    /offline/,
  );
  assert.equal(state.files.get("mega-file-01").name, "app.js");
  assert.equal(state.files.get("mega-file-01").bytes.toString(), "old code");
});
test("Mega save keeps previous bytes under backup name and original filename points at new bytes", async () => {
  const { api, state } = await setup();
  const file = await api.readDocument({ storage: "mega", id: "mega-file-01" });
  const result = await api.saveDocument({
    storage: "mega",
    id: "mega-file-01",
    version: file.version,
    data: b64("new code"),
  });
  assert.equal(result.backup, true);
  assert.equal(state.files.get(result.id).name, "app.js");
  assert.equal(state.files.get(result.id).bytes.toString(), "new code");
  assert.match(state.files.get("mega-file-01").name, /до правки/);
  assert.equal(state.files.get("mega-file-01").bytes.toString(), "old code");
  await assert.rejects(
    api.saveDocument({
      storage: "mega",
      id: "mega-file-01",
      version: file.version,
      data: b64("stale"),
    }),
    /изменён/,
  );
});

test("uploads preserve existing names and enforce format limits", async () => {
  const { api, state } = await setup();
  await assert.rejects(api.uploadDiskDocument({ name: "../unsafe.html", data: b64("x") }));
  await assert.rejects(api.uploadDiskDocument({ name: "tool.exe", data: b64("x") }));
  await assert.rejects(
    api.uploadDiskDocument({ name: "notes.md", data: b64("replacement") }),
    /уже есть/,
  );
  assert.equal(state.files.get("document-01").bytes.toString(), "original");
  const saved = await api.uploadDiskDocument({ name: "index.html", data: b64("<h1>Hello</h1>") });
  assert.equal(state.files.get(saved.id).name, "index.html");
  assert.equal(state.files.get(saved.id).owner, "owner-id");
});
