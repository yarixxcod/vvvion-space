import { createFileRoute } from "@tanstack/react-router";
import { handleBookUpload } from "@/lib/books/shelf.server";

export const Route = createFileRoute("/api/books")({
  server: {
    handlers: {
      POST: ({ request }) => handleBookUpload(request),
    },
  },
});
