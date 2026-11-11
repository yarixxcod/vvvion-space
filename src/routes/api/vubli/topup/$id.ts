import { createFileRoute } from "@tanstack/react-router";
import { json, readOwnTopup, requireUser } from "@/lib/pay/topup.server";

export const Route = createFileRoute("/api/vubli/topup/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const user = await requireUser(request);
        if (typeof user !== "string") return json(user.status, user.body);
        const result = await readOwnTopup(user, params.id);
        return json(result.status, result.body);
      },
    },
  },
});
