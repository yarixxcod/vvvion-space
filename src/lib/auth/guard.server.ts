import { APIError, createAuthMiddleware } from "better-auth/api";
import { verifyCaptcha } from "@/lib/security/captcha.server";
import { clearLoginGuard, loginDelay, noteLoginFailure, waitText } from "@/lib/security/login-guard.server";

function emailOf(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const email = (body as { email?: unknown }).email;
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function proofOf(headers: Headers | undefined): string {
  const raw = headers?.get("x-captcha") || "";
  return raw.length >= 20 && raw.length <= 8_000 ? raw : "";
}

function failedPassword(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const row = value as { code?: unknown; status?: unknown; statusCode?: unknown };
  const code = typeof row.code === "string" ? row.code : "";
  const status = Number(row.statusCode ?? row.status ?? 0);
  return code === "INVALID_EMAIL_OR_PASSWORD" || status === 401;
}

async function requireProof(headers: Headers | undefined) {
  const proof = proofOf(headers);
  if (!proof || !(await verifyCaptcha(proof))) {
    throw new APIError("BAD_REQUEST", { message: "Подтвердите, что вы не робот." });
  }
}

export function vvvionGuard() {
  return {
    id: "vvvion-guard",
    hooks: {
      before: [
        {
          matcher: (ctx: { path?: string }) => ctx.path === "/sign-in/email",
          handler: createAuthMiddleware(async (ctx) => {
            const email = emailOf(ctx.body);
            const wait = await loginDelay(email);
            if (wait > 0) throw new APIError("TOO_MANY_REQUESTS", { message: waitText(wait) });
            await requireProof(ctx.headers ?? ctx.request?.headers);
          }),
        },
        {
          matcher: (ctx: { path?: string }) => ctx.path === "/sign-up/email",
          handler: createAuthMiddleware(async (ctx) => {
            await requireProof(ctx.headers ?? ctx.request?.headers);
          }),
        },
      ],
      after: [
        {
          matcher: (ctx: { path?: string }) => ctx.path === "/sign-in/email",
          handler: createAuthMiddleware(async (ctx) => {
            const email = emailOf(ctx.body);
            const returned = ctx.context.returned;
            if (returned && typeof returned === "object" && "user" in (returned as object)) {
              await clearLoginGuard(email);
              return;
            }
            if (failedPassword(returned)) await noteLoginFailure(email);
          }),
        },
      ],
    },
  };
}
