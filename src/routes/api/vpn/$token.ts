import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/vpn/$token")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const { renderVpnSubscription } = await import("@/lib/social/vpn");
        return renderVpnSubscription(params.token, request);
      },
      HEAD: async ({ params, request }) => {
        const { renderVpnSubscription } = await import("@/lib/social/vpn");
        return renderVpnSubscription(params.token, request);
      },
    },
  },
});
