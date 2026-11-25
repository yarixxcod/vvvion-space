import { createFileRoute } from "@tanstack/react-router";
import { handleEventsGet, handleEventsPost } from "@/lib/calendar/http.server";

export const Route = createFileRoute("/api/calendar/events")({
  server: {
    handlers: {
      GET: ({ request }) => handleEventsGet(request),
      POST: ({ request }) => handleEventsPost(request),
    },
  },
});
