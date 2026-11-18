export type LikeSql = {
  query: <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<T[]>;
};
/** Execute in a transaction. A message and room membership are checked before writing. */
export async function setMessageLike(
  sql: LikeSql,
  userId: string,
  data: { roomId: string; messageId: string; liked: boolean },
) {
  const row = await sql.query(
    "select m.id from room_messages m join room_members r on r.room_id=m.room_id and r.user_id=$1 where m.id=$2 and m.room_id=$3 for share of m",
    [userId, data.messageId, data.roomId],
  );
  if (!row.length) throw new Error("Сообщение недоступно");
  if (data.liked)
    await sql.query(
      "insert into room_message_likes(message_id,user_id) values($1,$2) on conflict do nothing",
      [data.messageId, userId],
    );
  else
    await sql.query("delete from room_message_likes where message_id=$1 and user_id=$2", [
      data.messageId,
      userId,
    ]);
  const [r] = await sql.query<{ n: number; mine: boolean }>(
    "select count(*)::int as n,coalesce(bool_or(user_id=$1),false) as mine from room_message_likes where message_id=$2",
    [userId, data.messageId],
  );
  return { likes: Number(r.n), liked: r.mine };
}
