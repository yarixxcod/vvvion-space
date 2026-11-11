import { createFileRoute } from "@tanstack/react-router";
import { handlePushRegister } from "@/lib/social/push-http.server";

export const Route = createFileRoute("/api/push/register")({
  server: {
    handlers: {
      POST: ({ request }) => handlePushRegister(request),
    },
  },
});
