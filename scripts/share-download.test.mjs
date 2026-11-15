import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const code = ts.transpileModule(
  readFileSync(new URL("../src/lib/share-download.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
const mod = {};
new Function("exports", code)(mod);
const { downloadShared } = mod;

test("shared download reports real bytes and saves exactly the received file", async () => {
  const states = [];
  const blob = await downloadShared(
    "/file",
    5,
    new AbortController().signal,
    (value) => states.push(value),
    null,
    async () => new Response("hello", { headers: { "content-length": "5" } }),
  );
  assert.equal(await blob.text(), "hello");
  assert.equal(states[0].pct, 0);
  assert.equal(states.at(-1).pct, 100);
  assert.equal(states.at(-1).got, 5);
});

test("unknown length stays indeterminate until the stream completes", async () => {
  const states = [];
  await downloadShared(
    "/file",
    0,
    new AbortController().signal,
    (s) => states.push(s),
    null,
    async () => new Response("hello"),
  );
  assert.equal(states[0].pct, null);
  assert.equal(states.at(-1).pct, 100);
});

test("truncated downloads abort the writable file and never close it", async () => {
  let closed = false;
  let aborted = false;
  const sink = {
    async write() {},
    async close() {
      closed = true;
    },
    async abort() {
      aborted = true;
    },
  };
  await assert.rejects(
    () =>
      downloadShared(
        "/file",
        12,
        new AbortController().signal,
        () => {},
        sink,
        async () => new Response("hello"),
      ),
    /прервалась/,
  );
  assert.equal(closed, false);
  assert.equal(aborted, true);
});

test("cancellation never commits a partial download", async () => {
  const controller = new AbortController();
  let closed = false;
  let aborted = false;
  const sink = {
    async write() {
      controller.abort();
    },
    async close() {
      closed = true;
    },
    async abort() {
      aborted = true;
    },
  };
  await assert.rejects(
    () =>
      downloadShared(
        "/file",
        5,
        controller.signal,
        () => {},
        sink,
        async () => new Response("hello"),
      ),
    { name: "AbortError" },
  );
  assert.equal(closed, false);
  assert.equal(aborted, true);
});

test("failed HTTP responses cannot become downloaded files", async () => {
  await assert.rejects(
    () =>
      downloadShared(
        "/file",
        0,
        new AbortController().signal,
        () => {},
        null,
        async () => new Response("not found", { status: 404 }),
      ),
    /скачать/,
  );
});
