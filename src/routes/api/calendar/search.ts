import { createFileRoute } from "@tanstack/react-router";
import { handleSearch } from "@/lib/calendar/http.server";

export const Route = createFileRoute("/api/calendar/search")({
  server: { handlers: { GET: ({ request }) => handleSearch(request) } },
});
