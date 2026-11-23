import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/backup/report")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleBackupReport } = await import("@/lib/backup/http.server");
        return handleBackupReport(request);
      },
    },
  },
});
