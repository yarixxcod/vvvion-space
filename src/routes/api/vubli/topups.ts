import { createFileRoute } from "@tanstack/react-router";
import { json, listOwnTopups, requireUser } from "@/lib/pay/topup.server";

export const Route = createFileRoute("/api/vubli/topups")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await requireUser(request);
        if (typeof user !== "string") return json(user.status, user.body);
        const result = await listOwnTopups(user);
        return json(result.status, result.body);
      },
    },
  },
});
