import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/vpn/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { renderVpnSubscription } = await import("@/lib/social/vpn");
        return renderVpnSubscription(params.token);
      },
      HEAD: () => new Response(null, { status: 200, headers: { "cache-control": "no-store" } }),
    },
  },
});
