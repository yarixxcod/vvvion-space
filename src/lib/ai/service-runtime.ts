import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { assertAdmin } from "@/lib/social/access";
import { isServiceModel } from "./service-model";
export const testServiceModel = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    if (typeof input !== "string" || !isServiceModel(input) || input.length > 80)
      throw Error("Некорректная служебная модель");
    return input;
  })
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { probeServiceModel } = await import("./service-runtime.server");
    return probeServiceModel(data);
  });
