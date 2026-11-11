import { createFileRoute } from "@tanstack/react-router";
import { readPublicMegaHttp } from "@/lib/social/mega-http";

export const Route = createFileRoute("/api/d/$token/$id")({
  server: {
    handlers: {
      GET: ({ request, params }) => readPublicMegaHttp(request, params.token, params.id),
      HEAD: ({ request, params }) => readPublicMegaHttp(request, params.token, params.id),
    },
  },
});
