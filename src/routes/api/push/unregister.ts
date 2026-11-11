import { createFileRoute } from "@tanstack/react-router";
import { handlePushUnregister } from "@/lib/social/push-http.server";

export const Route = createFileRoute("/api/push/unregister")({
  server: {
    handlers: {
      POST: ({ request }) => handlePushUnregister(request),
    },
  },
});
