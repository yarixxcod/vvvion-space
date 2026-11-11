import { createFileRoute } from "@tanstack/react-router";
import { minRubForVub, quote, TopupError } from "@/lib/pay/vubli-rate";

export const Route = createFileRoute("/api/vubli/quote")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const url = new URL(request.url);
        const rubRaw = url.searchParams.get("rub");
        const needRaw = url.searchParams.get("needVub");
        try {
          const rub = rubRaw !== null ? Number(rubRaw) : minRubForVub(Number(needRaw));
          return Response.json(quote(rub), { headers: { "cache-control": "no-store" } });
        } catch (err) {
          const code = err instanceof TopupError ? err.code : "amount_out_of_range";
          return Response.json({ code }, { status: 400, headers: { "cache-control": "no-store" } });
        }
      },
    },
  },
});
