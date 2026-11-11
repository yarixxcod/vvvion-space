import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";

export type MailStatus = { email: string; verified: boolean };

function emailOf(value: unknown, label = "Напишите почту") {
  const raw = value && typeof value === "object" ? (value as { email?: unknown }).email : value;
  if (typeof raw !== "string" || raw.trim().length < 3) throw new Error(label);
  return raw;
}

function proofOf(input: unknown): string {
  const raw = input && typeof input === "object" ? (input as { proof?: unknown }).proof : "";
  if (typeof raw !== "string" || raw.length < 20 || raw.length > 8_000) throw new Error("Подтвердите, что вы не робот.");
  return raw;
}

async function assertProof(proof: string) {
  const { verifyCaptcha } = await import("@/lib/security/captcha.server");
  if (!(await verifyCaptcha(proof))) throw new Error("Подтвердите, что вы не робот.");
}

function codeOf(value: unknown) {
  const raw = value && typeof value === "object" ? (value as { code?: unknown }).code : "";
  if (typeof raw !== "string") throw new Error("Введите код из письма");
  return raw;
}

export const requestPasswordCode = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Напишите почту");
    const raw = input as { email?: unknown };
    return { email: emailOf(raw.email ?? input), proof: proofOf(input) };
  })
  .handler(async ({ data }) => {
    await assertProof(data.proof);
    const { requestReset } = await import("@/lib/mail/codes.server");
    await requestReset(data.email);
    return { ok: true as const };
  });

export const confirmPasswordCode = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Введите код и новый пароль");
    const raw = input as { email?: unknown; code?: unknown; password?: unknown };
    if (typeof raw.email !== "string" || typeof raw.code !== "string" || typeof raw.password !== "string") {
      throw new Error("Введите код и новый пароль");
    }
    return { email: raw.email, code: raw.code, password: raw.password, proof: proofOf(input) };
  })
  .handler(async ({ data }) => {
    await assertProof(data.proof);
    const { confirmReset } = await import("@/lib/mail/codes.server");
    await confirmReset(data.email, data.code, data.password);
    return { ok: true as const };
  });

export const getMailStatus = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<MailStatus> => {
    const { readMailStatus } = await import("@/lib/mail/codes.server");
    return readMailStatus(context.userId);
  });

export const sendConfirmCode = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sendConfirm } = await import("@/lib/mail/codes.server");
    await sendConfirm(context.userId);
    return { ok: true as const };
  });

export const confirmMailCode = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => codeOf(input))
  .handler(async ({ context, data }) => {
    const { confirmAddress } = await import("@/lib/mail/codes.server");
    await confirmAddress(context.userId, data);
    return { ok: true as const };
  });

export const sendEmailChangeCode = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Напишите новую почту и пароль");
    const raw = input as { email?: unknown; password?: unknown };
    if (typeof raw.email !== "string" || typeof raw.password !== "string") {
      throw new Error("Напишите новую почту и пароль");
    }
    return { email: raw.email, password: raw.password, proof: proofOf(input) };
  })
  .handler(async ({ context, data }) => {
    await assertProof(data.proof);
    const { requestEmailChange } = await import("@/lib/mail/codes.server");
    await requestEmailChange(context.userId, data.email, data.password);
    return { ok: true as const };
  });

export const confirmEmailChangeCode = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => codeOf(input))
  .handler(async ({ context, data }): Promise<MailStatus> => {
    const { confirmEmailChange } = await import("@/lib/mail/codes.server");
    return confirmEmailChange(context.userId, data);
  });

export const changeAccountPassword = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Введите оба пароля");
    const raw = input as { current?: unknown; next?: unknown };
    if (typeof raw.current !== "string" || typeof raw.next !== "string") throw new Error("Введите оба пароля");
    return { current: raw.current, next: raw.next, proof: proofOf(input) };
  })
  .handler(async ({ context, data }) => {
    await assertProof(data.proof);
    const { changeOwnPassword } = await import("@/lib/mail/codes.server");
    await changeOwnPassword(context.userId, data.current, data.next);
    return { ok: true as const };
  });

export const openPremium = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { openPremium: open } = await import("@/lib/mail/codes.server");
    await open(context.userId);
    return { ok: true as const };
  });
