import { getSql } from "@/lib/db";

export async function sessionEpoch(userId: string): Promise<string> {
  if (!userId) return "1";
  try {
    const sql = await getSql();
    const rows = await sql<{ epoch: number }>`
      select epoch from session_epoch where user_id = ${userId} limit 1
    `;
    return String(rows[0]?.epoch ?? 1);
  } catch {
    return "1";
  }
}

export async function dropAllSessions(userId: string): Promise<void> {
  const sql = await getSql();
  await sql`
    insert into session_epoch (user_id, epoch)
    values (${userId}, 2)
    on conflict (user_id) do update set epoch = session_epoch.epoch + 1
  `;
  await sql`delete from session where "userId" = ${userId}`;
}
