import { createFileRoute } from "@tanstack/react-router";
import { shopCatalog } from "@/lib/pay/shop.server";

export const Route = createFileRoute("/api/shop/catalog")({
  server: {
    handlers: {
      GET: async () => Response.json(await shopCatalog(), { headers: { "cache-control": "no-store" } }),
    },
  },
});
