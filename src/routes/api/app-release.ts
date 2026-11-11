import { createFileRoute } from "@tanstack/react-router";
import { handleAppRelease } from "@/lib/social/app-release.server";

export const Route = createFileRoute("/api/app-release")({
  server: {
    handlers: {
      GET: ({ request }) => handleAppRelease(request),
      POST: ({ request }) => handleAppRelease(request),
    },
  },
});
