import { randomBytes } from "node:crypto";
import { getSql } from "@/lib/db";
import { verifyCaptcha } from "@/lib/security/captcha.server";
import type { DailyStatus } from "@/lib/social/checkin";

const TOKEN = /^[A-Za-z0-9_-]{20,80}$/;

export async function applyDaily(userId: string): Promise<DailyStatus> {
  const sql = await getSql();
  const created = await sql<{ user_id: string }>`
    insert into wallets (user_id, balance, last_grant_at)
    values (${userId}, 1000, now())
    on conflict (user_id) do nothing
    returning user_id
  `;
  if (created.length) return "opened";
  const granted = await sql<{ balance: number }>`
    update wallets
    set balance = balance + 100,
        last_grant_at = now()
    where user_id = ${userId}
      and last_grant_at <= now() - interval '24 hours'
    returning balance
  `;
  if (granted.length) return "granted";
  return "early";
}

export async function issueCheckinLink(userId: string): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  const sql = await getSql();
  await sql`delete from checkin_links where user_id = ${userId} or expires_at < now()`;
  await sql`
    insert into checkin_links (token, user_id, expires_at)
    values (${token}, ${userId}, now() + interval '20 minutes')
  `;
  return `Чтобы забрать 100 вублей, откройте карту и подтвердите, что это вы. Ссылка действует 20 минут и только один раз:\nhttps://vvvion.space/card/${token}`;
}

export async function claimCheckinToken(token: string, proof: string): Promise<{ status: DailyStatus | "dead"; balance: number | null }> {
  if (!TOKEN.test(token)) return { status: "dead", balance: null };
  if (!(await verifyCaptcha(proof))) throw new Error("Подтвердите, что вы не робот.");
  const sql = await getSql();
  const rows = await sql<{ user_id: string }>`
    select user_id from checkin_links
    where token = ${token} and used_at is null and expires_at > now()
    limit 1
  `;
  const userId = rows[0]?.user_id;
  if (!userId) return { status: "dead", balance: null };
  const status = await applyDaily(userId);
  if (status !== "early") {
    await sql`update checkin_links set used_at = now() where token = ${token} and used_at is null`;
  }
  const purse = await sql<{ balance: number }>`select balance from wallets where user_id = ${userId}`;
  return { status, balance: purse[0] ? Number(purse[0].balance) : null };
}
