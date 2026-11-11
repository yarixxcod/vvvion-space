import { createFileRoute } from "@tanstack/react-router";
import { handlePing } from "@/lib/ai/ping.server";

function missing() {
  return new Response(JSON.stringify({ ok: false }), {
    status: 404,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export const Route = createFileRoute("/api/ping")({
  server: {
    handlers: {
      POST: ({ request }) => handlePing(request),
      GET: () => missing(),
      HEAD: () => new Response(null, { status: 404, headers: { "cache-control": "no-store" } }),
    },
  },
});
