import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/vpn-agent")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleVpnAgent } = await import("@/lib/social/vpn");
        return handleVpnAgent(request);
      },
    },
  },
});
