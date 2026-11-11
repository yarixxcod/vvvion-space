import { createFileRoute } from "@tanstack/react-router";
import { handleModels } from "@/lib/ai/proxy.server";

export const Route = createFileRoute("/api/models")({
  server: {
    handlers: {
      POST: ({ request }) => handleModels(request),
    },
  },
});
