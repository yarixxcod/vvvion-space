import { getSql } from "@/lib/db";
let ready: Promise<void> | undefined;
export function ensureMessageLikes() {
  return (ready ??= (async () => {
    const sql = await getSql();
    await sql.query(`create table if not exists room_message_likes (
 message_id text not null references room_messages(id) on delete cascade,
 user_id text not null references "user"(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(message_id,user_id)
)`);
  })().catch((e) => {
    ready = undefined;
    throw e;
  }));
}
