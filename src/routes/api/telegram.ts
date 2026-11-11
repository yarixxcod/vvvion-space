import { createFileRoute } from "@tanstack/react-router";

function missing() {
  return new Response(JSON.stringify({ ok: false }), {
    status: 404,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export const Route = createFileRoute("/api/telegram")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleTelegram } = await import("@/lib/social/telegram.server");
        return handleTelegram(request);
      },
      GET: () => missing(),
      HEAD: () => new Response(null, { status: 404, headers: { "cache-control": "no-store" } }),
    },
  },
});
