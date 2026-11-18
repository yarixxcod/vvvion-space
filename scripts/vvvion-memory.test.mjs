import { test } from "node:test";
import { execFileSync } from "node:child_process";
test("VVVion Memory: isolation, consent, races, extraction, API, streaming and rollback", () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  execFileSync(
    process.execPath,
    ["--experimental-strip-types", "--test", "src/lib/memory/memory.test.ts"],
    { env, stdio: "pipe", timeout: 120000 },
  );
});
