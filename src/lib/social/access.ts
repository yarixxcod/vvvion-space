import { getSql } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/verify.server";

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
  return access;
}

export async function assertAdmin(userId: string): Promise<Access> {
  const access = await assertActive(userId);
  if (access.role !== "admin") throw new Error("Недостаточно прав");
  return access;
}

/** Builtin chat: model must be in the shared catalog. Signed-in bans are rejected. */
export async function assertBuiltinChat(model: string): Promise<void> {
  const sql = await getSql();
  const known = await sql<{ name: string }>`
    select name from catalog_models where name = ${model}
  `;
  if (!known.length) throw new Error("Этой модели больше нет");
  try {
    const user = await getSessionUser();
    if (!user) return;
    const access = await loadAccess(user.id);
    if (access.banned) throw new Error("Аккаунт заблокирован");
  } catch (err) {
    if (err instanceof Error && (err.message === "Аккаунт заблокирован" || err.message === "Этой модели больше нет")) {
      throw err;
    }
  }
}
