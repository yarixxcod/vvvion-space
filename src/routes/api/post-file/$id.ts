import { createFileRoute } from "@tanstack/react-router";
import { handlePostFile } from "@/lib/social/post-media.server";

export const Route = createFileRoute("/api/post-file/$id")({
  server: {
    handlers: {
      GET: ({ request, params }) => handlePostFile(request, params.id),
    },
  },
});
