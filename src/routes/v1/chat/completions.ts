import { createFileRoute } from "@tanstack/react-router";
import { corsPreflight } from "@/lib/api/cors";
import { methodNotAllowed } from "@/lib/api/http";
import { v1ChatCompletions } from "@/lib/api/v1.server";

export const Route = createFileRoute("/v1/chat/completions")({
  server: {
    handlers: {
      POST: ({ request }) => v1ChatCompletions(request),
      GET: () => methodNotAllowed("openai"),
      OPTIONS: () => corsPreflight(),
    },
  },
});
