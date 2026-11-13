import { createHash } from "node:crypto";
import { createChallenge, verifySolution } from "altcha-lib/v1";
import { getSql } from "@/lib/db";
import { captchaKey } from "@/lib/security/captcha-key";

export { captchaKey, takeCaptchaHash } from "@/lib/security/captcha-key";

export async function issueChallenge(): Promise<unknown> {
  const key = captchaKey();
  if (!key) {
    console.error("[captcha] ALTCHA_HMAC_KEY is missing or shorter than 32 characters");
    return null;
  }
  return createChallenge({
    hmacKey: key,
    maxNumber: 100_000,
    expires: new Date(Date.now() + 5 * 60_000),
  });
}

export async function verifyCaptcha(payload: string): Promise<boolean> {
  const key = captchaKey();
  if (!key) return false;
  const raw = payload.trim();
  if (raw.length < 20 || raw.length > 8_000) return false;
  let ok = false;
  try {
    ok = await verifySolution(raw, key, true);
  } catch {
    return false;
  }
  if (!ok) return false;
  const hash = createHash("sha256").update(raw).digest("hex");
  const sql = await getSql();
  await sql`delete from captcha_seen where expires_at < now()`;
  const rows = await sql<{ hash: string }>`
    insert into captcha_seen (hash, expires_at)
    values (${hash}, now() + interval '10 minutes')
    on conflict (hash) do nothing
    returning hash
  `;
  return Boolean(rows[0]);
}
