import { createFileRoute } from "@tanstack/react-router";
import { packagesBody } from "@/lib/pay/vubli-rate";

export const Route = createFileRoute("/api/vubli/packages")({
  server: {
    handlers: {
      GET: () => Response.json(packagesBody(), { headers: { "cache-control": "no-store" } }),
    },
  },
});
