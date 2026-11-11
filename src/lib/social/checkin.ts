import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { assertActive } from "@/lib/social/access";

export type DailyStatus = "opened" | "granted" | "early";

function proofOf(value: unknown): string {
  const raw = value && typeof value === "object" ? (value as { proof?: unknown }).proof : "";
  if (typeof raw !== "string" || raw.length < 20 || raw.length > 8_000) throw new Error("Подтвердите, что вы не робот.");
  return raw;
}

export const claimDaily = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => proofOf(input))
  .handler(async ({ context, data }): Promise<{ status: DailyStatus }> => {
    await assertActive(context.userId);
    const { verifyCaptcha } = await import("@/lib/security/captcha.server");
    if (!(await verifyCaptcha(data))) throw new Error("Подтвердите, что вы не робот.");
    const { applyDaily } = await import("@/lib/social/checkin.server");
    return { status: await applyDaily(context.userId) };
  });

export const claimCheckinLink = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Ссылка не действует");
    const raw = input as { token?: unknown; proof?: unknown };
    const token = typeof raw.token === "string" ? raw.token : "";
    if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) throw new Error("Ссылка не действует");
    return { token, proof: proofOf(raw) };
  })
  .handler(async ({ data }) => {
    const { claimCheckinToken } = await import("@/lib/social/checkin.server");
    return claimCheckinToken(data.token, data.proof);
  });
