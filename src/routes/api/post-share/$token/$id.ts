import { createFileRoute } from "@tanstack/react-router";
import { handleSharedPostFile } from "@/lib/social/post-media.server";

export const Route = createFileRoute("/api/post-share/$token/$id")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleSharedPostFile(request, params.token, params.id),
    },
  },
});
