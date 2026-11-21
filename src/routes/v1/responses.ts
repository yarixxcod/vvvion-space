import { createFileRoute } from "@tanstack/react-router";
import { corsPreflight } from "@/lib/api/cors";
import { methodNotAllowed } from "@/lib/api/http";
import { v1Responses } from "@/lib/api/v1.server";

export const Route = createFileRoute("/v1/responses")({
  server: {
    handlers: {
      POST: ({ request }) => v1Responses(request),
      GET: () => methodNotAllowed("openai"),
      OPTIONS: () => corsPreflight(),
    },
  },
});
