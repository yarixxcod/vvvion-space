import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const api = [
  "src/lib/api/guard.server.ts",
  "src/lib/api/v1.server.ts",
  "src/lib/api/upstream.server.ts",
  "src/lib/api/images.server.ts",
  "src/lib/api/keys.server.ts",
].map((path) => readFileSync(path, "utf8")).join("\n");

test("the public API does not spend chat limits or save images to disk", () => {
  assert.equal(api.includes("enforceDailyLimit"), false);
  assert.equal(api.includes("recordAttempt"), false);
  assert.equal(api.includes("storeDiskImage"), false);
  assert.equal(api.includes("chat_attempts"), false);
  assert.match(readFileSync("src/lib/api/keys.server.ts", "utf8"), /user_id = \$\{userId\}/);
  assert.match(readFileSync("src/lib/api/upstream.server.ts", "utf8"), /resolveApiChatModel/);
});

test("api routes live at /v1 and ignore the site session", () => {
  const route = readFileSync("src/routes/v1/chat/completions.ts", "utf8");
  assert.match(route, /\/v1\/chat\/completions/);
  assert.equal(api.includes("getSessionUser"), false);
  assert.equal(api.includes("cookie"), false);
});
