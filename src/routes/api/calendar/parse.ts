import { createFileRoute } from "@tanstack/react-router";
import { handleParse } from "@/lib/calendar/http.server";

export const Route = createFileRoute("/api/calendar/parse")({
  server: { handlers: { POST: ({ request }) => handleParse(request) } },
});
