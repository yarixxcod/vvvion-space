import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const { handleHealth } = await import("@/lib/backup/http.server");
        return handleHealth();
      },
    },
  },
});
