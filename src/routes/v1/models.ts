import { createFileRoute } from "@tanstack/react-router";
import { corsPreflight } from "@/lib/api/cors";
import { methodNotAllowed } from "@/lib/api/http";
import { v1Models } from "@/lib/api/v1.server";

export const Route = createFileRoute("/v1/models")({
  server: {
    handlers: {
      GET: ({ request }) => v1Models(request),
      POST: () => methodNotAllowed("openai"),
      OPTIONS: () => corsPreflight(),
    },
  },
});
