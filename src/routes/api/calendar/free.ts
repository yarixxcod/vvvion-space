import { createFileRoute } from "@tanstack/react-router";
import { handleFree } from "@/lib/calendar/http.server";

export const Route = createFileRoute("/api/calendar/free")({
  server: { handlers: { GET: ({ request }) => handleFree(request) } },
});
