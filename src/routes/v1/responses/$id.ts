import { createFileRoute } from "@tanstack/react-router";
import { corsPreflight } from "@/lib/api/cors";
import { v1MissingResponse } from "@/lib/api/v1.server";

export const Route = createFileRoute("/v1/responses/$id")({
  server: {
    handlers: {
      GET: () => v1MissingResponse(),
      POST: () => v1MissingResponse(),
      OPTIONS: () => corsPreflight(),
    },
  },
});
