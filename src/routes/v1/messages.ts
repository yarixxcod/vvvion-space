import { createFileRoute } from "@tanstack/react-router";
import { corsPreflight } from "@/lib/api/cors";
import { methodNotAllowed } from "@/lib/api/http";
import { v1Messages } from "@/lib/api/v1.server";

export const Route = createFileRoute("/v1/messages")({
  server: {
    handlers: {
      POST: ({ request }) => v1Messages(request),
      GET: () => methodNotAllowed("anthropic"),
      OPTIONS: () => corsPreflight(),
    },
  },
});
