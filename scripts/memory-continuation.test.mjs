import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
function load(path, deps = {}) {
  const js = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("require", "exports", js)((id) => {
    if (id in deps) return deps[id];
    throw Error(`Missing ${id}`);
  }, exports);
  return exports;
}
const { runAgentLoop } = load("src/lib/ai/agent-loop.ts");
const tool = (id, name = "memory_save") => ({
  id,
  name,
  args: JSON.stringify({ text: `Fact ${id}` }),
});
function options(send, invoke = async () => JSON.stringify({ ok: true, saved: true })) {
  return {
    wire: [{ role: "user", content: "Запомни мой город и профессию" }],
    payload: { model: "deepseek", tools: [{}] },
    send,
    invoke,
    split: (b) => ({ text: b.text ?? "", reason: "display reasoning" }),
    calls: (b) => b.calls ?? [],
    usage: () => undefined,
    signal: new AbortController().signal,
    hasChanges: () => false,
  };
}
const response = (body) => ({ failed: false, response: Response.json(body) });
test("DeepSeek continuation carries exact reasoning and pairs each memory result with its call", async () => {
  let round = 0,
    writes = 0;
  const result = await runAgentLoop(
    options(
      async (p) => {
        if (round++ === 0)
          return response({
            calls: [tool("city"), tool("work"), tool("need")],
            choices: [{ message: { reasoning_content: "exact provider context" } }],
          });
        const assistant = p.messages.find((m) => m.tool_calls);
        assert.equal(assistant.reasoning_content, "exact provider context");
        assert.deepEqual(
          p.messages.filter((m) => m.role === "tool").map((m) => m.tool_call_id),
          ["city", "work", "need"],
        );
        return response({ text: "Запомнил. Чем займёмся дальше?" });
      },
      async () => {
        writes++;
        return JSON.stringify({ ok: true, saved: true });
      },
    ),
  );
  assert.equal(writes, 3);
  assert.match(result.text, /Чем займёмся/);
});
test("confirmed memory survives provider exhaustion and is never written twice", async () => {
  let round = 0,
    writes = 0;
  const result = await runAgentLoop(
    options(
      async () =>
        round++ === 0
          ? response({ calls: [tool("1"), tool("2"), tool("3")] })
          : { failed: true, response: new Response(null, { status: 502 }) },
      async () => {
        writes++;
        return JSON.stringify({ ok: true, saved: true, revision: writes });
      },
    ),
  );
  assert.equal(writes, 3);
  assert.match(result.text, /сохранены в VVVion Memory/);
  assert.match(result.text, /не смогла продолжить/);
});
test("no positive memory confirmation for failed writes", async () => {
  let round = 0;
  const result = await runAgentLoop(
    options(
      async () =>
        round++ === 0
          ? response({ calls: [tool("1")] })
          : { failed: true, response: new Response(null, { status: 502 }) },
      async () => JSON.stringify({ ok: false, saved: false, error: "MEMORY_WRITE_FAILED" }),
    ),
  );
  assert.equal(result, null);
});
test("JSON receipt becomes readable text, not raw JSON", async () => {
  let round = 0;
  const result = await runAgentLoop(
    options(async () =>
      round++ === 0
        ? response({ calls: [tool("1")] })
        : response({ text: '  {"ok":true,"saved":true}' }),
    ),
  );
  assert.match(result.text, /Запомнил/);
  assert.doesNotMatch(result.text, /"ok"/);
});
test("memory mutations are ordered and overflow tool calls get a paired refusal", async () => {
  let round = 0,
    live = 0,
    max = 0,
    writes = 0;
  const result = await runAgentLoop(
    options(
      async (p) => {
        if (round++ === 0)
          return response({ calls: Array.from({ length: 8 }, (_, i) => tool(String(i))) });
        assert.equal(p.messages.filter((m) => m.role === "tool").length, 8);
        assert.match(p.messages.filter((m) => m.role === "tool").at(-1).content, /не выполнен/);
        return response({ text: "Готово" });
      },
      async () => {
        live++;
        max = Math.max(max, live);
        await Promise.resolve();
        live--;
        writes++;
        return JSON.stringify({ ok: true, saved: true });
      },
    ),
  );
  assert.equal(max, 1);
  assert.equal(writes, 6);
  assert.equal(result.text, "Готово");
});
test("cancelled request stays cancelled after a confirmed write", async () => {
  let round = 0;
  const abort = new AbortController();
  const opt = options(async () => {
    if (round++ === 0) return response({ calls: [tool("1")] });
    abort.abort();
    throw new Error("cancelled");
  });
  opt.signal = abort.signal;
  await assert.rejects(runAgentLoop(opt), /abort/i);
});
const builder = () => ({
  middleware() {
    return this;
  },
  validator(fn) {
    this.validate = fn;
    return this;
  },
  handler(fn) {
    const validate = this.validate || ((x) => x);
    return ({ data } = {}) => fn({ data: validate(data), context: { userId: "owner" } });
  },
});
const { cleanSearchSummary } = load("src/lib/ai/search-types.ts");
let stored;
const sql = async (strings, ...values) => {
  const q = strings.join("?");
  if (q.includes("insert into shared_chats"))
    stored = { title: values[2], messages: JSON.parse(values[3]), created_ms: 123 };
  if (q.includes("select title")) return stored ? [stored] : [];
  return [];
};
const share = load("src/lib/ai/share.ts", {
  "@tanstack/react-start": { createServerFn: builder },
  "@/lib/auth/middleware": { authMiddleware: {} },
  "@/lib/db": { getSql: async () => sql },
  "@/lib/ai/search-types": { cleanSearchSummary },
  "@/lib/social/disk-path": { asDiskPath: () => null, withChatShare: (x) => x },
});
test("published dialogue round-trips visual memory, tool and search steps", async () => {
  const steps = [
    { id: "plan", tool: "plan", label: "Продолжаю", status: "done" },
    {
      id: "memory",
      tool: "memory_save",
      label: "Запоминаю",
      detail: "Город: Алматы",
      status: "done",
    },
    { id: "search", tool: "web_search", label: "Ищу", status: "done" },
  ];
  const search = {
    query: "test",
    requested: "duck",
    used: ["duck"],
    status: "found",
    durationMs: 10,
    checkedAt: "2026-11-23T00:00:00Z",
    attempts: [],
  };
  const { id } = await share.publishChat({
    data: {
      title: "QA",
      messages: [{ id: "a", role: "assistant", content: "Запомнил", createdAt: 1, steps, search }],
    },
  });
  const read = await share.readSharedChat({ data: id });
  assert.deepEqual(read.messages[0].steps, steps);
  assert.equal(read.messages[0].search.query, "test");
  assert.deepEqual(share.asPublicMessage({ ...read.messages[0], role: "user" }).steps, undefined);
});
test("public steps only contain bounded presentation data and do not spin forever", () => {
  const m = share.asPublicMessage({
    id: "a",
    role: "assistant",
    content: "",
    steps: [
      null,
      {
        id: "x",
        tool: "memory_save",
        label: "Запоминаю",
        status: "running",
        arguments: { secret: "private" },
        result: { secret: "private" },
      },
    ],
  });
  assert.equal(m.steps[0].status, "error");
  assert.match(m.steps[0].label, /не завершено/);
  assert.equal(m.steps[0].arguments, undefined);
  assert.equal(m.steps[0].result, undefined);
});

test("plain adapter accepts a memory receipt without prompting to create files", async () => {
  let round = 0;
  const opt = options(async () => ({
    ...response(round++ === 0 ? { calls: [tool("1")] } : { text: '{"saved":true}' }),
    plainTools: true,
  }));
  const result = await runAgentLoop(opt);
  assert.equal(round, 2);
  assert.match(result.text, /Запомнил/);
});
