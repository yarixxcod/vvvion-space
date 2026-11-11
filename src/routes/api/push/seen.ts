import { createFileRoute } from "@tanstack/react-router";
import { handlePushSeen } from "@/lib/social/push-http.server";

export const Route = createFileRoute("/api/push/seen")({
  server: {
    handlers: {
      POST: ({ request }) => handlePushSeen(request),
    },
  },
});
