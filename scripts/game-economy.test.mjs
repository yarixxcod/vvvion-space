import { test } from "node:test";
import { execFileSync } from "node:child_process";
test("game rewards: atomicity, idempotency, rolling caps and rollback in an isolated database", () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  execFileSync(
    process.execPath,
    ["--experimental-strip-types", "--test", "src/lib/games/payout.test.ts"],
    { stdio: "pipe", timeout: 120000, env },
  );
});
