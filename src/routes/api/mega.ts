import { createFileRoute } from "@tanstack/react-router";
import { handleMega } from "@/lib/social/mega-http";

export const Route = createFileRoute("/api/mega")({
  server: {
    handlers: {
      POST: ({ request }) => handleMega(request),
    },
  },
});
