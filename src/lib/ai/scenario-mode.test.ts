import assert from "node:assert/strict";
import { test } from "node:test";
import { SCENARIO_PROMPT, readScenarioFlag } from "./scenario-prompt.server.ts";
import { AGENT_CORE, buildSystemPrompt } from "./agent-prompt.ts";

test("scenario is opt-in with a strict boolean; images never use it", () => {
  for (const value of [undefined, null, 0, 1, "true", "false", {}, []])
    assert.equal(readScenarioFlag({ scenario: value }), false);
  assert.equal(readScenarioFlag({ scenario: true }), true);
  assert.equal(readScenarioFlag({ scenario: true, mode: "image" }), false);
  assert.equal(readScenarioFlag({ systemPrompt: SCENARIO_PROMPT }), false);
  assert.equal(readScenarioFlag(null), false);
});
test("scenario and core survive oversized style and all tool/context tails", () => {
  const result = buildSystemPrompt({
    core: AGENT_CORE,
    scenario: SCENARIO_PROMPT,
    catalogPrompt: "s".repeat(80000),
    protocols: "p".repeat(80000),
    memoryNote: "m".repeat(80000),
  });
  assert.ok(result.text.startsWith(AGENT_CORE + "\n\n" + SCENARIO_PROMPT.trim()));
  assert.ok(result.text.length <= result.limit);
  assert.equal(result.limit, 56000);
  assert.equal(result.cut, true);
  assert.ok(SCENARIO_PROMPT.length > 23000);
  assert.equal(buildSystemPrompt({ core: AGENT_CORE }).limit, 24000);
});
