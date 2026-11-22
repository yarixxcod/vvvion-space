import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { readFileSync } from "node:fs";
function load(name) {
  const output = ts.transpileModule(readFileSync(`src/lib/ai/${name}.ts`, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("exports", output)(exports);
  return exports;
}
const { createProviderRouter } = load("provider-router");
const { plainAgentReply, parseToolArguments, embeddedToolCalls, toolCallsFromMessage } = load("agent-loop");
const targets = [0, 1, 2].map((i) => ({
  url: String(i),
  headers: new Headers(),
  secret: `key${i}`,
  model: `model${i}`,
}));
const ok = (text = "ok") => ({
  failed: false,
  response: Response.json({ choices: [{ message: { content: text } }] }),
});
const fail = () => ({
  failed: true,
  response: Response.json({ message: "Unavailable" }, { status: 503 }),
});

test("primary always wins; a new user turn resets priority", async () => {
  const used = [];
  const send = async (url) => {
    used.push(url);
    return ok();
  };
  await createProviderRouter(targets, send, new AbortController().signal).send({ model: "alias" });
  await createProviderRouter(targets, send, new AbortController().signal).send({ model: "alias" });
  assert.deepEqual(used, ["0", "0"]);
});
test("agent resumes with the same history and skips only providers that failed this turn", async () => {
  const used = [];
  const send = async (url, _h, payload) => {
    used.push([url, payload]);
    return url === "0" ? fail() : ok();
  };
  const router = createProviderRouter(targets, send, new AbortController().signal);
  const messages = [{ role: "user", content: "create a folder" }];
  await router.send({ messages });
  messages.push({ role: "tool", content: "folder-created" });
  await router.send({ messages });
  assert.deepEqual(
    used.map((x) => x[0]),
    ["0", "1", "1"],
  );
  assert.equal(used.at(-1)[1].messages.at(-1).content, "folder-created");
  assert.equal(used.at(-1)[1].model, "model1");
});
test("HTTP 200 errors and empty answers trigger the next provider", async () => {
  for (const body of [
    { error: { message: "bad" } },
    { choices: [] },
    { choices: [{ message: { content: "" } }] },
  ]) {
    const used = [];
    await createProviderRouter(
      targets,
      async (url) => {
        used.push(url);
        return url === "0" ? { failed: false, response: Response.json(body) } : ok();
      },
      new AbortController().signal,
    ).send({});
    assert.deepEqual(used, ["0", "1"]);
  }
});
test("SSE errors and empty role-only streams fail over before visible output", async () => {
  for (const body of [
    'data: {"error":{"message":"bad"}}\n\n',
    'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\ndata: [DONE]\n\n',
  ]) {
    const used = [];
    const response = await createProviderRouter(
      targets,
      async (url) => {
        used.push(url);
        return url === "0"
          ? {
              failed: false,
              response: new Response(body, { headers: { "content-type": "text/event-stream" } }),
            }
          : ok();
      },
      new AbortController().signal,
    ).send({ stream: true });
    assert.deepEqual(used, ["0", "1"]);
    assert.equal(response.failed, false);
  }
});
test("a valid stream is not mixed with a second provider", async () => {
  const body =
    'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\ndata: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: [DONE]\n\n';
  let count = 0;
  const result = await createProviderRouter(
    targets,
    async () => {
      count++;
      return {
        failed: false,
        response: new Response(body, { headers: { "content-type": "text/event-stream" } }),
      };
    },
    new AbortController().signal,
  ).send({ stream: true });
  assert.equal(await result.response.text(), body);
  assert.equal(count, 1);
});
test("models without tools use JSON on the primary, then normal text receives flattened results", async () => {
  const calls = [];
  const router = createProviderRouter(
    targets,
    async (url, _h, payload) => {
      calls.push([url, payload]);
      return payload.tools
        ? {
            failed: true,
            response: Response.json({ message: "tools unsupported" }, { status: 400 }),
          }
        : ok('{"tool":"my_folders","arguments":{}}');
    },
    new AbortController().signal,
  );
  const result = await router.send({
    messages: [{ role: "user", content: "show folders" }],
    tools: [{ type: "function", function: { name: "my_folders" } }],
    tool_choice: "auto",
  });
  assert.equal(result.plainTools, true);
  assert.deepEqual(
    calls.map((x) => x[0]),
    ["0", "0"],
  );
  assert.equal(calls[1][1].tools, undefined);
  await router.send({ messages: [{ role: "tool", tool_call_id: "1", content: "result" }] });
  assert.equal(calls.at(-1)[1].messages[0].role, "user");
});
test("timeouts advance priority; caller cancellation never starts a fallback", async () => {
  const used = [];
  const send = async (url, _h, _p, signal) => {
    used.push(url);
    if (url === "0")
      await new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
      );
    return ok();
  };
  await createProviderRouter(targets, send, new AbortController().signal, 10).send({});
  assert.deepEqual(used, ["0", "1"]);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => createProviderRouter(targets, send, controller.signal).send({}), {
    name: "AbortError",
  });
  assert.deepEqual(used, ["0", "1"]);
});
test("weak-model JSON parser accepts only explicit action objects and rejects malformed arguments", () => {
  assert.equal(plainAgentReply("I will save it"), null);
  assert.equal(
    plainAgentReply('```json\n{"tool":"my_files","arguments":{}}\n```').call.name,
    "my_files",
  );
  assert.equal(plainAgentReply('{"answer":"Done"}').answer, "Done");
  assert.equal(parseToolArguments("["), null);
  assert.equal(parseToolArguments("[]"), null);
  assert.equal(
    plainAgentReply('Сейчас сохраню.\n{"tool":"save_my_text","arguments":{"name":"a.txt","text":"x"}}')
      .call.name,
    "save_my_text",
  );
  const tagged = embeddedToolCalls('<tool_call>{"name":"save_my_text","arguments":{"name":"a.md","text":"x"}}</tool_call>');
  assert.equal(tagged[0].name, "save_my_text");
  assert.equal(JSON.parse(tagged[0].args).text, "x");
  const xml = embeddedToolCalls("<tool_call>\n<function=create_my_folder>\n<parameter=name>\nПланы\n</parameter>\n<parameter=storage>\ndisk\n</parameter>\n</function>\n</tool_call>");
  assert.equal(xml[0].name, "create_my_folder");
  assert.equal(JSON.parse(xml[0].args).storage, "disk");
  assert.equal(embeddedToolCalls("Просто расскажу, без вызова.").length, 0);
  const legacy = toolCallsFromMessage({ function_call: { name: "my_files", arguments: {} } });
  assert.equal(legacy[0].name, "my_files");
  const flat = toolCallsFromMessage({ tool_calls: [{ id: "call_1", name: "my_folders", arguments: "{\"storage\":\"disk\"}" }] });
  assert.equal(flat[0].id, "call_1");
  assert.equal(flat[0].name, "my_folders");
});

