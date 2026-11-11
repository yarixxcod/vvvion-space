import { createFileRoute } from "@tanstack/react-router";
import { readTips, refreshTipsIfDue } from "@/lib/social/tips.server";

export const Route = createFileRoute("/api/tips")({
  server: {
    handlers: {
      GET: async () => {
        const current = await readTips().catch(() => ({ items: [], at: null }));
        void refreshTipsIfDue().catch(() => undefined);
        return new Response(JSON.stringify(current), {
          headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
        });
      },
    },
  },
});
