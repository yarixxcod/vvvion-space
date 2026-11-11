import { createFileRoute } from "@tanstack/react-router";
import { readDiskFile } from "@/lib/social/disk";

export const Route = createFileRoute("/api/disk/$id")({
  server: {
    handlers: {
      GET: ({ request, params }) => readDiskFile(request, params.id),
    },
  },
});
