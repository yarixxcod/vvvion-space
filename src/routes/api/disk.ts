import { createFileRoute } from "@tanstack/react-router";
import { uploadVoice, zipDisk } from "@/lib/social/disk";

export const Route = createFileRoute("/api/disk")({
  server: {
    handlers: {
      POST: ({ request }) => uploadVoice(request),
      GET: ({ request }) => zipDisk(request),
    },
  },
});
