import { createFileRoute } from "@tanstack/react-router";
import { handleCircleUpload } from "@/lib/social/circle-files";

export const Route = createFileRoute("/api/circle-file")({
  server: {
    handlers: {
      POST: ({ request }) => handleCircleUpload(request),
    },
  },
});
