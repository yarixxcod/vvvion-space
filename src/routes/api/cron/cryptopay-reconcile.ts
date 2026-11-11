import { createFileRoute } from "@tanstack/react-router";
import { payFlags } from "@/lib/pay/flags";
import { json, reconcilePending } from "@/lib/pay/topup.server";

async function handle(request: Request) {
  const secret = payFlags().cronSecret;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return json(401, { message: "Unauthorized" });
  }
  try {
    const result = await reconcilePending();
    return json(200, { ok: true, ...result });
  } catch (err) {
    console.error("[pay] cron", err instanceof Error ? err.name : "error");
    return json(500, { code: "reconcile_failed" });
  }
}

export const Route = createFileRoute("/api/cron/cryptopay-reconcile")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
    },
  },
});
