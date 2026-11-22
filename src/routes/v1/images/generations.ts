import { createFileRoute } from "@tanstack/react-router";
import { corsPreflight } from "@/lib/api/cors";
import { methodNotAllowed } from "@/lib/api/http";
import { v1Images } from "@/lib/api/v1.server";

export const Route = createFileRoute("/v1/images/generations")({
  server: {
    handlers: {
      POST: ({ request }) => v1Images(request),
      GET: () => methodNotAllowed("openai"),
      OPTIONS: () => corsPreflight(),
    },
  },
});
