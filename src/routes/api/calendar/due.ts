import { createFileRoute } from "@tanstack/react-router";
import { handleDue } from "@/lib/calendar/http.server";

export const Route = createFileRoute("/api/calendar/due")({
  server: { handlers: { POST: ({ request }) => handleDue(request) } },
});
