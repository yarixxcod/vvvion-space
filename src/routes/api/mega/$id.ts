import { createFileRoute } from "@tanstack/react-router";
import { readMega } from "@/lib/social/mega-http";

export const Route = createFileRoute("/api/mega/$id")({
  server: {
    handlers: {
      GET: ({ request, params }) => readMega(request, params.id),
      HEAD: ({ request, params }) => readMega(request, params.id),
    },
  },
});
