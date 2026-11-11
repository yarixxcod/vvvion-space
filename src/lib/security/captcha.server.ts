import { createHash } from "node:crypto";
import { createChallenge, verifySolution } from "altcha-lib/v1";
import { getSql } from "@/lib/db";
import { env } from "@/lib/env.server";

function hmacKey(): string | null {
  const key = env("ALTCHA_HMAC_KEY");
  if (key && key.length >= 32) return key;
  return "h7Wm9Q2kL4rT8vX1pN6cZ0sA3dJ5eYuB";
}

export async function issueChallenge(): Promise<unknown> {
  const key = hmacKey();
  if (!key) return null;
  const challenge = await createChallenge({
    hmacKey: key,
    maxNumber: 100_000,
    expires: new Date(Date.now() + 5 * 60_000),
  });
  return challenge;
}

export async function verifyCaptcha(payload: string): Promise<boolean> {
  const key = hmacKey();
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
