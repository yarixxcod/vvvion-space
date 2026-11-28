import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { assertAdmin } from "@/lib/social/access";
import { connectPlan } from "./connect-plan";
export const probeConnectServer = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(connectPlan)
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { probeServer } = await import("./connect-install.server");
    return probeServer(data);
  });
export const installConnectServer = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(connectPlan)
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { installServer } = await import("./connect-install.server");
    return installServer(data);
  });
