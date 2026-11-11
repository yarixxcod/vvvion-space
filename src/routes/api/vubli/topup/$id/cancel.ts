import { createFileRoute } from "@tanstack/react-router";
import { cancelOwnTopup, json, requireUser } from "@/lib/pay/topup.server";

export const Route = createFileRoute("/api/vubli/topup/$id/cancel")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const user = await requireUser(request);
        if (typeof user !== "string") return json(user.status, user.body);
        const result = await cancelOwnTopup(user, params.id);
        return json(result.status, result.body);
      },
    },
  },
});
