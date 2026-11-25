import { createFileRoute } from "@tanstack/react-router";
import { handlePrefsPut } from "@/lib/calendar/http.server";

export const Route = createFileRoute("/api/calendar/prefs")({
  server: { handlers: { PUT: ({ request }) => handlePrefsPut(request) } },
});
