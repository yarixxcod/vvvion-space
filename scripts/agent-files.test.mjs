import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
function load(path, deps = {}) {
  const js = ts.transpileModule(readFileSync(`src/lib/ai/${path}.ts`, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("require", "exports", js)((id) => {
    if (!(id in deps)) throw new Error(`Missing ${id}`);
    return deps[id];
  }, exports);
  return exports;
}
const { createProviderRouter } = load("provider-router");
const { runAgentLoop, filesFromAnswer } = load("agent-loop");

test("a weak model creates a folder, saves, reads and versions a disk file across provider failure", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create table "user"(id text primary key); insert into "user" values ('owner'),('other');
 create table disk_accounts(user_id text primary key,bonus_bytes int default 0);
 create table disk_folders(id text primary key,user_id text,name text,unique(user_id,name));
 create table disk_files(id text primary key,user_id text,name text,mime text,bytes int,kind text check(kind in ('image','audio')),data text,folder_id text);
 insert into disk_files values ('old-image','owner','old.png','image/png',3,'image','YWJj',null);
 create table mega_entries(id text,user_id text,name text,parent_id text,kind text,status text,expires_at timestamptz,mime text,bytes int);`);
    await db.exec(readFileSync("migrations/0051_disk_documents.sql", "utf8"));
    assert.equal(
      (await db.query("select kind from disk_files where id='old-image'")).rows[0].kind,
      "image",
    );
    const makeSql = (session) => {
      const sql = async (strings, ...values) =>
        (
          await session.query(
            strings.reduce(
              (text, part, i) => text + part + (i < values.length ? `$${i + 1}` : ""),
              "",
            ),
            values,
          )
        ).rows;
      sql.query = async (text, values) => (await session.query(text, values)).rows;
      return sql;
    };
    const sql = makeSql(db);
    const deps = {
      "@/lib/storage/disk-blob": { encodeDiskBlob: async (_owner, bytes) => Buffer.from(bytes).toString("base64"), decodeDiskBlob: async (_owner, data) => Buffer.from(data, "base64") },
      "@/lib/db": {
        getSql: async () => sql,
        withTransaction: (fn) => db.transaction((tx) => fn(makeSql(tx))),
      },
      "@/lib/social/premium": { isPremium: async () => false, PREMIUM_DISK: 0 },
      "@/lib/social/disk": { DISK_BASE: 1024, newId: randomUUID },
      "@/lib/social/mega": {},
    };
    const storage = load("agent-files.server", deps);
    const { prepareDiskTools } = load("disk-tools.server", {
      "node:crypto": { createHash },
      ...deps,
      "@/lib/ai/agent-files.server": storage,
      "@/lib/social/access": { assertActive: async (id) => assert.equal(id, "owner") },
      "@/lib/music/tags": {},
    });
    const pack = await prepareDiskTools("owner", "Создай папку и файл, прочитай и измени его", () => {});
    assert.equal(pack.writeRequested, true);
    assert.equal(pack.filesRequested, true);
    const poem = await prepareDiskTools("owner", "Напиши короткое стихотворение про море", () => {});
    assert.equal(poem.writeRequested, false);
    assert.equal(poem.filesRequested, false);
    let step = 0;
    const used = [];
    const targets = [0, 1].map((i) => ({
      url: String(i),
      headers: new Headers(),
      secret: "unit",
      model: "m" + i,
    }));
    const router = createProviderRouter(
      targets,
      async (url, _h, payload) => {
        used.push([url, payload]);
        if (payload.tools)
          return {
            failed: true,
            response: Response.json({ message: "tools unsupported" }, { status: 400 }),
          };
        if (url === "0" && step === 2)
          return { failed: true, response: Response.json({ message: "outage" }, { status: 503 }) };
        let content;
        if (step === 0) content = "Сейчас всё сделаю";
        if (step === 1)
          content = JSON.stringify({
            tool: "create_my_folder",
            arguments: { storage: "disk", name: "Планы" },
          });
        if (step === 2) {
          const folder = (await sql`select id from disk_folders where user_id='owner'`)[0];
          content = JSON.stringify({
            tool: "save_my_text",
            arguments: { storage: "disk", folder_id: folder.id, name: "plan.md", text: "hello" },
          });
        }
        if (step === 3) {
          const file = (await sql`select id from disk_files where kind='file'`)[0];
          content = JSON.stringify({
            tool: "read_my_file",
            arguments: { storage: "disk", id: file.id },
          });
        }
        if (step === 4) {
          const last = payload.messages
            .filter(
              (x) => typeof x.content === "string" && x.content.startsWith("Результат инструмента"),
            )
            .at(-1).content;
          const read = JSON.parse(last.slice(last.indexOf("{")));
          const file = (await sql`select id from disk_files where kind='file'`)[0];
          content = JSON.stringify({
            tool: "write_my_file",
            arguments: { storage: "disk", id: file.id, version: read.version, text: "updated" },
          });
        }
        if (step === 5) content = JSON.stringify({ answer: "Готово" });
        step++;
        return {
          failed: false,
          response: Response.json({
            choices: [{ message: { content } }],
            usage: { total_tokens: 10 },
          }),
        };
      },
      new AbortController().signal,
    );
    const wire = [{ role: "user", content: "Создай папку и файл" }];
    const result = await runAgentLoop({
      wire,
      payload: { model: "alias", tools: pack.tools, stream: false },
      send: (p) => router.send(p),
      invoke: (name, args) => pack.invoke(name, args),
      split: (p) => ({ text: p.choices[0].message.content, reason: "" }),
      calls: () => [],
      usage: (u) => u,
      signal: new AbortController().signal,
      writeRequested: true,
      hasChanges: () => pack.changes().length > 0,
    });
    assert.equal(result.text, "Готово");
    assert.equal(result.usage.total_tokens, 60);
    const files = await sql`select name,data,folder_id from disk_files where kind='file'`;
    assert.equal(files.length, 2);
    assert.deepEqual(files.map((f) => Buffer.from(f.data, "base64").toString()).sort(), [
      "hello",
      "updated",
    ]);
    assert.equal(files[0].folder_id, files[1].folder_id);
    assert.equal(pack.changes().length, 3);
    assert.ok(used.some(([url]) => url === "1"));
    const backup = used.find(([url, p]) => url === "1" && !p.tools)[1];
    assert.ok(
      backup.messages.some((m) => typeof m.content === "string" && m.content.includes("Планы")),
    );
    await sql`insert into disk_folders(id,user_id,name) values('foreignfolder','other','Private')`;
    const denied = JSON.parse(
      await pack.invoke("save_my_text", {
        storage: "disk",
        folder_id: "foreignfolder",
        name: "no.md",
        text: "secret",
      }),
    );
    assert.ok(denied.error);
    const full = JSON.parse(
      await pack.invoke("save_my_text", {
        storage: "disk",
        name: "huge.md",
        text: "a".repeat(2000),
      }),
    );
    assert.match(full.error, /места/);
    const unchanged = await sql`select count(*)::int as total from disk_files`;
    assert.equal(unchanged[0].total, 3);
    const html = await storage.saveAgentText(
      "owner",
      "disk",
      "example.html",
      "<script>alert(1)</script>",
      null,
    );
    const stored = await sql`select mime from disk_files where id = ${html.id}`;
    assert.equal(stored[0].mime, "text/plain;charset=utf-8");
  } finally {
    await db.close();
  }
});

function reply(content, calls = []) {
  return {
    failed: false,
    response: Response.json({
      choices: [{ message: { content, tool_calls: calls }, finish_reason: calls.length ? "tool_calls" : "stop" }],
    }),
  };
}

test("a saved file releases the forced tool call so the model can finish", async () => {
  const seen = [];
  let saved = false;
  const result = await runAgentLoop({
    wire: [{ role: "user", content: "Собери сайт" }],
    payload: { model: "ernie", tool_choice: "required" },
    send: async (payload) => {
      seen.push(payload.tool_choice);
      if (!saved)
        return reply("", [
          { id: "1", type: "function", function: { name: "save_my_text", arguments: "{\"name\":\"index.html\"}" } },
        ]);
      return reply("Сайт сохранён. Откройте index.html.");
    },
    invoke: async () => {
      saved = true;
      return JSON.stringify({ saved: true, name: "index.html" });
    },
    split: (body) => ({ text: body.choices[0].message.content ?? "", reason: "" }),
    calls: (body) =>
      (body.choices[0].message.tool_calls ?? []).map((call) => ({
        id: call.id,
        name: call.function.name,
        args: call.function.arguments,
      })),
    usage: () => undefined,
    signal: new AbortController().signal,
    writeRequested: true,
    filesRequested: true,
    hasChanges: () => saved,
    hasFiles: () => saved,
  });
  assert.deepEqual(seen, ["required", "auto"]);
  assert.equal(result.text, "Сайт сохранён. Откройте index.html.");
});

test("an exhausted agent reports saved work without claiming task completion", async () => {
  const result = await runAgentLoop({
    wire: [{ role: "user", content: "Собери сайт" }],
    payload: { tool_choice: "required" },
    send: async () =>
      reply("", [
        { id: "1", type: "function", function: { name: "save_my_text", arguments: "{}" } },
      ]),
    invoke: async () => JSON.stringify({ saved: true, name: "index.html" }),
    split: (body) => ({ text: body.choices[0].message.content ?? "", reason: "" }),
    calls: (body) =>
      (body.choices[0].message.tool_calls ?? []).map((call) => ({
        id: call.id,
        name: call.function.name,
        args: call.function.arguments,
      })),
    usage: () => undefined,
    signal: new AbortController().signal,
    writeRequested: true,
    filesRequested: true,
    hasChanges: () => true,
    hasFiles: () => true,
  });
  assert.match(result.text, /Сохранённые файлы/);
  assert.match(result.text, /Лимит шагов/);
  assert.doesNotMatch(result.text, /не завершила/);
});

test("a clarifying question stops the disk agent instead of a fake failure", async () => {
  let sends = 0;
  const result = await runAgentLoop({
    wire: [{ role: "user", content: "Сделай сайт" }],
    payload: { tool_choice: "required" },
    send: async () => {
      sends += 1;
      return reply("Какой цвет фона сделать?");
    },
    invoke: async () => "{}",
    split: (body) => ({ text: body.choices[0].message.content ?? "", reason: "" }),
    calls: () => [],
    usage: () => undefined,
    signal: new AbortController().signal,
    writeRequested: true,
    filesRequested: true,
    hasChanges: () => false,
    hasFiles: () => false,
  });
  assert.equal(sends, 1);
  assert.equal(result.text, "Какой цвет фона сделать?");
});

test("a site written in the answer is saved instead of a one-file error", async () => {
  const calls = [];
  const html = "<!doctype html><html><title>Кофе</title><body><p>Тёплый свет и тишина</p></body></html>";
  const result = await runAgentLoop({
    wire: [{ role: "user", content: "Собери сайт" }],
    payload: {},
    send: async () => reply("```html\n" + html + "\n```\n```css\nbody{margin:0;background:#1b1410;color:#f3e6d0}\n```"),
    invoke: async (name, args) => {
      calls.push([name, args.folder, args.files.map((file) => file.path)]);
      return JSON.stringify({ files: args.files.map((file) => ({ path: file.path, saved: true, name: file.path, url: "/api/disk/file" })) });
    },
    split: (body) => ({ text: body.choices[0].message.content ?? "", reason: "" }),
    calls: () => [],
    usage: () => undefined,
    signal: new AbortController().signal,
    writeRequested: true,
    filesRequested: true,
    hasChanges: () => calls.length > 0,
    hasFiles: () => calls.length > 0,
  });
  assert.deepEqual(calls[0], ["save_files", "Кофе", ["index.html", "styles.css"]]);
  assert.match(result.text, /сохранён/);
  assert.doesNotMatch(result.text, /один файл|после папки/);
});

