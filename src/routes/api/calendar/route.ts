import { createFileRoute } from "@tanstack/react-router";
import { handleCalendarGet, handleCalendarPost } from "@/lib/calendar/http.server";

export const Route = createFileRoute("/api/calendar")({
  server: {
    handlers: {
      GET: ({ request }) => handleCalendarGet(request),
      POST: ({ request }) => handleCalendarPost(request),
    },
  },
});
