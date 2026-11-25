import { createFileRoute } from "@tanstack/react-router";
import { handleCalendarDelete, handleCalendarPatch } from "@/lib/calendar/http.server";

export const Route = createFileRoute("/api/calendar/$id")({
  server: {
    handlers: {
      PATCH: ({ request, params }) => handleCalendarPatch(request, params.id),
      DELETE: ({ request, params }) => handleCalendarDelete(request, params.id),
    },
  },
});
