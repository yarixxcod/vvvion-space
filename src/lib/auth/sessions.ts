import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";

export type OwnSession = { id: string; label: string; at: string; current: boolean };

export const listOwnSessions = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<OwnSession[]> => {
    const { readOwnSessions } = await import("@/lib/auth/sessions.server");
    return readOwnSessions(context.userId);
  });

export const revokeOwnSession = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const id = typeof input === "string" ? input : input && typeof input === "object" ? (input as { id?: unknown }).id : "";
    if (typeof id !== "string" || !id || id.length > 128) throw new Error("Вход не найден");
    return id;
  })
  .handler(async ({ context, data }) => {
    const { dropOwnSession } = await import("@/lib/auth/sessions.server");
    return dropOwnSession(context.userId, data);
  });

export const revokeEverySession = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { dropAllSessions } = await import("@/lib/security/epoch.server");
    await dropAllSessions(context.userId);
    return { ok: true as const };
  });
