import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const js = ts.transpileModule(readFileSync("src/lib/ai/tts.server.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
new Function("require", "exports", js)((id) => {
  if (id === "@/lib/db") return {};
  throw new Error(id);
}, exports);

test("speech endpoint is the OpenAI audio path even if the chat url was pasted", () => {
  assert.equal(exports.speechEndpoint("https://api.openai.com/v1"), "https://api.openai.com/v1/audio/speech");
  assert.equal(exports.speechEndpoint("https://api.openai.com/v1/audio/speech"), "https://api.openai.com/v1/audio/speech");
  assert.equal(exports.speechEndpoint("https://voice.example/v1/chat/completions"), "https://voice.example/v1/audio/speech");
  assert.equal(exports.speechEndpoint("javascript:alert(1)"), null);
});

test("json speech payloads can carry base64 audio", () => {
  const audio = "A".repeat(120);
  assert.equal(exports.audioBase64({ data: { audio } }), audio);
  assert.equal(exports.audioBase64({ message: "Голос не ответил" }), null);
});
