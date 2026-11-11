import { createFileRoute } from "@tanstack/react-router";
import { handlePushCron } from "@/lib/social/push-http.server";

export const Route = createFileRoute("/api/push/cron")({
  server: {
    handlers: {
      GET: ({ request }) => handlePushCron(request),
      POST: ({ request }) => handlePushCron(request),
    },
  },
});
