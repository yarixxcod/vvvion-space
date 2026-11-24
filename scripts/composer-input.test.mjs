import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const js = ts.transpileModule(readFileSync("src/lib/ai/composer-input.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
new Function("exports", js)(exports);
const { composerSubmitKey, attachmentQueue } = exports;
const enter = { key: "Enter", shiftKey: false, ctrlKey: false, metaKey: false };
test("Enter sends only for a keyboard or explicit Ctrl/Cmd shortcut; IME and Shift are preserved", () => {
  assert.equal(composerSubmitKey(enter, false), true);
  assert.equal(composerSubmitKey(enter, true), false);
  assert.equal(composerSubmitKey({ ...enter, ctrlKey: true }, true), true);
  assert.equal(composerSubmitKey({ ...enter, metaKey: true }, true), true);
  assert.equal(composerSubmitKey({ ...enter, shiftKey: true }, false), false);
  assert.equal(composerSubmitKey({ ...enter, isComposing: true }, false), false);
  assert.equal(composerSubmitKey({ ...enter, keyCode: 229 }, false), false);
});
test("attachments use current state in order and a rejected upload never poisons the queue", async () => {
  const enqueue = attachmentQueue();
  let files = ["old.txt"];
  const events = [];
  let release;
  const first = enqueue(async () => {
    events.push("first-start");
    await new Promise((r) => (release = r));
    files = [...files, "first.txt"];
    events.push("first-end");
  });
  const broken = enqueue(async () => {
    events.push("broken");
    throw Error("network");
  });
  const failure = assert.rejects(broken, /network/);
  const second = enqueue(async () => {
    files = [...files, "second.txt"];
    events.push("second");
  });
  await Promise.resolve();
  files = [];
  release(); // removing old attachment while uploading must stick
  await Promise.all([first, failure, second]);
  assert.deepEqual(files, ["first.txt", "second.txt"]);
  assert.deepEqual(events, ["first-start", "first-end", "broken", "second"]);
});