test('a provider error after visible text continues once without exposing an intermediate error', async()=>{
  const {recoverChatStream}=load('provider-router');
  const stream=(parts)=>new ReadableStream({start(controller){for(const part of parts)controller.enqueue(new TextEncoder().encode(part));controller.close();}});
  let resumed=0;
  const result=recoverChatStream(stream(['event: delta\ndata: {"text":"Начало"}\n\n','event: error\ndata: {"message":"provider"}\n\n','event: done\ndata: {}\n\n']),async()=>{resumed++;return stream(['event: delta\ndata: {"text":" продолжение"}\n\n','event: done\ndata: {}\n\n']);},new AbortController().signal);
  const text=await new Response(result).text();assert.equal(resumed,1);assert.ok(text.includes('Начало'));assert.ok(text.includes('продолжение'));assert.equal(text.includes('event: error'),false);assert.equal(text.match(/event: done/g).length,1);
});

test('safe user-facing error text does not hide the native-tools capability signal',async()=>{
 const used=[];
 const result=await createProviderRouter(targets,async(url,_h,payload)=>{used.push(url);return payload.tools?{failed:true,unsupportedTools:true,response:Response.json({message:'Эндпоинт не найден. Проверьте адрес.'},{status:404})}:ok('{"answer":"Готово"}');},new AbortController().signal).send({tools:[{type:'function',function:{name:'my_files'}}],messages:[]});
 assert.equal(result.plainTools,true);assert.deepEqual(used,['0','0']);
});

test("plain adapter retains nested schemas and protocol even with a full system prompt", async () => {
  const used=[];
  const router=createProviderRouter(targets,async(_u,_h,p)=>{used.push(p);if(p.tools)return {failed:true,response:Response.json({error:"unsupported tools"},{status:400})};return ok();},new AbortController().signal);
  await router.send({messages:[{role:"system",content:"x".repeat(24000)}],tools:[{type:"function",function:{name:"edit_my_file",description:"Edit",parameters:{type:"object",properties:{edits:{type:"array",items:{type:"object",properties:{old_text:{type:"string"},new_text:{type:"string"}}}}},required:["edits"]}}}]});
  const system=used.at(-1).messages[0].content;
  assert.ok(system.length<=24000); assert.match(system,/old_text/);assert.match(system,/required/);assert.match(system,/Верни только один JSON/);
});
