import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { getSql } from "@/lib/db";
import { env } from "@/lib/env.server";
import { assertSameSiteRequest } from "@/lib/auth/isolation.server";
import { mailHtml, mailSubject, mailText, type MailPurpose } from "@/lib/mail/template.server";
import { sendMail } from "@/lib/mail/smtp.server";
import { dropAllSessions } from "@/lib/security/epoch.server";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type MailStatus = { email: string; verified: boolean };

type UserRow = { id: string; email: string; verified: boolean };

function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 120) throw new Error("Это не похоже на почту.");
  return email;
}

function normalizeCode(value: string) {
  const code = value.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(code)) throw new Error("Код — это шесть цифр из письма.");
  return code;
}

function checkPassword(value: string) {
  if (value.length < 8 || value.length > 128) throw new Error("Пароль не короче 8 символов.");
}

function pepper() {
  return env("BETTER_AUTH_SECRET") || env("RESEND_API_KEY") || "vvvion-mail";
}

function hashCode(purpose: string, email: string, code: string) {
  return createHash("sha256").update(`${pepper()}:${purpose}:${email}:${code}`).digest("hex");
}

function sameHash(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function findUser(email: string): Promise<UserRow | null> {
  const sql = await getSql();
  const rows = await sql<UserRow>`
    select id, email, "emailVerified" as verified
    from "user"
    where lower(email) = ${email}
    limit 1
  `;
  return rows[0] ?? null;
}

async function userById(userId: string): Promise<UserRow | null> {
  const sql = await getSql();
  const rows = await sql<UserRow>`
    select id, email, "emailVerified" as verified
    from "user"
    where id = ${userId}
    limit 1
  `;
  return rows[0] ?? null;
}

async function issue(input: { email: string; userId: string; purpose: MailPurpose; newEmail?: string | null }) {
  const sql = await getSql();
  const recent = await sql<{ ms: number | string }>`
    select extract(epoch from created_at) * 1000 as ms
    from mail_codes
    where email = ${input.email} and purpose = ${input.purpose}
    order by created_at desc
    limit 1
  `;
  const last = Number(recent[0]?.ms ?? 0);
  if (last && Date.now() - last < 45_000) {
    throw new Error("Код уже отправлен. Подождите немного и проверьте почту, в том числе папку «Спам».");
  }
  const count = await sql<{ n: number }>`
    select count(*)::int as n
    from mail_codes
    where email = ${input.email}
      and purpose = ${input.purpose}
      and created_at > now() - interval '1 hour'
  `;
  if (Number(count[0]?.n ?? 0) >= 5) {
    throw new Error("Слишком много писем на этот адрес. Следующий код можно запросить через час.");
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const id = crypto.randomUUID();
  await sql`
    update mail_codes set expires_at = now()
    where email = ${input.email} and purpose = ${input.purpose} and expires_at > now()
  `;
  await sql`
    insert into mail_codes (id, email, user_id, purpose, code_hash, new_email, expires_at)
    values (
      ${id},
      ${input.email},
      ${input.userId},
      ${input.purpose},
      ${hashCode(input.purpose, input.email, code)},
      ${input.newEmail ?? null},
      now() + interval '15 minutes'
    )
  `;
  try {
    await sendMail({
      to: input.email,
      subject: mailSubject(input.purpose),
      text: mailText(input.purpose, code),
      html: mailHtml(input.purpose, code),
    });
  } catch (err) {
    await sql`delete from mail_codes where id = ${id}`.catch(() => undefined);
    throw err;
  }
}

async function takeCode(email: string, purpose: MailPurpose, code: string, userId?: string) {
  const sql = await getSql();
  const rows = await sql<{ id: string; code_hash: string; attempts: number; user_id: string | null; new_email: string | null }>`
    select id, code_hash, attempts, user_id, new_email
    from mail_codes
    where email = ${email} and purpose = ${purpose} and expires_at > now()
    order by created_at desc
    limit 1
  `;
  const row = rows[0];
  if (!row) throw new Error("Код не найден или уже истёк. Запросите новый.");
  if (userId && row.user_id && row.user_id !== userId) throw new Error("Код не найден или уже истёк. Запросите новый.");
  if (Number(row.attempts) >= 5) {
    await sql`delete from mail_codes where id = ${row.id}`;
    throw new Error("Слишком много попыток. Запросите новый код.");
  }
  if (!sameHash(row.code_hash, hashCode(purpose, email, code))) {
    await sql`update mail_codes set attempts = attempts + 1 where id = ${row.id}`;
    throw new Error("Код не совпал.");
  }
  await sql`delete from mail_codes where id = ${row.id}`;
  return row;
}

async function assertPassword(userId: string, password: string) {
  const sql = await getSql();
  const rows = await sql<{ password: string | null }>`
    select password from account
    where "userId" = ${userId} and "providerId" = 'credential'
    limit 1
  `;
  const hash = rows[0]?.password ?? "";
  if (!hash) throw new Error("У этого входа нет пароля. Сначала задайте его через восстановление на странице входа.");
  const ok = await verifyPassword({ hash, password });
  if (!ok) throw new Error("Неверный пароль.");
}

async function writePassword(userId: string, password: string, markVerified: boolean) {
  const hash = await hashPassword(password);
  const sql = await getSql();
  const existing = await sql<{ id: string }>`
    select id from account
    where "userId" = ${userId} and "providerId" = 'credential'
    limit 1
  `;
  if (existing[0]) {
    await sql`update account set password = ${hash}, "updatedAt" = now() where id = ${existing[0].id}`;
  } else {
    const id = crypto.randomUUID();
    await sql`
      insert into account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
      values (${id}, ${userId}, 'credential', ${userId}, ${hash}, now(), now())
    `;
  }
  if (markVerified) {
    await sql`update "user" set "emailVerified" = true, "updatedAt" = now() where id = ${userId}`;
    const { grantAchievement } = await import("@/lib/social/achievements");
    void grantAchievement(userId, "mail");
  }
}

export async function readMailStatus(userId: string): Promise<MailStatus> {
  const user = await userById(userId);
  if (!user) throw new Error("Аккаунт не найден.");
  return { email: user.email, verified: Boolean(user.verified) };
}

export async function requestReset(rawEmail: string) {
  assertSameSiteRequest();
  const email = normalizeEmail(rawEmail);
  const user = await findUser(email);
  if (!user) return;
  await issue({ email, userId: user.id, purpose: "reset" });
}

export async function confirmReset(rawEmail: string, rawCode: string, password: string) {
  assertSameSiteRequest();
  const email = normalizeEmail(rawEmail);
  const code = normalizeCode(rawCode);
  checkPassword(password);
  const user = await findUser(email);
  if (!user) throw new Error("Код не найден или уже истёк. Запросите новый.");
  await takeCode(email, "reset", code, user.id);
  await writePassword(user.id, password, true);
  await dropAllSessions(user.id);
  void import("@/lib/social/push.server")
    .then((mod) =>
      mod.pushNotice(user.id, "security", {
        id: `pwd-changed:${Date.now()}`,
        title: "Пароль изменён",
        body: "Если это были не вы, напишите в поддержку.",
        url: "/",
      }, { kind: "pwd", ref: String(Math.floor(Date.now() / 60_000)) }),
    )
    .catch(() => undefined);
}

export async function sendConfirm(userId: string) {
  const user = await userById(userId);
  if (!user) throw new Error("Аккаунт не найден.");
  if (user.verified) return;
  await issue({ email: user.email.trim().toLowerCase(), userId, purpose: "confirm" });
}

export async function confirmAddress(userId: string, rawCode: string) {
  const user = await userById(userId);
  if (!user) throw new Error("Аккаунт не найден.");
  const email = user.email.trim().toLowerCase();
  await takeCode(email, "confirm", normalizeCode(rawCode), userId);
  const sql = await getSql();
  await sql`update "user" set "emailVerified" = true, "updatedAt" = now() where id = ${userId}`;
  const { grantAchievement } = await import("@/lib/social/achievements");
  void grantAchievement(userId, "mail");
}

export async function requestEmailChange(userId: string, rawEmail: string, password: string) {
  const next = normalizeEmail(rawEmail);
  const user = await userById(userId);
  if (!user) throw new Error("Аккаунт не найден.");
  if (next === user.email.trim().toLowerCase()) throw new Error("Это и есть текущая почта.");
  const taken = await findUser(next);
  if (taken && taken.id !== userId) throw new Error("Этот адрес уже занят.");
  await assertPassword(userId, password);
  await issue({ email: next, userId, purpose: "change", newEmail: next });
}

export async function confirmEmailChange(userId: string, rawCode: string): Promise<MailStatus> {
  const code = normalizeCode(rawCode);
  const sql = await getSql();
  const rows = await sql<{ id: string; email: string; code_hash: string; attempts: number; new_email: string | null }>`
    select id, email, code_hash, attempts, new_email
    from mail_codes
    where user_id = ${userId} and purpose = 'change' and expires_at > now()
    order by created_at desc
    limit 1
  `;
  const row = rows[0];
  if (!row) throw new Error("Код не найден или уже истёк. Запросите новый.");
  if (Number(row.attempts) >= 5) {
    await sql`delete from mail_codes where id = ${row.id}`;
    throw new Error("Слишком много попыток. Запросите новый код.");
  }
  const next = (row.new_email || row.email).trim().toLowerCase();
  if (!sameHash(row.code_hash, hashCode("change", row.email, code))) {
    await sql`update mail_codes set attempts = attempts + 1 where id = ${row.id}`;
    throw new Error("Код не совпал.");
  }
  const taken = await findUser(next);
  if (taken && taken.id !== userId) throw new Error("Этот адрес уже занят.");
  await sql`delete from mail_codes where id = ${row.id}`;
  await sql`
    update "user"
    set email = ${next}, "emailVerified" = true, "updatedAt" = now()
    where id = ${userId}
  `;
  const { grantAchievement } = await import("@/lib/social/achievements");
  void grantAchievement(userId, "mail");
  return { email: next, verified: true };
}

export async function changeOwnPassword(userId: string, current: string, next: string) {
  const user = await userById(userId);
  if (!user) throw new Error("Аккаунт не найден.");
  if (!user.verified) {
    throw new Error("Сначала подтвердите почту. Пока адрес не подтверждён, пароль сменить нельзя.");
  }
  checkPassword(next);
  if (next === current) throw new Error("Новый пароль совпадает с текущим.");
  await assertPassword(userId, current);
  await writePassword(userId, next, true);
  await dropAllSessions(userId);
  void import("@/lib/social/push.server")
    .then((mod) =>
      mod.pushNotice(userId, "security", {
        id: `pwd-changed:${Date.now()}`,
        title: "Пароль изменён",
        body: "Если это были не вы, напишите в поддержку.",
        url: "/",
      }),
    )
    .catch(() => undefined);
}

export async function openPremium(userId: string) {
  const { purchasePremium } = await import("@/lib/social/premium");
  await purchasePremium(userId);
}
