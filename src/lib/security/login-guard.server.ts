import { createHash } from "node:crypto";
import { getSql } from "@/lib/db";

function keyOf(email: string): string {
  return createHash("sha256").update(`login:${email.trim().toLowerCase()}`).digest("hex");
}

function lockMs(fails: number): number {
  if (fails < 5) return 0;
  if (fails === 5) return 30_000;
  if (fails === 6) return 2 * 60_000;
  if (fails === 7) return 5 * 60_000;
  if (fails === 8) return 15 * 60_000;
  if (fails === 9) return 30 * 60_000;
  if (fails < 14) return 2 * 60 * 60_000;
  return 12 * 60 * 60_000;
}

export function waitText(ms: number): string {
  const sec = Math.max(1, Math.ceil(ms / 1000));
  if (sec < 60) return `Слишком много попыток. Подождите ${sec} с и попробуйте снова.`;
  const min = Math.ceil(sec / 60);
  if (min < 60) return `Слишком много попыток. Подождите ${min} мин и попробуйте снова.`;
  const hours = Math.ceil(min / 60);
  return `Вход временно закрыт. Попробуйте через ${hours} ч.`;
}

export async function loginDelay(email: string): Promise<number> {
  if (!email.includes("@")) return 0;
  const sql = await getSql();
  const rows = await sql<{ left_ms: number | string }>`
    select greatest(0, extract(epoch from (locked_until - now())) * 1000) as left_ms
    from login_guard
    where key = ${keyOf(email)}
  `;
  return Math.round(Number(rows[0]?.left_ms ?? 0));
}

export async function noteLoginFailure(email: string): Promise<void> {
  if (!email.includes("@")) return;
  const sql = await getSql();
  const key = keyOf(email);
  const rows = await sql<{ fails: number }>`
    insert into login_guard (key, fails, updated_at)
    values (${key}, 1, now())
    on conflict (key) do update
      set fails = login_guard.fails + 1, updated_at = now()
    returning fails
  `;
  const fails = Number(rows[0]?.fails ?? 1);
  const wait = lockMs(fails);
  if (wait > 0) {
    await sql`
      update login_guard
      set locked_until = now() + (${wait} * interval '1 millisecond')
      where key = ${key}
    `;
  }
  if (fails === 5) {
    const normalized = email.trim().toLowerCase();
    void import("@/lib/social/push.server")
      .then(async (mod) => {
        const people = await sql<{ id: string }>`select id from "user" where lower(email) = ${normalized} limit 1`;
        const id = people[0]?.id;
        if (!id) return;
        await mod.pushNotice(
          id,
          "security",
          {
            id: "login-fail-burst",
            title: "Попытки входа в ваш аккаунт",
            body: "Неверный пароль ввели несколько раз подряд.",
            url: "/",
          },
          { kind: "login_fail", ref: new Date().toISOString().slice(0, 10) },
        );
      })
      .catch(() => undefined);
  }
}

export async function clearLoginGuard(email: string): Promise<void> {
  if (!email.includes("@")) return;
  const sql = await getSql();
  await sql`delete from login_guard where key = ${keyOf(email)}`;
}
