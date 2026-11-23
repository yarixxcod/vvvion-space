import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/backup/manifest")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handleBackupManifest } = await import("@/lib/backup/http.server");
        return handleBackupManifest(request);
      },
    },
  },
});