test("prose without a page is not turned into files", () => {
  assert.deepEqual(filesFromAnswer("Просто объяснение, без страницы."), []);
  const page = filesFromAnswer("<!doctype html><html><title>Схемы</title><body><p>Необычный сайт по схемам, с крупной типографикой и тёплым фоном.</p></body></html>");
  assert.equal(page[0].path, "index.html");
});


test("reasoning text cannot execute tools; failed tool calls produce a receipt and allow recovery", async () => {
  let invoked=0;let step=0;
  const result=await runAgentLoop({wire:[{role:"user",content:"hello"}],payload:{},send:async()=>reply("Готово"),invoke:async()=>{invoked++;return "{}";},split:()=>({text:"Ответ",reason:'{"tool":"save_my_text","arguments":{"name":"bad.txt","text":"bad"}}'}),calls:()=>[],usage:()=>undefined,signal:new AbortController().signal,hasChanges:()=>false});
  assert.equal(invoked,0);assert.equal(result.text,"Ответ");
  const wire=[{role:"user",content:"search"}];
  await runAgentLoop({wire,payload:{},send:async()=>step++===0?reply("",[{id:"a",type:"function",function:{name:"web_search",arguments:'{"query":"docs"}'}}]):reply("Недоступно"),invoke:async()=>{throw new Error("secret details");},split:p=>({text:p.choices[0].message.content,reason:""}),calls:p=>(p.choices[0].message.tool_calls||[]).map(c=>({id:c.id,name:c.function.name,args:c.function.arguments})),usage:()=>undefined,signal:new AbortController().signal,hasChanges:()=>false});
  assert.ok(wire.some(x=>x.role==="tool" && x.content.includes("временно недоступен")));assert.ok(!JSON.stringify(wire).includes("secret details"));
});
