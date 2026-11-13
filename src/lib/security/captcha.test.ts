import assert from "node:assert/strict";
import { test } from "node:test";
import { createChallenge, solveChallenge, verifySolution } from "altcha-lib/v1";
import { captchaKey, takeCaptchaHash } from "./captcha-key.ts";

const KEY = "k".repeat(40);
const OTHER = "z".repeat(40);

async function solved(key: string, expires = new Date(Date.now() + 60_000)): Promise<string> {
  const challenge = await createChallenge({ hmacKey: key, maxNumber: 50, expires });
  const solvedChallenge = solveChallenge(challenge.challenge, challenge.salt, challenge.algorithm, 50);
  const solution = await solvedChallenge.promise;
  solvedChallenge.controller.abort();
  if (!solution) throw new Error("captcha did not solve");
  return Buffer.from(JSON.stringify({
    algorithm: challenge.algorithm,
    challenge: challenge.challenge,
    number: solution.number,
    salt: challenge.salt,
    signature: challenge.signature,
  })).toString("base64");
}

test("captcha refuses a missing or short key and ignores the old built-in secret", () => {
  const previous = process.env.ALTCHA_HMAC_KEY;
  delete process.env.ALTCHA_HMAC_KEY;
  assert.equal(captchaKey(), null);
  process.env.ALTCHA_HMAC_KEY = "short";
  assert.equal(captchaKey(), null);
  process.env.ALTCHA_HMAC_KEY = "h7Wm9Q2kL4rT8vX1pN6cZ0sA3dJ5eYuB";
  assert.equal(captchaKey()?.length, 32);
  process.env.ALTCHA_HMAC_KEY = KEY;
  assert.equal(captchaKey(), KEY);
  if (previous == null) delete process.env.ALTCHA_HMAC_KEY;
  else process.env.ALTCHA_HMAC_KEY = previous;
});

test("a forged signature and the wrong key do not pass", async () => {
  const payload = await solved(KEY);
  assert.equal(await verifySolution(payload, OTHER, true), false);
  const broken = Buffer.from(payload, "base64").toString("utf8").replace(/"salt":"/, '"salt":"x');
  assert.equal(await verifySolution(Buffer.from(broken).toString("base64"), KEY, true), false);
});

test("an expired solution is rejected and a fresh one cannot be reused", async () => {
  const fresh = await solved(KEY);
  assert.equal(await verifySolution(fresh, KEY, true), true);
  const stale = await solved(KEY, new Date(Date.now() - 5_000));
  assert.equal(await verifySolution(stale, KEY, true), false);
  const seen = new Set<string>();
  assert.equal(takeCaptchaHash(fresh, seen), true);
  assert.equal(takeCaptchaHash(fresh, seen), false);
});
