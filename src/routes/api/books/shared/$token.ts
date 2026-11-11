import { createFileRoute } from "@tanstack/react-router";
import { handleSharedBookFile } from "@/lib/books/shelf.server";

export const Route = createFileRoute("/api/books/shared/$token")({
  server: {
    handlers: {
      GET: ({ params }) => handleSharedBookFile(params.token),
    },
  },
});
