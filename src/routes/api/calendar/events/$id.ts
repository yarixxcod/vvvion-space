import { createFileRoute } from "@tanstack/react-router";
import { handleEventDelete, handleEventGet, handleEventPatch } from "@/lib/calendar/http.server";

export const Route = createFileRoute("/api/calendar/events/$id")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleEventGet(request, params.id),
      PATCH: ({ request, params }) => handleEventPatch(request, params.id),
      DELETE: ({ request, params }) => handleEventDelete(request, params.id),
    },
  },
});
