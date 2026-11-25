import { createFileRoute } from "@tanstack/react-router";
import { handleCalendarCron } from "@/lib/calendar/http.server";

export const Route = createFileRoute("/api/calendar/cron")({
  server: {
    handlers: {
      GET: ({ request }) => handleCalendarCron(request),
      POST: ({ request }) => handleCalendarCron(request),
    },
  },
});
