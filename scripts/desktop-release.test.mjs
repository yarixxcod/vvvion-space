import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

test("desktop updater and release storage", () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  execFileSync(
    process.execPath,
    ["--experimental-strip-types", "--import", new URL("./alias-register.mjs", import.meta.url).pathname, "--test", "src/lib/social/desktop-release.test.ts"],
    { stdio: "inherit", env, cwd: new URL("..", import.meta.url).pathname },
  );
  assert.equal(true, true);
});
