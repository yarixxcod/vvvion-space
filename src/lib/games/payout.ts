/** Economy rules shared by the UI and the server. New practice games never mint money. */
export const GAME_RULES = {
  stall: { cap: 60, gap: 20000, pays: [4, 6, 8, 10, 12], note: "Прилавок" },
  snake: { cap: 36, gap: 4000, pays: [2], note: "Змейка" },
  mine: { cap: 40, gap: 12000, pays: [8], note: "Сапёр" },
} as const;
export type PaidGame = keyof typeof GAME_RULES;
export type GamePurse = {
  today: number;
  cap: number;
  balance: number;
  credited: boolean;
  receipt?: "duplicate";
};
export type GameSql = {
  query: <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<T[]>;
};
export function gameClaim(
  input: unknown,
  fixedGame?: PaidGame,
): { game: PaidGame; amount: number; ticket: string } {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const game = fixedGame || raw.game;
  if (game !== "stall" && game !== "snake" && game !== "mine") throw new Error("Игра не найдена");
  const amount = typeof raw.amount === "number" ? raw.amount : Number(raw.amount);
  if (!(GAME_RULES[game].pays as readonly number[]).includes(amount))
    throw new Error("Такой выплаты нет");
  if (typeof raw.ticket !== "string" || !/^[a-z0-9]{8,16}$/.test(raw.ticket))
    throw new Error("Неверный номер награды");
  return { game, amount, ticket: raw.ticket };
}
export async function readGamePurse(
  sql: GameSql,
  userId: string,
  game: PaidGame,
): Promise<GamePurse> {
  const [row] = await sql.query<{ today: number; balance: number }>(
    `select
    coalesce((select sum(amount) from game_payouts where user_id = $1 and game = $2 and created_at > now() - interval '24 hours'),0)::int as today,
    coalesce((select balance from wallets where user_id = $1),0)::int as balance`,
    [userId, game],
  );
  return {
    today: Number(row?.today || 0),
    balance: Number(row?.balance || 0),
    cap: GAME_RULES[game].cap,
    credited: false,
  };
}
/** MUST execute inside withTransaction. The wallet lock serializes claims across all games. */
export async function settleGamePayout(
  sql: GameSql,
  userId: string,
  raw: unknown,
): Promise<GamePurse> {
  const claim = gameClaim(raw);
  const { game, amount, ticket } = claim;
  const rule = GAME_RULES[game];
  const duplicate = async () => {
    const [row] = await sql.query<{ user_id: string; game: string; amount: number }>(
      `select user_id,game,amount from game_payouts where id = $1`,
      [ticket],
    );
    if (!row) return false;
    if (row.user_id !== userId || row.game !== game || Number(row.amount) !== amount)
      throw new Error("Номер награды уже использован");
    return true;
  };
  if (await duplicate())
    return { ...(await readGamePurse(sql, userId, game)), receipt: "duplicate" };
  // Preserve the established first-wallet grant; never overwrite an existing balance.
  await sql.query(
    `insert into wallets (user_id,balance,last_grant_at) values ($1,1000,now()) on conflict (user_id) do nothing`,
    [userId],
  );
  await sql.query(`select user_id from wallets where user_id = $1 for update`, [userId]);
  if (await duplicate())
    return { ...(await readGamePurse(sql, userId, game)), receipt: "duplicate" };
  const [recent] = await sql.query<{ cooling: boolean }>(
    `select exists(select 1 from game_payouts where user_id = $1 and game = $2 and created_at > now() - ($3::int * interval '1 millisecond')) as cooling`,
    [userId, game, rule.gap],
  );
  if (recent?.cooling) throw new Error("Подождите немного перед следующей наградой");
  const before = await readGamePurse(sql, userId, game);
  if (before.today + amount > rule.cap)
    throw new Error(
      "Лимит наград за последние 24 часа исчерпан. Можно продолжать играть без начислений.",
    );
  const saved = await sql.query(
    `insert into game_payouts (id,user_id,amount,game) values ($1,$2,$3,$4) on conflict (id) do nothing returning id`,
    [ticket, userId, amount, game],
  );
  if (!saved.length) {
    await duplicate();
    return { ...(await readGamePurse(sql, userId, game)), receipt: "duplicate" };
  }
  await sql.query(`update wallets set balance = balance + $2 where user_id = $1`, [userId, amount]);
  await sql.query(
    `insert into wallet_transfers (id,from_id,to_id,amount,note) values ($1,null,$2,$3,$4)`,
    [`${game}-${ticket}`, userId, amount, rule.note],
  );
  return { ...(await readGamePurse(sql, userId, game)), credited: true };
}
