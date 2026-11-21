import { createFileRoute } from "@tanstack/react-router";
import { corsPreflight } from "@/lib/api/cors";
import { methodNotAllowed } from "@/lib/api/http";
import { v1CountTokens } from "@/lib/api/v1.server";

export const Route = createFileRoute("/v1/messages/count_tokens")({
  server: {
    handlers: {
      POST: ({ request }) => v1CountTokens(request),
      GET: () => methodNotAllowed("anthropic"),
      OPTIONS: () => corsPreflight(),
    },
  },
});
