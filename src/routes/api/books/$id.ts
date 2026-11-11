import { createFileRoute } from "@tanstack/react-router";
import { handleBookFile } from "@/lib/books/shelf.server";

export const Route = createFileRoute("/api/books/$id")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleBookFile(request, params.id),
    },
  },
});
