import assert from "node:assert/strict";
import { test } from "node:test";
import { AGENT_CORE, buildSystemPrompt } from "./agent-prompt.ts";

test("one system keeps the core first and cuts the tail", () => {
  const built = buildSystemPrompt({
    core: AGENT_CORE,
    catalogPrompt: "Стиль модели",
    userPrompt: "Стиль пользователя",
    persona: "Персона",
    protocols: "Протокол",
    runtime: "Сейчас",
    memoryNote: "Память " + "м".repeat(30_000),
    searchNote: "Поиск",
  });
  assert.equal(built.text.startsWith(AGENT_CORE), true);
  assert.ok(built.text.indexOf("Стиль модели") < built.text.indexOf("Персона"));
  assert.ok(built.text.includes(AGENT_CORE));
  assert.ok(built.text.length <= 24_000);
  assert.equal(built.cut, true);
  assert.equal(built.text.includes("Поиск"), false);
});

test("a short prompt is not cut and stays one block", () => {
  const built = buildSystemPrompt({ core: "Ядро", userPrompt: "Стиль", persona: "Персона" });
  assert.equal(built.text, "Ядро\n\nСтиль\n\nПерсона");
  assert.equal(built.cut, false);
});
