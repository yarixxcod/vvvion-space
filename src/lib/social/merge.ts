import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql, withTransaction } from "@/lib/db";
import { assertActive } from "@/lib/social/access";
import { gameClaim, readGamePurse, settleGamePayout, type GamePurse } from "@/lib/games/payout";
export type ArcadeGame = "snake" | "mine";
export type MergePurse = GamePurse;
function arcadeOf(value: unknown): ArcadeGame {
  const game = value && typeof value === "object" ? (value as { game?: unknown }).game : "";
  if (game === "snake" || game === "mine") return game;
  throw new Error("Игра не найдена");
}
export const getMergePurse = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<MergePurse> => {
    await assertActive(context.userId);
    return readGamePurse(await getSql(), context.userId, "stall");
  });
export const claimMergePayout = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => gameClaim(input, "stall"))
  .handler(async ({ context, data }): Promise<MergePurse> => {
    await assertActive(context.userId);
    return withTransaction((sql) => settleGamePayout(sql, context.userId, data));
  });
export const getArcadePurse = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(arcadeOf)
  .handler(async ({ context, data }): Promise<MergePurse> => {
    await assertActive(context.userId);
    return readGamePurse(await getSql(), context.userId, data);
  });
export const claimArcade = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    arcadeOf(input);
    return gameClaim(input);
  })
  .handler(async ({ context, data }): Promise<MergePurse> => {
    await assertActive(context.userId);
    return withTransaction((sql) => settleGamePayout(sql, context.userId, data));
  });
