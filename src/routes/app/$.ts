import { createFileRoute } from "@tanstack/react-router";
import { handlePublicApp } from "@/lib/social/app-release.server";

export const Route = createFileRoute("/app/$")({
  server: {
    handlers: {
      GET: ({ request }) => handlePublicApp(request),
      HEAD: ({ request }) => handlePublicApp(request),
    },
  },
});
