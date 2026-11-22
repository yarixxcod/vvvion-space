import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as crypto from "node:crypto";
import ts from "typescript";
function load(path, deps = {}) {
  const js = ts.transpileModule(readFileSync(`src/lib/${path}.ts`, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function("require", "exports", js)(id => { if (id in deps) return deps[id]; throw new Error(`Missing ${id}`); }, exports);
  return exports;
}
const policy = load("memory/policy");
const objects = new Map();
let tail = Promise.resolve();
const queries = [];
const storage = {
  readMemoryObject: async owner => ({ body: objects.get(owner) ?? null, etag: '"v1"' }),
  writeMemoryObject: async (owner, body) => { objects.set(owner, body); },
};
const db = { withTransaction: fn => {
  const result = tail.then(() => fn({ query: async (q, args) => { queries.push([q,args]); return []; } }));
  tail = result.catch(() => {});
  return result;
}, getSql: async () => ({query: async () => []}) };
const memory = load("memory/s3-store.server", { "node:crypto": crypto, "./policy.ts": policy, "../storage/s3.server.ts": storage, "../db": db });
process.env.VVVION_MEMORY_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
const tx = (owner, fn) => memory.transaction(owner, s => fn(s, owner));
const rows = owner => memory.transaction(owner, s => memory.listFacts(s, owner), false);

test("S3 memory is encrypted, isolated by owner, and rejects tampering", async () => {
  await tx("alice", (s,o) => memory.setPrefs(s,o,{enabled:true,automatic:false}));
  await tx("alice", (s,o) => memory.saveFact(s,o,{content:"Я люблю TypeScript"}));
  assert.ok(!objects.get("alice").includes("TypeScript"));
  assert.equal((await rows("alice"))[0].content,"Я люблю TypeScript");
  assert.equal((await rows("bob")).length,0);
  assert.throws(() => memory.openState("bob",objects.get("alice")));
  const envelope=JSON.parse(objects.get("alice"));
  envelope.tag=Buffer.alloc(16).toString("base64");
  assert.throws(() => memory.openState("alice",JSON.stringify(envelope)));
});
test("distributed write lock prevents concurrent lost updates and stale versions", async () => {
  await Promise.all(["Я учу Python","Мой основной проект — VVVion"].map(content => tx("alice",(s,o)=>memory.saveFact(s,o,{content}))));
  assert.equal((await rows("alice")).length,3);
  assert.ok(queries.some(([q,args])=>q.includes("pg_advisory_xact_lock") && args[0]==="vvvion-memory-s3:alice"));
  const fact=(await rows("alice"))[0];
  await tx("alice",(s,o)=>memory.saveFact(s,o,{id:fact.id,version:fact.version,content:"Мой проект — Space"}));
  await assert.rejects(tx("alice",(s,o)=>memory.saveFact(s,o,{id:fact.id,version:fact.version,content:"Мой проект — stale"})),/изменена/);
});
test("S3 consent, deletion and generation fence prevent recapture", async () => {
  await assert.rejects(tx("bob",(s,o)=>memory.setPrefs(s,o,{enabled:true,automatic:true})),/согласие/);
  await tx("bob",(s,o)=>memory.setPrefs(s,o,{enabled:true,automatic:true,consent:true}));
  let settings=await memory.transaction("bob",s=>memory.prefs(s,"bob"),false);
  await tx("bob",(s,o)=>memory.captureFacts(s,o,"Я люблю TypeScript","telegram",settings.generation));
  const fact=(await rows("bob"))[0]; assert.ok(fact);
  await tx("bob",(s,o)=>memory.removeFact(s,o,fact.id,fact.version));
  assert.equal(await tx("bob",(s,o)=>memory.captureFacts(s,o,"Я люблю TypeScript","telegram",settings.generation)),0);
  settings=await memory.transaction("bob",s=>memory.prefs(s,"bob"),false);
  assert.equal(await tx("bob",(s,o)=>memory.captureFacts(s,o,"Я люблю TypeScript","telegram",settings.generation)),0);
  await tx("bob",(s,o)=>memory.clearFacts(s,o));
  assert.equal((await rows("bob")).length,0);
  assert.equal((await memory.transaction("bob",s=>memory.prefs(s,"bob"),false)).automatic,false);
});
test("S3 failed changes are not committed and secrets remain rejected", async () => {
  const before=objects.get("alice");
  await assert.rejects(tx("alice",(s,o)=>memory.saveFact(s,o,{content:"password=super-secret-value"})),/Секреты/);
  assert.equal(objects.get("alice"),before);
});

test("real memory service routes commands and retrieval to S3 without SQL memory tables",async()=>{
  Object.assign(process.env,{VVVION_MEMORY_STORAGE:"s3",VVVION_MEMORY_ENABLED:"true",VVVION_MEMORY_USERS:"service-user"});
  const sqlStore=load("memory/sql-store",{"./policy.ts":policy});
  const facade=load("memory/store",{"./sql-store.ts":sqlStore,"./s3-store.server.ts":memory});
  const flags=load("memory/flags.server");
  const service=load("memory/service.server",{"./s3-store.server":memory,"@/lib/db":db,"@/lib/social/access":{assertActive:async owner=>assert.equal(owner,"service-user")},"./flags.server":flags,"./policy":policy,"./store":facade});
  await service.mutate("service-user",s=>facade.setPrefs(s,"service-user",{enabled:true,automatic:false}));
  const saved=await service.prepareMemoryTurn("service-user",{text:"Запомни, что я люблю TypeScript",direct:true,attachments:false},"test-chat");
  assert.match(saved.reply,/сохранена/);
  const workspace=await service.workspace("service-user","test-chat");assert.equal(workspace.available,true);assert.equal(workspace.entries.length,1);
  const turn=await service.prepareMemoryTurn("service-user",{text:"TypeScript",direct:true,attachments:false},"test-chat");assert.match(turn.context,/TypeScript/);
  assert.equal((await service.workspace("other-user")).available,false);
  assert.ok(queries.every(([q])=>!q.includes("user_memor")));
});
