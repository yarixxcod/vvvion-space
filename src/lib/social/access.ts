import { createServerOnlyFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";

export type Access = {
  role: "admin" | "member";
  banned: boolean;
};

export async function loadAccess(userId: string): Promise<Access> {
  const sql = await getSql();
  const rows = await sql<{ out_role: string; is_banned: boolean }>`
    select out_role, is_banned from ensure_member(${userId})
  `;
  const row = rows[0];
  return {
    role: row?.out_role === "admin" ? "admin" : "member",
    banned: Boolean(row?.is_banned),
  };
}

export async function assertActive(userId: string): Promise<Access> {
  const access = await loadAccess(userId);
  if (access.banned) throw new Error("Аккаунт заблокирован");
  try {
    const sql = await getSql();
    const rows = await sql<{ until: string | null }>`
      select suspended_until::text as until from account_limits
      where user_id = ${userId} and suspended_until > now()
      limit 1
    `;
    if (rows[0]) throw new Error("Аккаунт временно ограничен");
  } catch (err) {
    if (err instanceof Error && err.message === "Аккаунт временно ограничен") throw err;
  }
  return access;
}

export async function assertAdmin(userId: string): Promise<Access> {
  const access = await assertActive(userId);
  if (access.role !== "admin") throw new Error("Недостаточно прав");
  return access;
}

/** Explicit userId is used by Telegram; the web path resolves the verified session. */
export async function assertModelEntitlement(model: string, userId: string | null) {
  const sql = await getSql();
  const known = await sql<{ name: string; premium_only: boolean }>`select name,premium_only from catalog_models where name=${model}`;
  if (!known.length) throw new Error("Этой модели больше нет");
  if (userId && (await loadAccess(userId)).banned) throw new Error("Аккаунт заблокирован");
  if (known[0].premium_only) {
    const { isPremium } = await import("@/lib/social/premium");
    if (!userId || !(await isPremium(userId))) {
      const { PREMIUM_MODEL_MESSAGE } = await import("@/lib/ai/model-access");
      throw new Error(PREMIUM_MODEL_MESSAGE);
    }
  }
}

/** Fail closed: an unavailable subscription check never grants access. */
export const assertBuiltinChat = createServerOnlyFn(async (model: string): Promise<void> => {
  const { getSessionUser } = await import("@/lib/auth/verify.server");
  const user = await getSessionUser();
  await assertModelEntitlement(model, user?.id ?? null);
});
