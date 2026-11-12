import { createFileRoute } from "@tanstack/react-router";
import { handleMegaJoin } from "@/lib/social/mega";

export const Route = createFileRoute("/api/mega/join")({
  server: {
    handlers: {
      GET: ({ request }) => handleMegaJoin(request),
      POST: ({ request }) => handleMegaJoin(request),
    },
  },
});
