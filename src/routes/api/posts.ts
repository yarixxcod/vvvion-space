import { createFileRoute } from "@tanstack/react-router";
import { handlePostPublish } from "@/lib/social/post-media.server";

export const Route = createFileRoute("/api/posts")({
  server: {
    handlers: {
      POST: ({ request }) => handlePostPublish(request),
    },
  },
});
