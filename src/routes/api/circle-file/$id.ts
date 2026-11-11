import { createFileRoute } from "@tanstack/react-router";
import { readCircleFile } from "@/lib/social/circle-files";

export const Route = createFileRoute("/api/circle-file/$id")({
  server: {
    handlers: {
      GET: ({ request, params }) => readCircleFile(request, params.id),
      HEAD: ({ request, params }) => readCircleFile(request, params.id),
    },
  },
});
