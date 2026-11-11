import { createFileRoute } from "@tanstack/react-router";
import { clientIpHash, createTopup, json, parseCreateBody, requireUser } from "@/lib/pay/topup.server";

export const Route = createFileRoute("/api/vubli/topup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await requireUser(request);
        if (typeof user !== "string") return json(user.status, user.body);
        let body: unknown = null;
        try {
          body = await request.json();
        } catch {
          body = null;
        }
        const input = parseCreateBody(body);
        if (!input) return json(400, { code: "amount_out_of_range" });
        const result = await createTopup(user, { ...input, ipHash: clientIpHash(request) });
        return json(result.status, result.body);
      },
    },
  },
});
