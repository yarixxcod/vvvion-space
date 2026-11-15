import { createFileRoute } from "@tanstack/react-router";
import { paymentAvailability } from "@/lib/pay/readiness.server";
import { packagesBody } from "@/lib/pay/vubli-rate";

export const Route = createFileRoute("/api/vubli/packages")({
  server: {
    handlers: {
      GET: async () => Response.json({ ...packagesBody(), payment: await paymentAvailability() }, { headers: { "cache-control": "no-store" } }),
    },
  },
});
